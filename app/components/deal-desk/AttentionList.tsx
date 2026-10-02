import Link from 'next/link'

import type { AttentionItem } from '@/app/lib/deal-desk/attention'
import { formatBoolean, formatDate, formatEur } from '@/app/lib/deal-desk/format'

import {
  CARD_CLASS,
  TABLE_CELL_CLASS,
  TABLE_CLASS,
  TABLE_HEAD_CLASS,
  TABLE_HEADER_CELL_CLASS,
  TABLE_ROW_CLASS,
  TEXT_LINK_CLASS,
} from './styles'

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
      <table aria-label={label} className={`${TABLE_CLASS} min-w-[880px]`}>
        <thead className={TABLE_HEAD_CLASS}>
          <tr>
            <th scope="col" className={TABLE_HEADER_CELL_CLASS}>Deal</th>
            <th scope="col" className={TABLE_HEADER_CELL_CLASS}>Account</th>
            <th scope="col" className={`${TABLE_HEADER_CELL_CLASS} text-right`}>ARR</th>
            <th scope="col" className={TABLE_HEADER_CELL_CLASS}>Renewal date</th>
            <th scope="col" className={TABLE_HEADER_CELL_CLASS}>Notice deadline</th>
            <th scope="col" className={TABLE_HEADER_CELL_CLASS}>Auto-renew</th>
            <th scope="col" className={TABLE_HEADER_CELL_CLASS}>Renewal deal</th>
            <th scope="col" className={`${TABLE_HEADER_CELL_CLASS} text-right`}>Open exceptions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.deal.id} className={TABLE_ROW_CLASS}>
              <td className={TABLE_CELL_CLASS}>
                <Link href={`/workspace/deals/${item.deal.id}`} className={TEXT_LINK_CLASS}>
                  {item.deal.name}
                </Link>
              </td>
              <td className={TABLE_CELL_CLASS}>
                {accountNames.get(item.deal.account_id) ?? 'Unknown account'}
              </td>
              <td className={`${TABLE_CELL_CLASS} text-right tabular-nums`}>{formatEur(item.deal.arr_eur)}</td>
              <td className={TABLE_CELL_CLASS}>{formatDate(item.deal.renewal_date)}</td>
              <td className={TABLE_CELL_CLASS}>
                <NoticeCell item={item} />
              </td>
              <td className={TABLE_CELL_CLASS}>
                {item.deal.auto_renew === null ? 'Unknown' : formatBoolean(item.deal.auto_renew)}
              </td>
              <td className={TABLE_CELL_CLASS}>
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
              <td className={`${TABLE_CELL_CLASS} text-right tabular-nums`}>
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
