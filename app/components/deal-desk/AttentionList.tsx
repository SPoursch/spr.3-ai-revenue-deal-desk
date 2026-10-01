import Link from 'next/link'

import type { AttentionItem } from '@/app/lib/deal-desk/attention'
import { formatBoolean, formatDate, formatEur } from '@/app/lib/deal-desk/format'

import { CARD_CLASS, TEXT_LINK_CLASS } from './styles'

/**
 * One section's deals on /workspace/attention (Feature 7,
 * docs/sprint-3-domain-index.md §10), as a table in the deal list's style.
 * Read-only: every row links to the deal, where the user acts.
 *
 * A deal whose notice deadline cannot be computed says so in its deadline
 * cell, so a missing notice period never reads as "nothing due".
 */

function NoticeCell({ item }: { item: AttentionItem }) {
  switch (item.notice) {
    case 'cannot_compute':
      return <span className="font-semibold text-danger">Cannot compute — no notice period</span>
    case 'missed':
      return (
        <>
          {formatDate(item.noticeDeadline)}{' '}
          <span className="font-semibold text-danger">Missed</span>
        </>
      )
    case 'due_soon':
      return (
        <>
          {formatDate(item.noticeDeadline)} <span className="font-semibold">Due soon</span>
        </>
      )
    case 'not_due':
      return <>{formatDate(item.noticeDeadline)}</>
  }
}

export function AttentionList({
  label,
  items,
  accountNames,
  empty,
}: {
  /** The table's accessible name. */
  label: string
  items: AttentionItem[]
  accountNames: Map<string, string>
  /** Shown instead of the table when there is nothing to list. */
  empty: string
}) {
  if (items.length === 0) {
    return <p className="mt-3 text-[15px] text-muted">{empty}</p>
  }

  return (
    <div className={`${CARD_CLASS} mt-3 overflow-x-auto`}>
      <table aria-label={label} className="w-full min-w-[880px] text-left text-[14px]">
        <thead className="border-b border-border text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
          <tr>
            <th scope="col" className="px-4 py-3">Deal</th>
            <th scope="col" className="px-4 py-3">Account</th>
            <th scope="col" className="px-4 py-3 text-right">ARR</th>
            <th scope="col" className="px-4 py-3">Renewal date</th>
            <th scope="col" className="px-4 py-3">Notice deadline</th>
            <th scope="col" className="px-4 py-3">Auto-renew</th>
            <th scope="col" className="px-4 py-3">Renewal deal</th>
            <th scope="col" className="px-4 py-3 text-right">Open exceptions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.deal.id} className="border-b border-border last:border-b-0">
              <td className="px-4 py-3">
                <Link href={`/workspace/deals/${item.deal.id}`} className={TEXT_LINK_CLASS}>
                  {item.deal.name}
                </Link>
              </td>
              <td className="px-4 py-3">
                {accountNames.get(item.deal.account_id) ?? 'Unknown account'}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{formatEur(item.deal.arr_eur)}</td>
              <td className="px-4 py-3">{formatDate(item.deal.renewal_date)}</td>
              <td className="px-4 py-3">
                <NoticeCell item={item} />
              </td>
              <td className="px-4 py-3">
                {item.deal.auto_renew === null ? 'Unknown' : formatBoolean(item.deal.auto_renew)}
              </td>
              <td className="px-4 py-3">
                {item.successors.length > 0 ? (
                  <>
                    Renewed by{' '}
                    {item.successors.map((successor, index) => (
                      <span key={successor.id}>
                        {index > 0 ? ', ' : null}
                        <Link href={`/workspace/deals/${successor.id}`} className={TEXT_LINK_CLASS}>
                          {successor.name}
                        </Link>
                      </span>
                    ))}
                  </>
                ) : (
                  <span className="text-muted">No renewal deal yet</span>
                )}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {item.openExceptions > 0 ? (
                  <Link href={`/workspace/deals/${item.deal.id}`} className={TEXT_LINK_CLASS}>
                    {item.openExceptions} open
                  </Link>
                ) : (
                  <span className="text-muted">None</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
