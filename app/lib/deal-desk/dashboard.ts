import type { Attention, AttentionItem } from './attention'
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

/** Attention items by deal id, for the deal table's notice column. */
export function attentionByDeal(attention: Attention | null): Map<string, AttentionItem> {
  return new Map((attention?.items ?? []).map((item) => [item.deal.id, item]))
}
