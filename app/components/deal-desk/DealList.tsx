import Link from 'next/link'

import { noticeDeadline, type AttentionItem } from '@/app/lib/deal-desk/attention'
import type { Account, Deal, DealStage } from '@/app/lib/deal-desk/domain'
import {
  DEAL_STAGE_LABELS,
  DEAL_TYPE_LABELS,
  formatDate,
  formatEur,
  formatNumber,
} from '@/app/lib/deal-desk/format'

import {
  BADGE_CLASS,
  BADGE_TONE,
  CARD_CLASS,
  EMPTY_STATE_CLASS,
  ERROR_CLASS,
  PRIMARY_LINK_CLASS,
  TABLE_CELL_CLASS,
  TABLE_CLASS,
  TABLE_HEAD_CLASS,
  TABLE_HEADER_CELL_CLASS,
  TABLE_ROW_CLASS,
  TEXT_LINK_CLASS,
} from './styles'

/**
 * The deal list on /workspace.
 *
 * CLAUDE.md: an empty list must never look like a failed load. `deals` is
 * null when loading failed, which renders an error panel; an empty array is
 * the genuine "no deals yet" state.
 *
 * The notice and exceptions columns are derived on the page from the
 * Attention read model and the live exceptions. `exceptionsByDeal` is null
 * when the exceptions could not be read, and the column then shows a dash
 * rather than "None".
 */

const STAGE_TONE: Record<DealStage, keyof typeof BADGE_TONE> = {
  discovery: 'neutral',
  negotiation: 'primary',
  contracting: 'primary',
  closed: 'muted',
}

const MUTED_DASH = <span className="text-muted">—</span>

function NoticeCell({ deal, item }: { deal: Deal; item: AttentionItem | undefined }) {
  // As on the Attention page, a deal already renewed by another says so, so a
  // missed notice on it does not read as unhandled. Only the fact is shown:
  // the successor's name would make this row match a lookup by that name.
  const renewed =
    item && item.successors.length > 0 ? (
      <span className="mt-1 block text-[13px] text-muted">Renewal created</span>
    ) : null

  switch (item?.notice) {
    case 'missed':
      return (
        <>
          <span className={`${BADGE_CLASS} ${BADGE_TONE.danger}`}>
            Missed {formatDate(item.noticeDeadline)}
          </span>
          {renewed}
        </>
      )
    case 'due_soon':
      return (
        <>
          <span className={`${BADGE_CLASS} ${BADGE_TONE.warning}`}>
            Due {formatDate(item.noticeDeadline)}
          </span>
          {renewed}
        </>
      )
    case 'cannot_compute':
      return (
        <>
          <span className={`${BADGE_CLASS} ${BADGE_TONE.warning}`}>No notice period</span>
          {renewed}
        </>
      )
  }

  // Not listed by Attention: show the deadline itself, when there is one.
  const deadline = noticeDeadline(deal)
  return deadline ? <>{formatDate(deadline)}</> : MUTED_DASH
}

function ExceptionsCell({ count }: { count: number | null }) {
  if (count === null) return MUTED_DASH
  if (count === 0) return <span className="text-muted">None</span>
  return <span className={`${BADGE_CLASS} ${BADGE_TONE.warning}`}>{count} open</span>
}

