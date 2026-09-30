import { describe, expect, it } from 'vitest'

import {
  RULES,
  evaluateDeal,
  exceptionApplicability,
  exceptionsToRaise,
  type RuleInput,
} from '../../app/lib/deal-desk/rules'
import type { ExceptionStatus, ProvisionValueUnit } from '../../app/lib/deal-desk/domain'

/**
 * The Deal Desk rule registry, V1 (Rules → Exceptions → Decisions).
 *
 * Rules are fixed, versioned application logic (U3), and every condition is
 * deterministic: pure functions over one deal's stored data, so these tests
 * need no database. The business thresholds are fixed by the product owner:
 *
 * - discount_above_20_pct         deal.discount_pct > 20
 * - liability_cap_below_12_months liability cap < 12 months of fees (an EUR
 *                                 cap is compared with the deal's ARR)
 * - payment_terms_over_net_30     payment terms > 30 days
 * - renewal_price_decrease        a renewal's ARR < its predecessor's (any drop)
 *
 * Each rule either holds, does not hold, or cannot be evaluated because the
 * data it needs is missing or not in a comparable unit. Only a rule that
 * holds can raise an exception.
 */

const LIABILITY_ID = '11111111-1111-4111-8111-111111111111'
const PAYMENT_ID = '22222222-2222-4222-8222-222222222222'

/** A deal's input for the rules: new business, EUR 60,000 ARR, nothing else. */
function input(overrides: {
  deal?: Partial<RuleInput['deal']>
  provisions?: RuleInput['provisions']
  predecessor?: RuleInput['predecessor']
} = {}): RuleInput {
  return {
    deal: { deal_type: 'new_business', arr_eur: 60000, discount_pct: null, ...overrides.deal },
    provisions: overrides.provisions ?? [],
    predecessor: overrides.predecessor ?? null,
  }
}

function liabilityCap(value_numeric: number | null, value_unit: ProvisionValueUnit | null) {
  return { id: LIABILITY_ID, provision_type: 'liability_cap', value_numeric, value_unit } as const
}

function paymentTerms(value_numeric: number | null, value_unit: ProvisionValueUnit | null) {
  return { id: PAYMENT_ID, provision_type: 'payment_terms', value_numeric, value_unit } as const
}

/** The outcome of one rule for `ruleInput`. */
function outcomeOf(ruleKey: string, ruleInput: RuleInput) {
  const evaluation = evaluateDeal(ruleInput).find((e) => e.rule_key === ruleKey)
  if (!evaluation) throw new Error(`no evaluation for ${ruleKey}`)
  return evaluation
}

describe('the V1 rule registry', () => {
  it('holds exactly the four agreed rules, at version "1", with their kind and severity', () => {
    expect(
      RULES.map(({ rule_key, rule_version, kind, severity }) => ({
        rule_key,
        rule_version,
        kind,
        severity,
      })),
    ).toEqual([
      { rule_key: 'discount_above_20_pct', rule_version: '1', kind: 'threshold_breach', severity: 'medium' },
      { rule_key: 'liability_cap_below_12_months', rule_version: '1', kind: 'non_standard_provision', severity: 'high' },
      { rule_key: 'payment_terms_over_net_30', rule_version: '1', kind: 'non_standard_provision', severity: 'medium' },
      { rule_key: 'renewal_price_decrease', rule_version: '1', kind: 'commercial_risk', severity: 'high' },
    ])
  })

  it('evaluates every rule for a deal, in registry order', () => {
    expect(evaluateDeal(input()).map((e) => e.rule_key)).toEqual(RULES.map((r) => r.rule_key))
  })

  it('is deterministic', () => {
    const ruleInput = input({ deal: { discount_pct: 25 } })
    expect(evaluateDeal(ruleInput)).toEqual(evaluateDeal(ruleInput))
  })
})

