import { describe, expect, it } from 'vitest'

import {
  DEAL_STAGE_LABELS,
  DEAL_TYPE_LABELS,
  EVIDENCE_TYPE_LABELS,
  formatBoolean,
  formatDate,
  formatEur,
  formatNumber,
  formatPercent,
} from '../../app/lib/deal-desk/format'
import { DEAL_STAGES, DEAL_TYPES, EVIDENCE_TYPES } from '../../app/lib/deal-desk/domain'

/** Display helpers for Deal Records (slice 1). A missing value reads "Not set". */

describe('formatEur', () => {
  it.each([
    [60000, '€60,000.00'],
    [60000.5, '€60,000.50'],
    [0, '€0.00'],
    [null, 'Not set'],
  ])('formats %j as %j', (value, expected) => {
    expect(formatEur(value)).toBe(expected)
  })
})

describe('formatDate', () => {
  it.each([
    ['2027-03-31', '31 Mar 2027'],
    ['2026-01-01', '1 Jan 2026'],
    [null, 'Not set'],
  ])('formats %j as %j, independent of the server time zone', (value, expected) => {
    expect(formatDate(value)).toBe(expected)
  })
})

describe('the other formatters', () => {
  it('formats percentages, counts and three-state booleans', () => {
    expect(formatPercent(20.5)).toBe('20.5%')
    expect(formatPercent(null)).toBe('Not set')
    expect(formatNumber(null, 'day')).toBe('Not set')
    expect(formatBoolean(true)).toBe('Yes')
    expect(formatBoolean(false)).toBe('No')
    expect(formatBoolean(null)).toBe('Not set')
  })
})

describe('formatNumber', () => {
  it.each([
    [1, 'month', '1 month'],
    [2, 'month', '2 months'],
    [36, 'month', '36 months'],
    [1, 'day', '1 day'],
    [2, 'day', '2 days'],
    [0, 'day', '0 days'],
  ])('formats %j %s as %j', (value, unit, expected) => {
    expect(formatNumber(value, unit)).toBe(expected)
  })
})

describe('vocabulary labels', () => {
  it('labels every deal type and stage', () => {
    expect(Object.keys(DEAL_TYPE_LABELS).sort()).toEqual([...DEAL_TYPES].sort())
    expect(Object.keys(DEAL_STAGE_LABELS).sort()).toEqual([...DEAL_STAGES].sort())
    expect(DEAL_TYPE_LABELS.new_business).toBe('New business')
    expect(DEAL_STAGE_LABELS.negotiation).toBe('Negotiation')
  })

  it('labels every evidence type', () => {
    expect(Object.keys(EVIDENCE_TYPE_LABELS).sort()).toEqual([...EVIDENCE_TYPES].sort())
    expect(EVIDENCE_TYPE_LABELS.order_form).toBe('Order form')
    expect(EVIDENCE_TYPE_LABELS.call_note).toBe('Call note')
  })
})
