import Link from 'next/link'

import {
  NOTICE_WINDOW_DAYS,
  type Attention,
  type AttentionItem,
} from '@/app/lib/deal-desk/attention'
import { formatDate, formatEur, formatNumber } from '@/app/lib/deal-desk/format'

import {
  BADGE_CLASS,
  BADGE_TONE,
  CARD_CLASS,
  ERROR_CLASS,
  TEXT_LINK_CLASS,
} from './styles'

/**
 * The attention panel on /workspace: the first deals of the Attention read
 * model (app/lib/deal-desk/attention.ts, docs/sprint-3-domain-index.md §10),
 * in its own order, each with every reason it is listed and, as on the
 * Attention page, whether a renewal deal already exists. The full view stays
 * /workspace/attention.
 *
 * A list, not a table: the attention page owns the attention tables. Every
 * row links to its deal, where the user acts; nothing here decides anything.
 * `attention` is null when it could not be built, which shows an alert, never
 * an empty panel.
 */

/** How many deals the panel shows before pointing to the full view. */
const PANEL_LIMIT = 5

function Reasons({ item }: { item: AttentionItem }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {item.notice === 'missed' ? (
        <span className={`${BADGE_CLASS} ${BADGE_TONE.danger}`}>
          Notice missed {formatDate(item.noticeDeadline)}
        </span>
      ) : null}
      {item.notice === 'due_soon' ? (
        <span className={`${BADGE_CLASS} ${BADGE_TONE.warning}`}>
          Notice due {formatDate(item.noticeDeadline)}
        </span>
      ) : null}
      {item.notice === 'cannot_compute' ? (
        <span className={`${BADGE_CLASS} ${BADGE_TONE.warning}`}>No notice period</span>
      ) : null}
      {item.renewsNextQuarter ? (
        <span className={`${BADGE_CLASS} ${BADGE_TONE.primary}`}>Renews next quarter</span>
      ) : null}
      {item.openExceptions > 0 ? (
        <span className={`${BADGE_CLASS} ${BADGE_TONE.neutral}`}>
          {formatNumber(item.openExceptions, 'open exception')}
        </span>
      ) : null}
    </div>
  )
}

export function AttentionOverview({
  attention,
  accountNames,
}: {
  attention: Attention | null
  accountNames: Map<string, string>
}) {
  const items = attention?.items ?? []
  const shown = items.slice(0, PANEL_LIMIT)

  return (
    <section aria-labelledby="needs-attention-heading" className={CARD_CLASS}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-5 py-4">
        <div>
          <h2 id="needs-attention-heading" className="text-[17px] font-semibold tracking-tight">
            Needs attention
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {attention
              ? `Notice deadlines missed or due within ${NOTICE_WINDOW_DAYS} days, renewals next quarter, and upcoming renewals without a notice period, as of ${formatDate(attention.today)} (Europe/Berlin).`
              : 'Notice deadlines and upcoming renewals.'}
          </p>
        </div>
        {items.length > 0 ? (
          <Link href="/workspace/attention" className={`${TEXT_LINK_CLASS} text-[14px]`}>
            {items.length > PANEL_LIMIT
              ? `See all ${items.length} attention items`
              : 'See all attention items'}
          </Link>
        ) : null}
      </div>

      {attention === null ? (
        <p role="alert" className={`${ERROR_CLASS} m-5`}>
          Your attention items could not be loaded. Refresh the page to try again.
        </p>
      ) : shown.length === 0 ? (
        <p className="px-5 py-6 text-[14px] text-muted">
          Nothing needs attention right now: no notice deadline is missed or due within{' '}
          {NOTICE_WINDOW_DAYS} days, no deal renews next quarter, and no upcoming renewal is
          missing its notice period.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((item) => (
            <li
              key={item.deal.id}
              className="flex flex-col gap-2 px-5 py-3.5 transition-colors hover:bg-workspace/50 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
            >
              <div className="min-w-0">
                <Link
                  href={`/workspace/deals/${item.deal.id}`}
                  className={`${TEXT_LINK_CLASS} text-[15px]`}
                >
                  {item.deal.name}
                </Link>
                <p className="mt-0.5 text-[13px] text-muted">
                  {accountNames.get(item.deal.account_id) ?? 'Unknown account'}, renews{' '}
                  {formatDate(item.deal.renewal_date)}, {formatEur(item.deal.arr_eur)} ARR
                </p>
                <p className="mt-0.5 text-[13px]">
                  {item.successors.length > 0 ? (
                    <>
                      Renewed by{' '}
                      {item.successors.map((successor, index) => (
                        <span key={successor.id}>
                          {index > 0 ? ', ' : null}
                          <Link
                            href={`/workspace/deals/${successor.id}`}
                            className={TEXT_LINK_CLASS}
                          >
                            {successor.name}
                          </Link>
                        </span>
                      ))}
                    </>
                  ) : (
                    <span className="text-muted">No renewal deal yet</span>
                  )}
                </p>
              </div>
              <Reasons item={item} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