describe('discount_above_20_pct', () => {
  it('holds above 20 %, stating the discount in its why', () => {
    const evaluation = outcomeOf('discount_above_20_pct', input({ deal: { discount_pct: 25 } }))

    expect(evaluation.outcome).toBe('holds')
    expect(evaluation.title).toBeTruthy()
    expect(evaluation.why).toContain('25')
    expect(evaluation.why).toContain('20')
    expect(evaluation.provision_id).toBeNull()
  })

  it('does not hold at exactly 20 % or below', () => {
    expect(outcomeOf('discount_above_20_pct', input({ deal: { discount_pct: 20 } })).outcome).toBe(
      'does_not_hold',
    )
    expect(outcomeOf('discount_above_20_pct', input({ deal: { discount_pct: 0 } })).outcome).toBe(
      'does_not_hold',
    )
    expect(outcomeOf('discount_above_20_pct', input({ deal: { discount_pct: 20.01 } })).outcome).toBe(
      'holds',
    )
  })

  it('cannot be evaluated without a discount', () => {
    expect(outcomeOf('discount_above_20_pct', input()).outcome).toBe('cannot_evaluate')
  })
})

describe('liability_cap_below_12_months', () => {
  const rule = 'liability_cap_below_12_months'

  it('holds below 12 months of fees, pointing at the provision', () => {
    const evaluation = outcomeOf(rule, input({ provisions: [liabilityCap(6, 'months_of_fees')] }))

    expect(evaluation.outcome).toBe('holds')
    expect(evaluation.provision_id).toBe(LIABILITY_ID)
    expect(evaluation.why).toContain('6')
    expect(evaluation.why).toContain('12')
  })

  it('does not hold at exactly 12 months or above', () => {
    expect(outcomeOf(rule, input({ provisions: [liabilityCap(12, 'months_of_fees')] })).outcome).toBe(
      'does_not_hold',
    )
    expect(outcomeOf(rule, input({ provisions: [liabilityCap(11.99, 'months_of_fees')] })).outcome).toBe(
      'holds',
    )
  })

  it('compares an EUR cap with the deal ARR, twelve months of fees', () => {
    expect(outcomeOf(rule, input({ provisions: [liabilityCap(59999.99, 'eur')] })).outcome).toBe('holds')
    expect(outcomeOf(rule, input({ provisions: [liabilityCap(60000, 'eur')] })).outcome).toBe(
      'does_not_hold',
    )
    // With no ARR, no EUR cap is below twelve months of fees.
    expect(
      outcomeOf(rule, input({ deal: { arr_eur: 0 }, provisions: [liabilityCap(0, 'eur')] })).outcome,
    ).toBe('does_not_hold')
  })

  it('cannot be evaluated without a liability cap, a number, or a comparable unit', () => {
    expect(outcomeOf(rule, input()).outcome).toBe('cannot_evaluate')
    expect(outcomeOf(rule, input({ provisions: [liabilityCap(null, null)] })).outcome).toBe(
      'cannot_evaluate',
    )
    expect(outcomeOf(rule, input({ provisions: [liabilityCap(6, 'days')] })).outcome).toBe(
      'cannot_evaluate',
    )
    expect(outcomeOf(rule, input({ provisions: [liabilityCap(1, 'region')] })).outcome).toBe(
      'cannot_evaluate',
    )
  })
})

describe('payment_terms_over_net_30', () => {
  const rule = 'payment_terms_over_net_30'

  it('holds above 30 days, pointing at the provision', () => {
    const evaluation = outcomeOf(rule, input({ provisions: [paymentTerms(45, 'days')] }))

    expect(evaluation.outcome).toBe('holds')
    expect(evaluation.provision_id).toBe(PAYMENT_ID)
    expect(evaluation.why).toContain('45')
    expect(evaluation.why).toContain('30')
  })

  it('does not hold at exactly Net 30 or below', () => {
    expect(outcomeOf(rule, input({ provisions: [paymentTerms(30, 'days')] })).outcome).toBe('does_not_hold')
    expect(outcomeOf(rule, input({ provisions: [paymentTerms(31, 'days')] })).outcome).toBe('holds')
  })

  it('cannot be evaluated without payment terms, a number, or days', () => {
    expect(outcomeOf(rule, input()).outcome).toBe('cannot_evaluate')
    expect(outcomeOf(rule, input({ provisions: [paymentTerms(null, null)] })).outcome).toBe(
      'cannot_evaluate',
    )
    expect(outcomeOf(rule, input({ provisions: [paymentTerms(45, 'percent')] })).outcome).toBe(
      'cannot_evaluate',
    )
  })
})

