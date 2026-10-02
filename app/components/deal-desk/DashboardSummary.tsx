import type { Quarter } from '@/app/lib/deal-desk/attention'
import type { DashboardSummary as Summary } from '@/app/lib/deal-desk/dashboard'
import { formatDate, formatNumber } from '@/app/lib/deal-desk/format'

import { CARD_CLASS } from './styles'

/**
 * The figures at the top of /workspace: counts derived from the caller's own
 * deals, live exceptions and Attention (app/lib/deal-desk/dashboard.ts).
 *
 * A figure whose source could not be read shows a dash and says so, never a
 * zero, so a failed load cannot pass for "nothing to do".
 */

const UNAVAILABLE = 'Could not be loaded'

function Figure({
  label,
  value,
  detail,
  urgent = false,
}: {
  label: string
  value: number | null
  detail: string
  /** Shown in the danger colour: something is already late. */
  urgent?: boolean
}) {
  return (
    <div className="flex flex-col gap-1 bg-pane px-5 py-4">
      <dt className="text-[13px] font-medium text-muted">{label}</dt>
      <dd
        className={`text-[28px] leading-tight font-semibold tracking-tight tabular-nums ${
          urgent ? 'text-danger' : 'text-foreground'
        }`}
      >
        {value ?? '—'}
      </dd>
      <dd className="text-[13px] text-muted">{detail}</dd>
    </div>
  )
}

export function DashboardSummary({
  summary,
  nextQuarter,
}: {
  summary: Summary
  /** The quarter "Renewing next quarter" counts, when Attention was built. */
  nextQuarter: Quarter | null
}) {
  const { exceptions, attention } = summary

  return (
    <section aria-label="Summary" className={`${CARD_CLASS} overflow-hidden`}>
      <dl className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
        <Figure
          label="Deals in progress"
          value={summary.dealsInProgress}
          detail={`of ${formatNumber(summary.totalDeals, 'deal')} in total`}
        />
        <Figure
          label="Open exceptions"
          value={exceptions?.open ?? null}
          detail={
            exceptions === null
              ? UNAVAILABLE
              : exceptions.open === 0
                ? 'None waiting for a decision'
                : exceptions.high === 0
                  ? `On ${formatNumber(exceptions.dealsAffected, 'deal')}`
                  : `${exceptions.high} high severity, on ${formatNumber(exceptions.dealsAffected, 'deal')}`
          }
        />
        <Figure
          label="Notice deadlines"
          value={attention ? attention.noticeMissed + attention.noticeDueSoon : null}
          urgent={(attention?.noticeMissed ?? 0) > 0}
          detail={
            attention === null
              ? UNAVAILABLE
              : `${attention.noticeMissed} missed, ${attention.noticeDueSoon} due within 30 days${
                  attention.cannotCompute > 0
                    ? `, ${formatNumber(attention.cannotCompute, 'renewal')} without a notice period`
                    : ''
                }`
          }
        />
        <Figure
          label="Renewing next quarter"
          value={attention?.renewingNextQuarter ?? null}
          detail={
            attention === null || nextQuarter === null
              ? UNAVAILABLE
              : `${formatDate(nextQuarter.start)} – ${formatDate(nextQuarter.end)}`
          }
        />
      </dl>
    </section>
  )
}