function EmptyDeals({ hasAccounts }: { hasAccounts: boolean }) {
  const steps = [
    { title: 'Create the account', body: 'The company the deal is with.', done: hasAccounts },
    { title: 'Add the deal', body: 'Its type, stage, ARR and renewal terms.', done: false },
    {
      title: 'Attach evidence and check it',
      body: 'Contracts and notes, then run the deal rules for exceptions.',
      done: false,
    },
  ]

  return (
    <section aria-label="Deals" className={`${EMPTY_STATE_CLASS} px-6 py-12`}>
      <h2 className="text-[20px] font-bold tracking-tight">No deals yet</h2>
      <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-muted">
        {hasAccounts
          ? 'Add your first deal to see it here.'
          : 'Start by creating the account a deal belongs to, then add the deal.'}
      </p>
      <ol className="mx-auto mt-8 grid max-w-3xl gap-3 text-left sm:grid-cols-3">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className="flex gap-3 rounded-[var(--radius-control)] border border-border bg-workspace/50 px-4 py-3"
          >
            <span
              aria-hidden="true"
              className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
                step.done ? 'bg-primary text-primary-foreground' : 'bg-selected text-primary'
              }`}
            >
              {step.done ? '✓' : index + 1}
            </span>
            <div>
              <p className="text-[14px] font-semibold">
                {step.title}
                {step.done ? <span className="sr-only"> (done)</span> : null}
              </p>
              <p className="mt-0.5 text-[13px] text-muted">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-8">
        <Link
          href={hasAccounts ? '/workspace/deals/new' : '/workspace/accounts/new'}
          className={PRIMARY_LINK_CLASS}
        >
          {hasAccounts ? 'Add a deal' : 'Create an account'}
        </Link>
      </div>
    </section>
  )
}

export function DealList({
  deals,
  accounts,
  attentionByDeal,
  exceptionsByDeal,
}: {
  deals: Deal[] | null
  accounts: Account[]
  attentionByDeal: Map<string, AttentionItem>
  exceptionsByDeal: Map<string, number> | null
}) {
  if (deals === null) {
    return (
      <p role="alert" className={ERROR_CLASS}>
        Your deals could not be loaded. Refresh the page to try again.
      </p>
    )
  }

  if (deals.length === 0) {
    return <EmptyDeals hasAccounts={accounts.length > 0} />
  }

  const accountNames = new Map(accounts.map((account) => [account.id, account.name]))

  return (
    // The region keeps the name "Deals" (the deal list's contract); the card
    // heading reads "All deals" so it does not repeat the page's h1.
    <section aria-label="Deals" className={`${CARD_CLASS} overflow-hidden`}>
      <div className="flex items-baseline justify-between gap-4 border-b border-border px-5 py-4">
        <h2 className="text-[17px] font-semibold tracking-tight">All deals</h2>
        <p className="text-[13px] text-muted">
          {formatNumber(deals.length, 'deal')}, by renewal date
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className={`${TABLE_CLASS} min-w-[960px]`}>
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th scope="col" className={TABLE_HEADER_CELL_CLASS}>Deal</th>
              <th scope="col" className={TABLE_HEADER_CELL_CLASS}>Account</th>
              <th scope="col" className={TABLE_HEADER_CELL_CLASS}>Type</th>
              <th scope="col" className={TABLE_HEADER_CELL_CLASS}>Stage</th>
              <th scope="col" className={`${TABLE_HEADER_CELL_CLASS} text-right`}>ARR</th>
              <th scope="col" className={TABLE_HEADER_CELL_CLASS}>Renewal date</th>
              <th scope="col" className={TABLE_HEADER_CELL_CLASS}>Notice deadline</th>
              <th scope="col" className={TABLE_HEADER_CELL_CLASS}>Exceptions</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((deal) => (
              <tr key={deal.id} className={TABLE_ROW_CLASS}>
                <td className={`${TABLE_CELL_CLASS} min-w-[13rem]`}>
                  <Link href={`/workspace/deals/${deal.id}`} className={TEXT_LINK_CLASS}>
                    {deal.name}
                  </Link>
                </td>
                <td className={TABLE_CELL_CLASS}>
                  {accountNames.get(deal.account_id) ?? 'Unknown account'}
                </td>
                <td className={`${TABLE_CELL_CLASS} whitespace-nowrap text-muted`}>
                  {DEAL_TYPE_LABELS[deal.deal_type]}
                </td>
                <td className={TABLE_CELL_CLASS}>
                  <span className={`${BADGE_CLASS} ${BADGE_TONE[STAGE_TONE[deal.stage]]}`}>
                    {DEAL_STAGE_LABELS[deal.stage]}
                  </span>
                </td>
                <td className={`${TABLE_CELL_CLASS} text-right font-medium whitespace-nowrap tabular-nums`}>
                  {formatEur(deal.arr_eur)}
                </td>
                <td className={`${TABLE_CELL_CLASS} whitespace-nowrap tabular-nums`}>
                  {formatDate(deal.renewal_date)}
                </td>
                <td className={`${TABLE_CELL_CLASS} tabular-nums`}>
                  <NoticeCell deal={deal} item={attentionByDeal.get(deal.id)} />
                </td>
                <td className={TABLE_CELL_CLASS}>
                  <ExceptionsCell
                    count={exceptionsByDeal === null ? null : (exceptionsByDeal.get(deal.id) ?? 0)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
