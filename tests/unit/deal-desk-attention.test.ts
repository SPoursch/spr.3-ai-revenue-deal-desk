import { describe, expect, it } from 'vitest'

import {
  ARR_FILTER_THRESHOLD_EUR,
  ARR_FILTER_VALUE,
  NOTICE_WINDOW_DAYS,
  buildAttention,
  nextCalendarQuarter,
  noticeDeadline,
  parseArrFilter,
  todayInBerlin,
  type AttentionItem,
} from '../../app/lib/deal-desk/attention'
import type { Deal, DealException } from '../../app/lib/deal-desk/domain'

/**
 * Feature 7: Attention / Renewal Intelligence V1 — the pure attention module
 * (app/lib/deal-desk/attention.ts). Contract: docs/sprint-3-domain-index.md
 * §10.
 *
 * Attention is a derived, time-dependent read model (A1): computed from the
 * caller's deals, their live exceptions and the current date in
 * Europe/Berlin, never stored. Everything here is deterministic, with `now`
 * passed in, so these tests need no clock and no database.
 *
 * - Today is the Berlin calendar date; next quarter is the calendar quarter
 *   after today's (U12).
 * - Notice deadline = renewal date − notice period. Missed: deadline < today
 *   ≤ renewal date. Due soon: today ≤ deadline ≤ today + 30 days (A3). No
 *   notice period: cannot compute, never safe.
 * - Not listed: no renewal date, or a renewal date already passed.
 * - ARR > €50,000 is an optional filter (A3, U11); exactly €50,000 is out.
 * - Order: missed first, then soonest deadline, then soonest renewal date,
 *   then name.
 */

/** 1 October 2026, 10:00 in Berlin (CEST, UTC+2). */
const NOW = new Date('2026-10-01T08:00:00Z')
const TODAY = '2026-10-01'

let nextId = 1

