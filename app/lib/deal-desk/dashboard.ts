import { noticeDeadline, type Attention, type AttentionItem } from './attention'
import type { Deal, DealException } from './domain'

/**
 * The /workspace dashboard's figures, derived from data the page already
 * reads: the caller's deals, their live exceptions and the Attention read
 * model (attention.ts). Pure and deterministic; nothing is stored.
 *
 * Only counts are derived. ARR is deliberately not summed: a renewal and its
 * predecessor are both deals, so a total would count the same contract twice.
 */

export type DashboardSummary = {
  totalDeals: number
  /** Deals whose stage is not `closed`. */
  dealsInProgress: number
  /** Live exceptions: open or under review. Null when they could not be read. */
  exceptions: { open: number; high: number; dealsAffected: number } | null
  /** From the Attention read model. Null when it could not be built. */
  attention: {
    noticeMissed: number
    noticeDueSoon: number
    renewingNextQuarter: number
    cannotCompute: number
  } | null
}

export function buildDashboardSummary({
  deals,
  liveExceptions,
  attention,
}: {
  deals: Pick<Deal, 'stage'>[]
  liveExceptions: Pick<DealException, 'deal_id' | 'severity'>[] | null
  attention: Attention | null
}): DashboardSummary {
  return {
    totalDeals: deals.length,
    dealsInProgress: deals.filter((deal) => deal.stage !== 'closed').length,
    exceptions: liveExceptions
      ? {
          open: liveExceptions.length,
          high: liveExceptions.filter((exception) => exception.severity === 'high').length,
          dealsAffected: new Set(liveExceptions.map((exception) => exception.deal_id)).size,
        }
      : null,
    attention: attention
      ? {
          noticeMissed: attention.items.filter((item) => item.notice === 'missed').length,
          noticeDueSoon: attention.items.filter((item) => item.notice === 'due_soon').length,
          renewingNextQuarter: attention.sections.renewingNextQuarter.length,
          cannotCompute: attention.sections.cannotCompute.length,
        }
      : null,
  }
}

/** Live exceptions per deal id, for the deal table's exceptions column. */
export function countExceptionsByDeal(
  liveExceptions: Pick<DealException, 'deal_id'>[],
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const { deal_id } of liveExceptions) {
    counts.set(deal_id, (counts.get(deal_id) ?? 0) + 1)
  }
  return counts
}

/**
 * Attention items by deal id, for the deal table's notice column. Null when
 * Attention could not be built, so the column can say so rather than show
 * every deal as if nothing were due.
 */
export function attentionByDeal(attention: Attention | null): Map<string, AttentionItem> | null {
  return attention ? new Map(attention.items.map((item) => [item.deal.id, item])) : null
}

/**
 * What the deal table's notice column shows for one deal.
 *
 * - `missed`, `due_soon`, `cannot_compute`: the deal is listed by Attention
 *   for that reason; `renewed` when a renewal deal already exists.
 * - `deadline`: not listed; its notice deadline, when it has one.
 * - `none`: no notice deadline (no renewal date or no notice period).
 * - `unavailable`: Attention could not be built (the exceptions read
 *   failed), so the status is unknown. The deal's own deadline is still
 *   given, but never shown as if it were fine.
 */
export type NoticeView =
  | { status: 'missed' | 'due_soon' | 'cannot_compute'; deadline: string | null; renewed: boolean }
  | { status: 'deadline'; deadline: string }
  | { status: 'none' }
  | { status: 'unavailable'; deadline: string | null }

export function noticeView(
  deal: Pick<Deal, 'id' | 'renewal_date' | 'notice_period_days'>,
  byDeal: Map<string, AttentionItem> | null,
): NoticeView {
  if (byDeal === null) return { status: 'unavailable', deadline: noticeDeadline(deal) }

  const item = byDeal.get(deal.id)
  if (item && item.notice !== 'not_due') {
    return { status: item.notice, deadline: item.noticeDeadline, renewed: item.successors.length > 0 }
  }

  const deadline = noticeDeadline(deal)
  return deadline ? { status: 'deadline', deadline } : { status: 'none' }
}
