import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { AccountMark } from '@/app/components/deal-desk/AccountMark'
import { CopilotAnswers } from '@/app/components/deal-desk/CopilotAnswers'
import { CopilotForm } from '@/app/components/deal-desk/CopilotForm'
import { NoticeCell, STAGE_TONE } from '@/app/components/deal-desk/DealList'
import { CheckDealForm } from '@/app/components/deal-desk/ExceptionForms'
import {
  BADGE_CLASS,
  BADGE_TONE,
  CARD_CLASS,
  PRIMARY_LINK_CLASS,
  SECONDARY_LINK_CLASS,
  TEXT_LINK_CLASS,
  WIDE_PAGE_CLASS,
} from '@/app/components/deal-desk/styles'
import { buildAttention } from '@/app/lib/deal-desk/attention'
import { buildCopilotSources } from '@/app/lib/deal-desk/copilot'
import { attentionByDeal, noticeView } from '@/app/lib/deal-desk/dashboard'
import type { ExceptionSeverity } from '@/app/lib/deal-desk/domain'
import {
  DEAL_STAGE_LABELS,
  DEAL_TYPE_LABELS,
  EVIDENCE_TYPE_LABELS,
  EXCEPTION_SEVERITY_LABELS,
  EXCEPTION_STATUS_LABELS,
  PROVISION_TYPE_LABELS,
  formatBoolean,
  formatDate,
  formatEur,
  formatNumber,
  formatPercent,
} from '@/app/lib/deal-desk/format'
import {
  getAccount,
  getAuthenticatedUser,
  getDeal,
  listCopilotAnswers,
  listDeals,
  listEvidenceItems,
  listExceptions,
  listProvisionExcerpts,
  listProvisions,
} from '@/app/lib/db'

/**
 * One deal, read-only.
 *
 * The deal is read as the signed-in user, so row level security decides
 * whether it is visible: someone else's deal and a deal that does not exist
 * are the same `null`, and both render the not-found page. Nothing on it
 * reveals whether the id exists.
 *
 * Renewal lineage (U13) links the deal to the deal it renews, if any, and to
 * every deal that renews it. Both are the user's own: the composite foreign
 * key keeps a renewal on its owner's deals.
 *
 * Layout (UI Phase 5): a header with the deal's identity, its account (linked
 * to the account page) and its actions; the key facts; then the deal's work
 * (exceptions, provisions, evidence, the Copilot) beside its full terms and
 * lineage. Every section is always rendered; nothing is behind a tab. The
 * notice status is the dashboard's (noticeView over the Attention read model,
 * built here from this deal, its renewals and its own live exceptions).
 *
 * Contracts the tests rely on: "Edit deal", "Delete deal" and "Create
 * renewal" appear once each; the "Deal details" list keeps each term and its
 * value in one div directly inside the dl; the Exceptions region holds no list
 * items other than its exceptions.
 */
export const dynamic = 'force-dynamic'

/** Decided and dismissed exceptions are closed; open and under review are live. */
function isClosed(status: string): boolean {
  return status === 'decided' || status === 'dismissed'
}

const SEVERITY_TONE: Record<ExceptionSeverity, keyof typeof BADGE_TONE> = {
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
}

/** A card's header: its heading, and an action on the right when it has one. */
function CardHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
      <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
      {children}
    </div>
  )
}