/** A deal with only what attention reads set; everything else neutral. */
function deal(name: string, overrides: Partial<Deal> = {}): Deal {
  const id = `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`
  return {
    id,
    account_id: '11111111-1111-4111-8111-111111111111',
    predecessor_deal_id: null,
    name,
    deal_type: 'new_business',
    stage: 'closed',
    arr_eur: 60000,
    tcv_eur: null,
    list_price_eur: null,
    discount_pct: null,
    term_months: 12,
    start_date: null,
    end_date: null,
    renewal_date: null,
    notice_period_days: null,
    auto_renew: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

type LiveException = Pick<DealException, 'deal_id' | 'status' | 'severity'>

function exceptionOn(target: Deal, status: DealException['status']): LiveException {
  return { deal_id: target.id, status, severity: 'high' }
}

function attention(
  deals: Deal[],
  options: { liveExceptions?: LiveException[]; now?: Date; overArrThreshold?: boolean } = {},
) {
  return buildAttention({
    deals,
    liveExceptions: options.liveExceptions ?? [],
    now: options.now ?? NOW,
    overArrThreshold: options.overArrThreshold ?? false,
  })
}

function names(items: AttentionItem[]): string[] {
  return items.map((item) => item.deal.name)
}

function itemOf(items: AttentionItem[], target: Deal): AttentionItem {
  const item = items.find((i) => i.deal.id === target.id)
  if (!item) throw new Error(`${target.name} is not listed`)
  return item
}

describe('the agreed thresholds (A3)', () => {
  it('uses a 30-day notice window and the ARR > €50,000 filter value', () => {
    expect(NOTICE_WINDOW_DAYS).toBe(30)
    expect(ARR_FILTER_THRESHOLD_EUR).toBe(50000)
    expect(ARR_FILTER_VALUE).toBe('over-50k')
  })
})

describe('todayInBerlin', () => {
  it('is the Berlin calendar date, not the UTC one', () => {
    expect(todayInBerlin(NOW)).toBe(TODAY)
    // 22:30 UTC on 31 March is 00:30 on 1 April in Berlin (CEST).
    expect(todayInBerlin(new Date('2026-03-31T22:30:00Z'))).toBe('2026-04-01')
    expect(todayInBerlin(new Date('2026-03-31T21:59:59Z'))).toBe('2026-03-31')
  })

  it('follows the summer and winter offsets', () => {
    // Summer (UTC+2): midnight is 22:00 UTC.
    expect(todayInBerlin(new Date('2026-06-30T21:59:59Z'))).toBe('2026-06-30')
    expect(todayInBerlin(new Date('2026-06-30T22:00:00Z'))).toBe('2026-07-01')
    // Winter (UTC+1): midnight is 23:00 UTC, across the year boundary.
    expect(todayInBerlin(new Date('2026-12-31T22:59:59Z'))).toBe('2026-12-31')
    expect(todayInBerlin(new Date('2026-12-31T23:00:00Z'))).toBe('2027-01-01')
  })

  it('handles the night the clocks change', () => {
    // 29 March 2026: CET → CEST at 01:00 UTC.
    expect(todayInBerlin(new Date('2026-03-28T23:30:00Z'))).toBe('2026-03-29')
    expect(todayInBerlin(new Date('2026-03-29T21:30:00Z'))).toBe('2026-03-29')
    expect(todayInBerlin(new Date('2026-03-29T22:30:00Z'))).toBe('2026-03-30')
  })
})

describe('nextCalendarQuarter', () => {
  it('is the calendar quarter after the one today falls in', () => {
    expect(nextCalendarQuarter('2026-01-15')).toEqual({ start: '2026-04-01', end: '2026-06-30' })
    expect(nextCalendarQuarter('2026-05-20')).toEqual({ start: '2026-07-01', end: '2026-09-30' })
    expect(nextCalendarQuarter('2026-08-01')).toEqual({ start: '2026-10-01', end: '2026-12-31' })
  })

  it('rolls over the year from the fourth quarter', () => {
    expect(nextCalendarQuarter('2026-11-30')).toEqual({ start: '2027-01-01', end: '2027-03-31' })
    expect(nextCalendarQuarter('2026-12-31')).toEqual({ start: '2027-01-01', end: '2027-03-31' })
  })

  it('switches exactly at the first day of a quarter', () => {
    expect(nextCalendarQuarter('2026-03-31')).toEqual({ start: '2026-04-01', end: '2026-06-30' })
    expect(nextCalendarQuarter('2026-04-01')).toEqual({ start: '2026-07-01', end: '2026-09-30' })
  })

  it('is computed from the Berlin date: late on 31 March UTC is already Q2 in Berlin', () => {
    const result = attention([], { now: new Date('2026-03-31T22:30:00Z') })

    expect(result.today).toBe('2026-04-01')
    expect(result.nextQuarter).toEqual({ start: '2026-07-01', end: '2026-09-30' })
  })
})

describe('noticeDeadline', () => {
  it('is the renewal date minus the notice period, in calendar days', () => {
    expect(noticeDeadline({ renewal_date: '2026-12-15', notice_period_days: 60 })).toBe('2026-10-16')
    expect(noticeDeadline({ renewal_date: '2027-01-10', notice_period_days: 15 })).toBe('2026-12-26')
    // Across a leap day.
    expect(noticeDeadline({ renewal_date: '2028-03-01', notice_period_days: 1 })).toBe('2028-02-29')
    // Across a daylight-saving change.
    expect(noticeDeadline({ renewal_date: '2026-04-05', notice_period_days: 10 })).toBe('2026-03-26')
  })

  it('is the renewal date itself for a notice period of 0', () => {
    expect(noticeDeadline({ renewal_date: '2026-10-20', notice_period_days: 0 })).toBe('2026-10-20')
  })

  it('cannot be computed without a notice period or a renewal date', () => {
    expect(noticeDeadline({ renewal_date: '2026-12-15', notice_period_days: null })).toBeNull()
    expect(noticeDeadline({ renewal_date: null, notice_period_days: 30 })).toBeNull()
  })
})

describe('notice status', () => {
  it('is missed when the deadline has passed but the renewal has not', () => {
    // Deadline 16 Sep 2026.
    const missed = deal('Missed', { renewal_date: '2026-11-15', notice_period_days: 60 })
    // Renewal today; deadline 21 Sep 2026.
    const renewsToday = deal('Renews today', { renewal_date: TODAY, notice_period_days: 10 })

    const { items, sections } = attention([missed, renewsToday])

    expect(itemOf(items, missed)).toMatchObject({ notice: 'missed', noticeDeadline: '2026-09-16' })
    expect(itemOf(items, renewsToday)).toMatchObject({ notice: 'missed', noticeDeadline: '2026-09-21' })
    expect(names(sections.noticeDeadlines)).toEqual(['Missed', 'Renews today'])
  })

  it('is due soon from today up to and including today + 30 days', () => {
    // Deadline 16 Oct; deadline 31 Oct (today + 30); deadline today.
    const dueSoon = deal('Due soon', { renewal_date: '2026-12-15', notice_period_days: 60 })
    const lastDay = deal('Last day of window', { renewal_date: '2026-12-30', notice_period_days: 60 })
    const deadlineToday = deal('Deadline today', { renewal_date: '2026-11-30', notice_period_days: 60 })

    const { items } = attention([dueSoon, lastDay, deadlineToday])

    expect(itemOf(items, dueSoon)).toMatchObject({ notice: 'due_soon', noticeDeadline: '2026-10-16' })
    expect(itemOf(items, lastDay)).toMatchObject({ notice: 'due_soon', noticeDeadline: '2026-10-31' })
    expect(itemOf(items, deadlineToday)).toMatchObject({ notice: 'due_soon', noticeDeadline: TODAY })
  })

  it('is not due beyond the 30-day window, and such a deal is not listed for its notice', () => {
    // Deadline 1 Nov 2026 (today + 31); renewal 31 Dec, not next quarter.
    const outside = deal('Outside window', { renewal_date: '2026-12-31', notice_period_days: 60 })

    const { items, sections } = attention([outside])

    expect(items).toEqual([])
    expect(sections.noticeDeadlines).toEqual([])
  })

  it('treats a notice period of 0 as a deadline on the renewal date', () => {
    const zero = deal('Zero notice', { renewal_date: '2026-10-20', notice_period_days: 0 })

    const { items } = attention([zero])

    expect(itemOf(items, zero)).toMatchObject({ notice: 'due_soon', noticeDeadline: '2026-10-20' })
  })

  it('cannot compute a deadline without a notice period, and never treats that as safe', () => {
    // Far beyond next quarter, and no notice period: still listed, as a gap.
    const farGap = deal('Far gap', { renewal_date: '2028-06-30', notice_period_days: null })
    // In next quarter and no notice period: listed in both sections.
    const nearGap = deal('Near gap', { renewal_date: '2027-02-01', notice_period_days: null })

    const { items, sections } = attention([farGap, nearGap])

    for (const gap of [farGap, nearGap]) {
      const item = itemOf(items, gap)
      expect(item.notice).toBe('cannot_compute')
      expect(item.notice).not.toBe('not_due')
      expect(item.noticeDeadline).toBeNull()
    }
    expect(names(sections.cannotCompute)).toEqual(['Near gap', 'Far gap'])
    expect(sections.noticeDeadlines).toEqual([])
    expect(names(sections.renewingNextQuarter)).toEqual(['Near gap'])
  })
})

describe('which deals are listed', () => {
  it('lists a deal renewing next quarter, whatever its notice deadline', () => {
    // Next quarter is 1 Jan – 31 Mar 2027; deadline 16 Jan 2027 is not due.
    const nextQuarter = deal('Next quarter', { renewal_date: '2027-02-15', notice_period_days: 30 })
    const quarterStart = deal('Quarter start', { renewal_date: '2027-01-01', notice_period_days: 0 })
    const quarterEnd = deal('Quarter end', { renewal_date: '2027-03-31', notice_period_days: 0 })
    const afterQuarter = deal('After quarter', { renewal_date: '2027-04-01', notice_period_days: 0 })

    const { items, sections } = attention([nextQuarter, quarterStart, quarterEnd, afterQuarter])

    expect(itemOf(items, nextQuarter)).toMatchObject({ renewsNextQuarter: true, notice: 'not_due' })
    expect(names(sections.renewingNextQuarter)).toEqual(['Quarter start', 'Next quarter', 'Quarter end'])
    expect(names(items)).not.toContain('After quarter')
  })

  it('excludes deals without a renewal date', () => {
    const noDate = deal('No renewal date', { renewal_date: null, notice_period_days: 30 })
    const noData = deal('No renewal data', { renewal_date: null, notice_period_days: null })

    const { items, sections } = attention([noDate, noData])

    expect(items).toEqual([])
    expect(sections.cannotCompute).toEqual([])
  })

  it('excludes deals whose renewal date has passed', () => {
    const passed = deal('Passed', { renewal_date: '2026-09-30', notice_period_days: 30 })
    const passedGap = deal('Passed gap', { renewal_date: '2026-09-30', notice_period_days: null })

    expect(attention([passed, passedGap]).items).toEqual([])
  })
})

describe('the ARR filter (A3)', () => {
  const over = deal('Over', { arr_eur: 50000.01, renewal_date: '2027-02-15', notice_period_days: 30 })
  const exact = deal('Exactly 50k', { arr_eur: 50000, renewal_date: '2027-02-16', notice_period_days: 30 })
  const under = deal('Under', { arr_eur: 49999.99, renewal_date: '2027-02-17', notice_period_days: 30 })

  it('lists every deal when the filter is off', () => {
    expect(names(attention([over, exact, under]).items)).toEqual(['Over', 'Exactly 50k', 'Under'])
  })

  it('keeps only ARR strictly above €50,000 when it is on; exactly €50,000 is excluded', () => {
    const { items, sections } = attention([over, exact, under], { overArrThreshold: true })

    expect(names(items)).toEqual(['Over'])
    expect(names(sections.renewingNextQuarter)).toEqual(['Over'])
  })

  it('is read only from the one known URL value; anything else leaves it off', () => {
    expect(parseArrFilter('over-50k')).toBe(true)
    for (const value of [undefined, '', 'over-50K', 'over-50k ', 'true', '1', 'over-100k']) {
      expect(parseArrFilter(value)).toBe(false)
    }
    // A repeated parameter is not the known value.
    expect(parseArrFilter(['over-50k', 'over-50k'])).toBe(false)
  })
})

describe('renewal lineage (U13)', () => {
  it('links a listed deal to the deal that renews it, and says when none does', () => {
    const renewed = deal('Renewed', { renewal_date: '2027-02-15', notice_period_days: 30 })
    const notRenewed = deal('Not renewed', { renewal_date: '2027-02-16', notice_period_days: 30 })
    const renewal = deal('Renewed 2027', {
      deal_type: 'renewal',
      predecessor_deal_id: renewed.id,
      stage: 'negotiation',
    })

    const { items } = attention([renewed, notRenewed, renewal])

    expect(itemOf(items, renewed).successors).toEqual([{ id: renewal.id, name: 'Renewed 2027' }])
    expect(itemOf(items, notRenewed).successors).toEqual([])
    // The successor itself has no renewal date, so it is not listed.
    expect(names(items)).not.toContain('Renewed 2027')
  })

  it('shows every successor of a deal, never just the first: by renewal date, undated last, then name', () => {
    const renewed = deal('Renewed twice', { renewal_date: '2027-02-15', notice_period_days: 30 })
    // Renewal dates in mid-2027: neither due nor next quarter, so not listed themselves.
    const successor = (name: string, renewal_date: string | null) =>
      deal(name, { deal_type: 'renewal', predecessor_deal_id: renewed.id, renewal_date, notice_period_days: 30 })
    const zeta = successor('Zeta renewal', '2027-06-01')
    const undated = successor('Undated renewal', null)
    const early = successor('Early renewal', '2027-05-01')
    const anotherUndated = successor('Another undated renewal', null)
    const alpha = successor('Alpha renewal', '2027-06-01')

    const { items } = attention([zeta, undated, renewed, early, anotherUndated, alpha])

    expect(itemOf(items, renewed).successors).toEqual(
      [early, alpha, zeta, anotherUndated, undated].map(({ id, name }) => ({ id, name })),
    )
    expect(names(items)).toEqual(['Renewed twice'])
  })
})

describe('open exceptions', () => {
  it('counts only open and under-review exceptions of each listed deal', () => {
    const withExceptions = deal('With exceptions', { renewal_date: '2027-02-15', notice_period_days: 30 })
    const closedOnly = deal('Closed only', { renewal_date: '2027-02-16', notice_period_days: 30 })
    const none = deal('None', { renewal_date: '2027-02-17', notice_period_days: 30 })

    const { items } = attention([withExceptions, closedOnly, none], {
      liveExceptions: [
        exceptionOn(withExceptions, 'open'),
        exceptionOn(withExceptions, 'under_review'),
        exceptionOn(withExceptions, 'decided'),
        exceptionOn(closedOnly, 'dismissed'),
        exceptionOn(closedOnly, 'decided'),
      ],
    })

    expect(itemOf(items, withExceptions).openExceptions).toBe(2)
    expect(itemOf(items, closedOnly).openExceptions).toBe(0)
    expect(itemOf(items, none).openExceptions).toBe(0)
  })

  it('shows the count on a listed deal, but does not list a deal for its exceptions alone (§10)', () => {
    // Renews in 2028 with a 90-day notice: no timing signal.
    const quiet = deal('Quiet', { renewal_date: '2028-01-01', notice_period_days: 90 })

    const { items } = attention([quiet], { liveExceptions: [exceptionOn(quiet, 'open')] })

    expect(items).toEqual([])
  })
})

describe('the order of attention items', () => {
  it('puts missed deadlines first, then the soonest deadline, then the soonest renewal, then the name', () => {
    const deals = [
      deal('Cannot compute later', { renewal_date: '2027-03-20', notice_period_days: null }),
      deal('Next quarter, same deadline, later renewal', {
        renewal_date: '2027-03-17',
        notice_period_days: 60,
      }),
      deal('Due soon, 31 Oct', { renewal_date: '2026-12-30', notice_period_days: 60 }),
      deal('Beta, 16 Oct', { renewal_date: '2026-12-15', notice_period_days: 60 }),
      deal('Next quarter, same deadline, earlier renewal', {
        renewal_date: '2027-02-15',
        notice_period_days: 30,
      }),
      deal('Alpha, 16 Oct', { renewal_date: '2026-12-15', notice_period_days: 60 }),
      deal('Cannot compute sooner', { renewal_date: '2027-01-20', notice_period_days: null }),
      deal('Missed, 21 Sep', { renewal_date: TODAY, notice_period_days: 10 }),
      deal('Missed, 16 Sep', { renewal_date: '2026-11-15', notice_period_days: 60 }),
    ]

    expect(names(attention(deals).items)).toEqual([
      'Missed, 16 Sep',
      'Missed, 21 Sep',
      'Alpha, 16 Oct',
      'Beta, 16 Oct',
      'Due soon, 31 Oct',
      // Both deadlines 16 Jan 2027: the earlier renewal first.
      'Next quarter, same deadline, earlier renewal',
      'Next quarter, same deadline, later renewal',
      // No deadline: after every deadline, by renewal date.
      'Cannot compute sooner',
      'Cannot compute later',
    ])
  })

  it('reports the today and next-quarter range it used', () => {
    const result = attention([])

    expect(result.today).toBe(TODAY)
    expect(result.nextQuarter).toEqual({ start: '2027-01-01', end: '2027-03-31' })
    expect(result.items).toEqual([])
    expect(result.sections).toEqual({ noticeDeadlines: [], renewingNextQuarter: [], cannotCompute: [] })
  })
})
