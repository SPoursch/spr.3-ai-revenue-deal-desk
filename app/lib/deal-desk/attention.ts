import type { Deal, DealException } from './domain'

/**
 * Feature 7: Attention / Renewal Intelligence V1 — the pure attention module.
 * Contract: docs/sprint-3-domain-index.md §10.
 *
 * Attention is a derived, time-dependent read model (A1): built on every
 * request from the caller's deals, their live exceptions and the current date
 * in Europe/Berlin, and never stored. It raises no exception and leaves the
 * exception applicability model alone: rules stay pure functions of stored
 * deal data, and timing is not a rule.
 *
 * Everything here is deterministic. The current instant is passed in as
 * `now`; nothing reads the clock, the database or a model.
 *
 * Dates follow the Deal Records convention (format.ts): calendar dates are
 * ISO `YYYY-MM-DD` strings without a time of day, so arithmetic on them runs
 * at UTC midnight, where a daylight-saving change cannot shift a day. Only
 * "today" depends on a time zone, and that is Berlin's (U12).
 */

/** A notice deadline this many days ahead or fewer is due soon (A3). */
export const NOTICE_WINDOW_DAYS = 30
/** The optional filter keeps ARR strictly above this (A3, U11). */
export const ARR_FILTER_THRESHOLD_EUR = 50000
/** The one URL value of `?arr=` that turns the filter on. */
export const ARR_FILTER_VALUE = 'over-50k'

const TIME_ZONE = 'Europe/Berlin'
const LIVE_STATUSES: readonly string[] = ['open', 'under_review']

/** Missed, due soon, not due, or no deadline because the notice period is missing. */
export type NoticeStatus = 'missed' | 'due_soon' | 'not_due' | 'cannot_compute'

export type Quarter = { start: string; end: string }

/** One deal that needs attention, with every reason worked out. */
export type AttentionItem = {
  deal: Deal
  /** Renewal date minus notice period, or null when it cannot be computed. */
  noticeDeadline: string | null
  notice: NoticeStatus
  renewsNextQuarter: boolean
  /**
   * Every deal that names this one as its predecessor (U13) — there may be
   * several — by renewal date (undated last), then name. Empty when none does.
   */
  successors: Pick<Deal, 'id' | 'name'>[]
  /** Open and under-review exceptions of the deal. */
  openExceptions: number
}

export type Attention = {
  today: string
  nextQuarter: Quarter
  /** Every listed deal, in attention order. */
  items: AttentionItem[]
  /** The page's sections, each in attention order. */
  sections: {
    noticeDeadlines: AttentionItem[]
    renewingNextQuarter: AttentionItem[]
    cannotCompute: AttentionItem[]
  }
}