export const metadata: Metadata = { title: 'Deal · AI Revenue Deal Desk' }

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function DealPage({ params }: PageProps<'/workspace/deals/[dealId]'>) {
  if (!(await getAuthenticatedUser())) {
    redirect('/login')
  }

  const { dealId } = await params

  // Not a uuid: Postgres would reject it as invalid input, so answer
  // "not found" without asking.
  if (!UUID_PATTERN.test(dealId)) {
    notFound()
  }

  const deal = await getDeal(dealId)

  if (!deal) {
    notFound()
  }

  // A failed read goes to the workspace error page, so an evidence list that
  // could not be loaded never looks like "No evidence yet".
  const [account, predecessor, renewals, evidence, provisions, exceptions, copilotAnswers] = await Promise.all([
    getAccount(deal.account_id),
    deal.predecessor_deal_id ? getDeal(deal.predecessor_deal_id) : null,
    listDeals().then((deals) => deals.filter((d) => d.predecessor_deal_id === deal.id)),
    listEvidenceItems(deal.id),
    // At most one provision per type, so at most seven citation reads.
    listProvisions(deal.id).then((list) =>
      Promise.all(
        list.map(async (provision) => ({
          provision,
          citationCount: (await listProvisionExcerpts(provision.id)).length,
        })),
      ),
    ),
    // Live exceptions first, each group newest first (the list's own order).
    listExceptions(deal.id).then((list) =>
      [...list].sort(
        (a, b) => Number(isClosed(a.status)) - Number(isClosed(b.status)),
      ),
    ),
    // The stored answers as they were made, newest first, at most 10.
    listCopilotAnswers(deal.id),
  ])

  // The deal's facts as they are now, against which each stored answer's
  // fact snapshots are compared ("changed since this answer").
  const currentFacts = buildCopilotSources({
    deal,
    account,
    predecessor,
    provisions: provisions.map(({ provision }) => provision),
    exceptions: [],
    excerpts: [],
  })

  // This deal's notice status, as on the dashboard. Its renewals are passed
  // too, so the read model knows whether a renewal deal already exists.
  const liveExceptions = exceptions.filter((exception) => !isClosed(exception.status))
  const attention = buildAttention({
    deals: [deal, ...renewals],
    liveExceptions,
    now: new Date(),
    overArrThreshold: false,
  })
  const attentionItem = attention.items.find((item) => item.deal.id === deal.id)

  const keyFacts: [string, ReactNode][] = [
    ['ARR', formatEur(deal.arr_eur)],
    ['TCV', formatEur(deal.tcv_eur)],
    ['Term', formatNumber(deal.term_months, 'month')],
    ['Renewal date', formatDate(deal.renewal_date)],
    ['Notice deadline', <NoticeCell key="notice" view={noticeView(deal, attentionByDeal(attention))} />],
  ]

  const details: [string, string][] = [
    ['Account', account?.name ?? 'Unknown account'],
    ['Deal type', DEAL_TYPE_LABELS[deal.deal_type]],
    ['Stage', DEAL_STAGE_LABELS[deal.stage]],
    ['ARR', formatEur(deal.arr_eur)],
    ['TCV', formatEur(deal.tcv_eur)],
    ['List price', formatEur(deal.list_price_eur)],
    ['Discount', formatPercent(deal.discount_pct)],
    ['Term', formatNumber(deal.term_months, 'month')],
    ['Start date', formatDate(deal.start_date)],
    ['End date', formatDate(deal.end_date)],
    ['Renewal date', formatDate(deal.renewal_date)],
    ['Notice period', formatNumber(deal.notice_period_days, 'day')],
    ['Auto-renews', formatBoolean(deal.auto_renew)],
  ]

  return (
    <main aria-label="Deal" className={WIDE_PAGE_CLASS}>
      <Link href="/workspace" className={`${TEXT_LINK_CLASS} text-[14px]`}>
        ← All deals
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] leading-tight font-bold tracking-tight break-words">
            {deal.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className={`${BADGE_CLASS} ${BADGE_TONE[STAGE_TONE[deal.stage]]}`}>
              {DEAL_STAGE_LABELS[deal.stage]}
            </span>
            <span className={`${BADGE_CLASS} ${BADGE_TONE.neutral}`}>
              {DEAL_TYPE_LABELS[deal.deal_type]}
            </span>
            {attentionItem?.renewsNextQuarter ? (
              <span className={`${BADGE_CLASS} ${BADGE_TONE.primary}`}>Renews next quarter</span>
            ) : null}
            {account ? (
              <span className="flex items-center gap-2 text-[14px]">
                <AccountMark name={account.name} />
                <Link href={`/workspace/accounts/${account.id}`} className={TEXT_LINK_CLASS}>
                  {account.name}
                </Link>
              </span>
            ) : null}
          </div>
        </div>
        {/* Each action once: the tests find these links page-wide by name. */}
        <div className="flex flex-wrap gap-3">
          <Link href={`/workspace/deals/${deal.id}/renew`} className={SECONDARY_LINK_CLASS}>
            Create renewal
          </Link>
          <Link href={`/workspace/deals/${deal.id}/delete`} className={SECONDARY_LINK_CLASS}>
            Delete deal
          </Link>
          <Link href={`/workspace/deals/${deal.id}/edit`} className={PRIMARY_LINK_CLASS}>
            Edit deal
          </Link>
        </div>
      </div>

      <section aria-label="Key facts" className={`${CARD_CLASS} mt-8 overflow-hidden`}>
        <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-5">
          {keyFacts.map(([term, value]) => (
            <div key={term} className="flex flex-col gap-1 bg-pane px-5 py-4">
              <dt className="text-[13px] font-medium text-muted">{term}</dt>
              <dd className="text-[17px] font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-label="Exceptions" className={`${CARD_CLASS} overflow-hidden`}>
            <CardHeader
              title={liveExceptions.length > 0 ? `Exceptions (${liveExceptions.length} open)` : 'Exceptions'}
            >
              <CheckDealForm dealId={deal.id} />
            </CardHeader>
            {exceptions.length === 0 ? (
              <p className="px-5 py-4 text-[15px] text-muted">
                No exceptions. Check the deal to run its rules.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {exceptions.map((exception) => (
                  <li
                    key={exception.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5"
                  >
                    <Link
                      href={`/workspace/deals/${deal.id}/exceptions/${exception.id}`}
                      className={`${TEXT_LINK_CLASS} text-[15px]`}
                    >
                      {exception.title}
                    </Link>
                    <span className="flex flex-wrap gap-1.5">
                      <span className={`${BADGE_CLASS} ${BADGE_TONE[SEVERITY_TONE[exception.severity]]}`}>
                        {EXCEPTION_SEVERITY_LABELS[exception.severity]}
                      </span>
                      <span
                        className={`${BADGE_CLASS} ${
                          isClosed(exception.status) ? BADGE_TONE.muted : BADGE_TONE.neutral
                        }`}
                      >
                        {EXCEPTION_STATUS_LABELS[exception.status]}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Provisions" className={`${CARD_CLASS} overflow-hidden`}>
            <CardHeader title="Provisions">
              <Link
                href={`/workspace/deals/${deal.id}/provisions/new`}
                className={SECONDARY_LINK_CLASS}
              >
                Add provision
              </Link>
            </CardHeader>
            {provisions.length === 0 ? (
              <p className="px-5 py-4 text-[15px] text-muted">
                No provisions yet. Record the contract terms of this deal and cite the evidence
                behind them.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {provisions.map(({ provision, citationCount }) => (
                  <li
                    key={provision.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5"
                  >
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                      <Link
                        href={`/workspace/deals/${deal.id}/provisions/${provision.id}`}
                        className={`${TEXT_LINK_CLASS} text-[15px]`}
                      >
                        {PROVISION_TYPE_LABELS[provision.provision_type]}
                      </Link>
                      <span className="text-[15px]">{provision.value_text}</span>
                    </span>
                    <span
                      className={`${BADGE_CLASS} ${
                        citationCount > 0 ? BADGE_TONE.success : BADGE_TONE.warning
                      }`}
                    >
                      {citationCount > 0 ? 'Supported' : 'Unsupported'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Evidence" className={`${CARD_CLASS} overflow-hidden`}>
            <CardHeader title="Evidence">
              <Link
                href={`/workspace/deals/${deal.id}/evidence/new`}
                className={SECONDARY_LINK_CLASS}
              >
                Add evidence
              </Link>
            </CardHeader>
            {evidence.length === 0 ? (
              <p className="px-5 py-4 text-[15px] text-muted">
                No evidence yet. Add the contract, order form, emails or call notes behind
                this deal.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {evidence.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5"
                  >
                    <Link
                      href={`/workspace/deals/${deal.id}/evidence/${item.id}`}
                      className={`${TEXT_LINK_CLASS} text-[15px]`}
                    >
                      {item.title}
                    </Link>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-muted">
                      {EVIDENCE_TYPE_LABELS[item.evidence_type]}
                      {item.document_date ? <span>{formatDate(item.document_date)}</span> : null}
                      {item.is_executed ? (
                        <span className={`${BADGE_CLASS} ${BADGE_TONE.success}`}>Executed</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Copilot" className={`${CARD_CLASS} flex flex-col gap-6 p-5`}>
            <div className="flex flex-col gap-1">
              <h2 className="text-[17px] font-semibold tracking-tight">AI Deal Copilot</h2>
              <p className="max-w-2xl text-[14px] text-muted">
                Ask one question about this deal. The Copilot answers only from this deal&apos;s
                facts, evidence and exceptions, cites its sources, and never decides anything.
              </p>
            </div>
            <CopilotForm dealId={deal.id} />
            <CopilotAnswers
              dealId={deal.id}
              answers={copilotAnswers}
              currentSources={currentFacts}
              exceptions={exceptions}
            />
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <section aria-label="Deal details" className={`${CARD_CLASS} overflow-hidden`}>
            <CardHeader title="Commercial terms" />
            {/* One dl, each term and its value in one div directly inside it:
                the tests find a value through the div that holds its term. */}
            <dl className="divide-y divide-border">
              {details.map(([term, value]) => (
                <div key={term} className="flex items-baseline justify-between gap-4 px-5 py-3">
                  <dt className="text-[13px] font-medium text-muted">{term}</dt>
                  <dd className="text-right text-[14px]">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {predecessor || renewals.length > 0 ? (
            <section aria-label="Renewal lineage" className={`${CARD_CLASS} overflow-hidden`}>
              <CardHeader title="Renewal lineage" />
              <ul className="flex flex-col gap-2 px-5 py-4 text-[15px]">
                {predecessor ? (
                  <li>
                    Renewal of{' '}
                    <Link href={`/workspace/deals/${predecessor.id}`} className={TEXT_LINK_CLASS}>
                      {predecessor.name}
                    </Link>
                  </li>
                ) : null}
                {renewals.map((renewal) => (
                  <li key={renewal.id}>
                    Renewed by{' '}
                    <Link href={`/workspace/deals/${renewal.id}`} className={TEXT_LINK_CLASS}>
                      {renewal.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  )
}
