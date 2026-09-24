import { describe, expect, it } from 'vitest'

import {
  DEAL_STAGES,
  DEAL_TYPES,
  isDealStage,
  isDealType,
} from '../../app/lib/deal-desk/domain'

/**
 * The vocabularies mirror the check constraints on `public.deals` in the
 * canonical M3 migration (deals_deal_type_check, deals_stage_check). The
 * expected lists are spelled out here, not derived from the constants, so a
 * change to either side has to be made deliberately.
 */
describe('deal vocabulary', () => {
  it('lists exactly the deal types the database accepts', () => {
    expect([...DEAL_TYPES]).toEqual([
      'new_business',
      'renewal',
      'expansion',
      'amendment',
    ])
  })

  it('lists exactly the deal stages the database accepts', () => {
    expect([...DEAL_STAGES]).toEqual([
      'discovery',
      'negotiation',
      'contracting',
      'closed',
    ])
  })

  it.each(DEAL_TYPES)('accepts the deal type %s', (value) => {
    expect(isDealType(value)).toBe(true)
  })

  it.each(DEAL_STAGES)('accepts the deal stage %s', (value) => {
    expect(isDealStage(value)).toBe(true)
  })

  it.each([
    'Renewal',
    ' renewal',
    'renewal ',
    'new business',
    'discovery',
    '',
    null,
    undefined,
    1,
    {},
  ])('rejects %j as a deal type', (value) => {
    expect(isDealType(value)).toBe(false)
  })

  it.each([
    'Closed',
    ' closed',
    'closed_won',
    'renewal',
    '',
    null,
    undefined,
    0,
    [],
  ])('rejects %j as a deal stage', (value) => {
    expect(isDealStage(value)).toBe(false)
  })
})
