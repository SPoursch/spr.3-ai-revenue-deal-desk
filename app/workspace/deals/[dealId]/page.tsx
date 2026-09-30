import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import {
  CARD_CLASS,
  PAGE_CLASS,
  PRIMARY_LINK_CLASS,
  SECONDARY_LINK_CLASS,
  TEXT_LINK_CLASS,
} from '@/app/components/deal-desk/styles'
import {
  DEAL_STAGE_LABELS,
  DEAL_TYPE_LABELS,
  EVIDENCE_TYPE_LABELS,
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
  listDeals,
  listEvidenceItems,
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
 */
export const dynamic = 'force-dynamic'

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
  const [account, predecessor, renewals, evidence] = await Promise.all([
    getAccount(deal.account_id),
    deal.predecessor_deal_id ? getDeal(deal.predecessor_deal_id) : null,
    listDeals().then((deals) => deals.filter((d) => d.predecessor_deal_id === deal.id)),
    listEvidenceItems(deal.id),
  ])

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
    <main aria-label="Deal" className={PAGE_CLASS}>
      <Link href="/workspace" className={`${TEXT_LINK_CLASS} text-[14px]`}>
        ← All deals
      </Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-[28px] font-bold tracking-tight">{deal.name}</h1>
        <div className="flex gap-3">
          <Link href={`/workspace/deals/${deal.id}/edit`} className={PRIMARY_LINK_CLASS}>
            Edit deal
          </Link>
          <Link href={`/workspace/deals/${deal.id}/renew`} className={SECONDARY_LINK_CLASS}>
            Create renewal
          </Link>
          <Link href={`/workspace/deals/${deal.id}/delete`} className={SECONDARY_LINK_CLASS}>
            Delete deal
          </Link>
        </div>
      </div>

      <section aria-label="Deal details" className={`${CARD_CLASS} mt-8`}>
        <dl className="grid gap-x-6 sm:grid-cols-2">
          {details.map(([term, value]) => (
            <div key={term} className="flex flex-col gap-1 border-b border-border px-6 py-4">
              <dt className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
                {term}
              </dt>
              <dd className="text-[15px]">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {predecessor || renewals.length > 0 ? (
        <section aria-label="Renewal lineage" className={`${CARD_CLASS} mt-6 px-6 py-4`}>
          <ul className="flex flex-col gap-2 text-[15px]">
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

      <section aria-label="Evidence" className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-[20px] font-bold tracking-tight">Evidence</h2>
          <Link
            href={`/workspace/deals/${deal.id}/evidence/new`}
            className={SECONDARY_LINK_CLASS}
          >
            Add evidence
          </Link>
        </div>
        {evidence.length === 0 ? (
          <p className="mt-3 text-[15px] text-muted">
            No evidence yet. Add the contract, order form, emails or call notes behind
            this deal.
          </p>
        ) : (
          <ul className={`${CARD_CLASS} mt-3 divide-y divide-border`}>
            {evidence.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-6 py-4">
                <Link
                  href={`/workspace/deals/${deal.id}/evidence/${item.id}`}
                  className={`${TEXT_LINK_CLASS} text-[15px]`}
                >
                  {item.title}
                </Link>
                <span className="text-[14px] text-muted">
                  {EVIDENCE_TYPE_LABELS[item.evidence_type]}
                  {item.document_date ? ` · ${formatDate(item.document_date)}` : ''}
                  {item.is_executed ? ' · Executed' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
