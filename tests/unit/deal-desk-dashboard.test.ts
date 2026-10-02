import { describe, expect, it } from 'vitest'

import { buildAttention } from '../../app/lib/deal-desk/attention'
import {
  attentionByDeal,
  buildDashboardSummary,
  countExceptionsByDeal,
  noticeView,
} from '../../app/lib/deal-desk/dashboard'
import type { Deal, DealException } from '../../app/lib/deal-desk/domain'

/**
 * The /workspace dashboard figures (app/lib/deal-desk/dashboard.ts): counts
 * derived from the caller's deals, live exceptions and the Attention read
 * model. Pure, so no clock and no database.
 */

/** 1 October 2026, 10:00 in Berlin; next quarter is Q1 2027. */
const NOW = new Date('2026-10-01T08:00:00Z')

let nextId = 1

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

function exceptionOn(target: Deal, severity: DealException['severity']): LiveException {
  return { deal_id: target.id, status: 'open', severity }
}

// Notice deadline 2026-09-01: missed.
const missed = deal('Missed', { renewal_date: '2026-12-01', notice_period_days: 91 })
// Notice deadline 2026-10-15: due soon.
const dueSoon = deal('Due soon', {
  stage: 'negotiation',
  renewal_date: '2026-11-14',
  notice_period_days: 30,
})
// Renews in Q1 2027 with no notice period: next quarter and cannot compute.
const nextQuarter = deal('Next quarter', { stage: 'discovery', renewal_date: '2027-02-01' })
// Not listed: no renewal date.
const quiet = deal('Quiet', { stage: 'contracting' })

const deals = [missed, dueSoon, nextQuarter, quiet]
const liveExceptions = [
  exceptionOn(dueSoon, 'high'),
  exceptionOn(dueSoon, 'low'),
  exceptionOn(quiet, 'medium'),
]
const attention = buildAttention({ deals, liveExceptions, now: NOW, overArrThreshold: false })

describe('buildDashboardSummary', () => {
  it('counts deals, and deals in progress as every stage but closed', () => {
    const summary = buildDashboardSummary({ deals, liveExceptions, attention })
    expect(summary.totalDeals).toBe(4)
    expect(summary.dealsInProgress).toBe(3)
  })

  it('counts live exceptions, the high-severity ones and the deals they are on', () => {
    expect(buildDashboardSummary({ deals, liveExceptions, attention }).exceptions).toEqual({
      open: 3,
      high: 1,
      dealsAffected: 2,
    })
  })

  it('takes the attention counts from the Attention read model', () => {
    expect(buildDashboardSummary({ deals, liveExceptions, attention }).attention).toEqual({
      noticeMissed: 1,
      noticeDueSoon: 1,
      renewingNextQuarter: 1,
      cannotCompute: 1,
    })
  })

  it('reports a failed read as null, never as zero', () => {
    const summary = buildDashboardSummary({ deals, liveExceptions: null, attention: null })
    expect(summary.exceptions).toBeNull()
    expect(summary.attention).toBeNull()
    expect(summary.totalDeals).toBe(4)
  })

  it('is all zeros for a user with no deals', () => {
    const empty = buildAttention({ deals: [], liveExceptions: [], now: NOW, overArrThreshold: false })
    expect(buildDashboardSummary({ deals: [], liveExceptions: [], attention: empty })).toEqual({
      totalDeals: 0,
      dealsInProgress: 0,
      exceptions: { open: 0, high: 0, dealsAffected: 0 },
      attention: { noticeMissed: 0, noticeDueSoon: 0, renewingNextQuarter: 0, cannotCompute: 0 },
    })
  })
})

describe('per-deal lookups', () => {
  it('counts live exceptions per deal', () => {
    const counts = countExceptionsByDeal(liveExceptions)
    expect(counts.get(dueSoon.id)).toBe(2)
    expect(counts.get(quiet.id)).toBe(1)
    expect(counts.has(missed.id)).toBe(false)
  })

  it('indexes attention items by deal, and only listed deals', () => {
    const byDeal = attentionByDeal(attention)
    expect(byDeal?.get(missed.id)?.notice).toBe('missed')
    expect(byDeal?.get(dueSoon.id)?.notice).toBe('due_soon')
    expect(byDeal?.has(quiet.id)).toBe(false)
  })

  it('has no index when Attention could not be built, rather than an empty one', () => {
    expect(attentionByDeal(null)).toBeNull()
  })
})

describe('noticeView: the deal table notice column', () => {
  const byDeal = attentionByDeal(attention)

  it('shows a missed and a due-soon deadline with the date Attention worked out', () => {
    expect(noticeView(missed, byDeal)).toEqual({
      status: 'missed',
      deadline: '2026-09-01',
      renewed: false,
    })
    expect(noticeView(dueSoon, byDeal)).toEqual({
      status: 'due_soon',
      deadline: '2026-10-15',
      renewed: false,
    })
  })

  it('shows a missing notice period as cannot compute', () => {
    expect(noticeView(nextQuarter, byDeal)).toMatchObject({ status: 'cannot_compute' })
  })

  it('says when a renewal deal already exists', () => {
    const renewal = deal('Missed renewal', { deal_type: 'renewal', predecessor_deal_id: missed.id })
    const withRenewal = buildAttention({
      deals: [...deals, renewal],
      liveExceptions,
      now: NOW,
      overArrThreshold: false,
    })
    expect(noticeView(missed, attentionByDeal(withRenewal))).toMatchObject({
      status: 'missed',
      renewed: true,
    })
  })

  it('shows the deadline of a deal Attention does not list, or none', () => {
    const later = deal('Later', { renewal_date: '2028-06-30', notice_period_days: 30 })
    const laterAttention = buildAttention({
      deals: [later],
      liveExceptions: [],
      now: NOW,
      overArrThreshold: false,
    })
    expect(noticeView(later, attentionByDeal(laterAttention))).toEqual({
      status: 'deadline',
      deadline: '2028-05-31',
    })
    expect(noticeView(quiet, byDeal)).toEqual({ status: 'none' })
  })

  it('is unavailable when the exceptions read failed, never a normal-looking deadline', () => {
    // Attention could not be built, so there is no index: a missed deadline
    // must not read as an ordinary date.
    expect(noticeView(missed, null)).toEqual({ status: 'unavailable', deadline: '2026-09-01' })
    expect(noticeView(quiet, null)).toEqual({ status: 'unavailable', deadline: null })
  })
})