const BERLIN_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** The calendar date in Berlin at `now`, as `YYYY-MM-DD`. */
export function todayInBerlin(now: Date): string {
  const parts = Object.fromEntries(BERLIN_DATE.formatToParts(now).map((p) => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function toUtcMidnight(date: string): Date {
  return new Date(`${date}T00:00:00Z`)
}

function addDays(date: string, days: number): string {
  const result = toUtcMidnight(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

/** The calendar quarter after the one `today` falls in, rolling over the year (U12). */
export function nextCalendarQuarter(today: string): Quarter {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const quarter = Math.floor((month - 1) / 3)
  const nextYear = quarter === 3 ? year + 1 : year
  const startMonth = ((quarter + 1) % 4) * 3
  // Day 0 of the month after the quarter is the quarter's last day.
  const start = new Date(Date.UTC(nextYear, startMonth, 1))
  const end = new Date(Date.UTC(nextYear, startMonth + 3, 0))
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

/**
 * Renewal date minus the notice period, in calendar days; a notice period of
 * 0 is the renewal date itself. Null when either is missing.
 */
export function noticeDeadline(deal: Pick<Deal, 'renewal_date' | 'notice_period_days'>): string | null {
  if (deal.renewal_date === null || deal.notice_period_days === null) return null
  return addDays(deal.renewal_date, -deal.notice_period_days)
}

/** Whether `?arr=` holds exactly the known filter value; anything else is off. */
export function parseArrFilter(value: string | string[] | undefined): boolean {
  return value === ARR_FILTER_VALUE
}

function noticeStatus(deadline: string | null, today: string): NoticeStatus {
  if (deadline === null) return 'cannot_compute'
  // Only deals whose renewal is still ahead reach here, so today <= renewal.
  if (deadline < today) return 'missed'
  if (deadline <= addDays(today, NOTICE_WINDOW_DAYS)) return 'due_soon'
  return 'not_due'
}

/** Missed first, then the soonest deadline (none last), the soonest renewal, the name. */
function compareItems(a: AttentionItem, b: AttentionItem): number {
  const missed = Number(b.notice === 'missed') - Number(a.notice === 'missed')
  if (missed !== 0) return missed
  if (a.noticeDeadline !== b.noticeDeadline) {
    if (a.noticeDeadline === null) return 1
    if (b.noticeDeadline === null) return -1
    return a.noticeDeadline < b.noticeDeadline ? -1 : 1
  }
  // Every listed deal has a renewal date.
  const renewal = (a.deal.renewal_date ?? '').localeCompare(b.deal.renewal_date ?? '')
  if (renewal !== 0) return renewal
  return a.deal.name.localeCompare(b.deal.name)
}

/** Successors by renewal date (undated last), then name. */
function compareSuccessors(a: Deal, b: Deal): number {
  if (a.renewal_date !== b.renewal_date) {
    if (a.renewal_date === null) return 1
    if (b.renewal_date === null) return -1
    return a.renewal_date < b.renewal_date ? -1 : 1
  }
  return a.name.localeCompare(b.name)
}

/**
 * The deals that need attention at `now`, with their reasons, in attention
 * order, and grouped into the page's sections.
 *
 * A deal is listed when its renewal is still ahead and either its notice
 * deadline is missed or due soon, it renews next quarter, or its deadline
 * cannot be computed. A deal without a renewal date, or whose renewal date
 * has passed, is not listed. Open exceptions are counted on listed deals but
 * never list a deal on their own.
 */
export function buildAttention({
  deals,
  liveExceptions,
  now,
  overArrThreshold,
}: {
  deals: Deal[]
  liveExceptions: Pick<DealException, 'deal_id' | 'status'>[]
  now: Date
  overArrThreshold: boolean
}): Attention {
  const today = todayInBerlin(now)
  const nextQuarter = nextCalendarQuarter(today)

  const items: AttentionItem[] = []
  for (const deal of deals) {
    const renewal = deal.renewal_date
    if (renewal === null || renewal < today) continue
    if (overArrThreshold && !(deal.arr_eur > ARR_FILTER_THRESHOLD_EUR)) continue

    const deadline = noticeDeadline(deal)
    const notice = noticeStatus(deadline, today)
    const renewsNextQuarter = renewal >= nextQuarter.start && renewal <= nextQuarter.end
    if (notice === 'not_due' && !renewsNextQuarter) continue

    items.push({
      deal,
      noticeDeadline: deadline,
      notice,
      renewsNextQuarter,
      successors: deals
        .filter((other) => other.predecessor_deal_id === deal.id)
        .sort(compareSuccessors)
        .map(({ id, name }) => ({ id, name })),
      openExceptions: liveExceptions.filter(
        (exception) => exception.deal_id === deal.id && LIVE_STATUSES.includes(exception.status),
      ).length,
    })
  }

  items.sort(compareItems)

  return {
    today,
    nextQuarter,
    items,
    sections: {
      noticeDeadlines: items.filter((i) => i.notice === 'missed' || i.notice === 'due_soon'),
      renewingNextQuarter: items.filter((i) => i.renewsNextQuarter),
      cannotCompute: items.filter((i) => i.notice === 'cannot_compute'),
    },
  }
}