describe('renewal_price_decrease', () => {
  const rule = 'renewal_price_decrease'
  const renewal = (arr: number, predecessorArr: number) =>
    input({ deal: { deal_type: 'renewal', arr_eur: arr }, predecessor: { arr_eur: predecessorArr } })

  it('holds for any decrease from the predecessor, stating both values', () => {
    const evaluation = outcomeOf(rule, renewal(59999.99, 60000))

    expect(evaluation.outcome).toBe('holds')
    expect(evaluation.provision_id).toBeNull()
    expect(outcomeOf(rule, renewal(50000, 60000)).why).toMatch(/50[,.]?000/)
  })

  it('does not hold for the same or a higher ARR', () => {
    expect(outcomeOf(rule, renewal(60000, 60000)).outcome).toBe('does_not_hold')
    expect(outcomeOf(rule, renewal(66000, 60000)).outcome).toBe('does_not_hold')
  })

  it('cannot be evaluated for a deal that is not a renewal, or without its predecessor', () => {
    expect(outcomeOf(rule, input({ predecessor: { arr_eur: 90000 } })).outcome).toBe('cannot_evaluate')
    expect(
      outcomeOf(rule, input({ deal: { deal_type: 'renewal', arr_eur: 50000 } })).outcome,
    ).toBe('cannot_evaluate')
  })
})

describe('exceptionsToRaise (re-check rule B)', () => {
  const holding = () => evaluateDeal(input({ deal: { discount_pct: 25 } }))
  const discount = (existing: { rule_key: string; rule_version: string; status: ExceptionStatus }[]) =>
    exceptionsToRaise(holding(), existing).map((e) => e.rule_key)

  it('raises a rule that holds when the deal has no exception for it', () => {
    expect(discount([])).toEqual(['discount_above_20_pct'])
  })

  it('never raises a rule that does not hold or cannot be evaluated', () => {
    expect(exceptionsToRaise(evaluateDeal(input()), [])).toEqual([])
  })

  it('does not raise while an exception for the rule is live, in any version', () => {
    for (const status of ['open', 'under_review'] as const) {
      expect(discount([{ rule_key: 'discount_above_20_pct', rule_version: '1', status }])).toEqual([])
      expect(discount([{ rule_key: 'discount_above_20_pct', rule_version: '0', status }])).toEqual([])
    }
  })

  it('does not raise again once the same rule version was decided or dismissed', () => {
    for (const status of ['decided', 'dismissed'] as const) {
      expect(discount([{ rule_key: 'discount_above_20_pct', rule_version: '1', status }])).toEqual([])
    }
  })

  it('raises again under a new rule version once the old one is closed', () => {
    expect(discount([{ rule_key: 'discount_above_20_pct', rule_version: '0', status: 'decided' }])).toEqual([
      'discount_above_20_pct',
    ])
  })
})

describe('exceptionApplicability (current check, rule C)', () => {
  const evaluations = (discount_pct: number | null) =>
    evaluateDeal(input({ deal: { discount_pct } }))
  const exception = { rule_key: 'discount_above_20_pct', rule_version: '1' }

  it('says whether the rule still applies to the current data', () => {
    expect(exceptionApplicability(exception, evaluations(25))).toBe('still_applies')
    expect(exceptionApplicability(exception, evaluations(10))).toBe('no_longer_applies')
  })

  it('never reports missing data as no longer applying', () => {
    expect(exceptionApplicability(exception, evaluations(null))).toBe('cannot_check')
  })

  it('does not judge an exception raised under another rule version, or an unknown rule', () => {
    expect(
      exceptionApplicability({ rule_key: 'discount_above_20_pct', rule_version: '0' }, evaluations(25)),
    ).toBe('rule_changed')
    expect(
      exceptionApplicability({ rule_key: 'not_a_rule', rule_version: '1' }, evaluations(25)),
    ).toBe('unknown_rule')
  })
})
