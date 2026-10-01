import { describe, expect, it } from 'vitest'

import {
  buildExceptionContext,
  type ExceptionContextInput,
} from '../../app/lib/deal-desk/exception-context'
import type { ProvisionValueUnit } from '../../app/lib/deal-desk/domain'
import { RULES, evaluateDeal, type RuleInput } from '../../app/lib/deal-desk/rules'

/**
 * Feature 5: Exception / Context V1 — the deterministic part.
 *
 * 1. Each rule declares the facts it actually read, for every outcome (holds,
 *    does not hold, cannot be evaluated), and a policy statement tied to its
 *    threshold. The Context renders these facts; it never re-reads or
 *    rebuilds them.
 * 2. buildExceptionContext is a pure, derived read model over rows already
 *    read: facts used, deal (with the predecessor's reading of the same rule),
 *    account, policy (raised-under versus current version) and precedent. It
 *    is never stored and keeps ids for later citation. No AI.
 *
 * Fact values are display strings made with the existing formatters; a
 * missing value is null (shown as "Not set"), never a compliant value.
 */

const LIABILITY_ID = '11111111-1111-4111-8111-111111111111'
const PAYMENT_ID = '22222222-2222-4222-8222-222222222222'
const DEAL_ID = '33333333-3333-4333-8333-333333333333'
const PREDECESSOR_ID = '44444444-4444-4444-8444-444444444444'
const EXCEPTION_ID = '55555555-5555-4555-8555-555555555555'
const ACCOUNT_ID = '66666666-6666-4666-8666-666666666666'

function ruleInput(overrides: {
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

function factsOf(ruleKey: string, input: RuleInput) {
  const evaluation = evaluateDeal(input).find((e) => e.rule_key === ruleKey)
  if (!evaluation) throw new Error(`no evaluation for ${ruleKey}`)
  return { outcome: evaluation.outcome, facts: evaluation.facts }
}

describe('each rule declares the facts it read', () => {
  it('discount: the deal discount, for a breach, a pass and a missing value', () => {
    expect(factsOf('discount_above_20_pct', ruleInput({ deal: { discount_pct: 25 } }))).toEqual({
      outcome: 'holds',
      facts: [{ label: 'Discount', value: '25%', provision_id: null }],
    })
    expect(factsOf('discount_above_20_pct', ruleInput({ deal: { discount_pct: 20 } }))).toEqual({
      outcome: 'does_not_hold',
      facts: [{ label: 'Discount', value: '20%', provision_id: null }],
    })
    expect(factsOf('discount_above_20_pct', ruleInput())).toEqual({
      outcome: 'cannot_evaluate',
      facts: [{ label: 'Discount', value: null, provision_id: null }],
    })
  })

  it('liability cap: the provision it read, and the ARR when the cap is in EUR', () => {
    expect(
      factsOf('liability_cap_below_12_months', ruleInput({ provisions: [liabilityCap(6, 'months_of_fees')] })),
    ).toEqual({
      outcome: 'holds',
      facts: [{ label: 'Liability cap', value: '6 months of fees', provision_id: LIABILITY_ID }],
    })
    expect(
      factsOf('liability_cap_below_12_months', ruleInput({ provisions: [liabilityCap(60000, 'eur')] })),
    ).toEqual({
      outcome: 'does_not_hold',
      facts: [
        { label: 'Liability cap', value: '€60,000.00', provision_id: LIABILITY_ID },
        { label: 'ARR', value: '€60,000.00', provision_id: null },
      ],
    })
  })

  it('liability cap: a missing provision is a missing fact, not a compliant one', () => {
    expect(factsOf('liability_cap_below_12_months', ruleInput())).toEqual({
      outcome: 'cannot_evaluate',
      facts: [{ label: 'Liability cap', value: null, provision_id: null }],
    })
    // A provision without a number is read, but has no value to judge.
    expect(
      factsOf('liability_cap_below_12_months', ruleInput({ provisions: [liabilityCap(null, null)] })),
    ).toEqual({
      outcome: 'cannot_evaluate',
      facts: [{ label: 'Liability cap', value: null, provision_id: LIABILITY_ID }],
    })
  })

  it('payment terms: the provision it read, for a breach, a pass and a missing provision', () => {
    expect(factsOf('payment_terms_over_net_30', ruleInput({ provisions: [paymentTerms(45, 'days')] }))).toEqual({
      outcome: 'holds',
      facts: [{ label: 'Payment terms', value: '45 days', provision_id: PAYMENT_ID }],
    })
    expect(factsOf('payment_terms_over_net_30', ruleInput({ provisions: [paymentTerms(30, 'days')] }))).toEqual({
      outcome: 'does_not_hold',
      facts: [{ label: 'Payment terms', value: '30 days', provision_id: PAYMENT_ID }],
    })
    expect(factsOf('payment_terms_over_net_30', ruleInput())).toEqual({
      outcome: 'cannot_evaluate',
      facts: [{ label: 'Payment terms', value: null, provision_id: null }],
    })
  })

  it('renewal price: the ARR and the predecessor ARR, missing when there is no predecessor', () => {
    const renewal = { deal_type: 'renewal' as const, arr_eur: 50000 }
    expect(
      factsOf('renewal_price_decrease', ruleInput({ deal: renewal, predecessor: { arr_eur: 60000 } })),
    ).toEqual({
      outcome: 'holds',
      facts: [
        { label: 'ARR', value: '€50,000.00', provision_id: null },
        { label: 'Predecessor ARR', value: '€60,000.00', provision_id: null },
      ],
    })
    expect(factsOf('renewal_price_decrease', ruleInput({ deal: renewal }))).toEqual({
      outcome: 'cannot_evaluate',
      facts: [
        { label: 'ARR', value: '€50,000.00', provision_id: null },
        { label: 'Predecessor ARR', value: null, provision_id: null },
      ],
    })
  })
})

describe('each rule declares a policy statement tied to its threshold', () => {
  it('states the fixed threshold of every V1 rule', () => {
    const policy = Object.fromEntries(RULES.map((rule) => [rule.rule_key, rule.policy]))

    expect(policy.discount_above_20_pct).toContain('20%')
    expect(policy.liability_cap_below_12_months).toContain('12 months')
    expect(policy.payment_terms_over_net_30).toContain('Net 30')
    expect(policy.renewal_price_decrease).toMatch(/predecessor/i)
  })
})

/** A renewal deal, 25 % discount, with a predecessor at 30 %, as the page would read them. */
function contextInput(overrides: Partial<ExceptionContextInput> = {}): ExceptionContextInput {
  return {
    exception: {
      id: EXCEPTION_ID,
      deal_id: DEAL_ID,
      rule_key: 'discount_above_20_pct',
      rule_version: '1',
    },
    deal: {
      id: DEAL_ID,
      name: 'Acme 2027',
      deal_type: 'renewal',
      stage: 'negotiation',
      arr_eur: 60000,
      discount_pct: 25,
      renewal_date: null,
    },
    account: {
      id: ACCOUNT_ID,
      name: 'Acme GmbH',
      region: 'EMEA',
      country_code: 'DE',
      segment: 'Enterprise',
      industry: null,
    },
    provisions: [],
    predecessor: {
      id: PREDECESSOR_ID,
      name: 'Acme 2026',
      deal_type: 'new_business',
      arr_eur: 70000,
      discount_pct: 30,
    },
    predecessorProvisions: [],
    precedent: [],
    ...overrides,
  }
}

describe('buildExceptionContext', () => {
  it('renders the facts the rule declared, as the raising rule read them', () => {
    expect(buildExceptionContext(contextInput()).factsUsed).toEqual({
      basis: 'raising_rule',
      facts: [{ label: 'Discount', value: '25%', provision_id: null }],
    })
  })

  it('gives the deal context with its id, and the predecessor as a source of facts', () => {
    const { deal } = buildExceptionContext(contextInput())

    expect(deal).toMatchObject({
      id: DEAL_ID,
      name: 'Acme 2027',
      deal_type: 'renewal',
      stage: 'negotiation',
      arr_eur: 60000,
      renewal_date: null,
    })
    // The predecessor's own reading of the same rule: facts, never a verdict.
    expect(deal.predecessor).toEqual({
      id: PREDECESSOR_ID,
      name: 'Acme 2026',
      facts: [{ label: 'Discount', value: '30%', provision_id: null }],
    })
    expect(JSON.stringify(deal.predecessor)).not.toMatch(/unchanged|outcome|holds/i)
  })

  it("reads a provision rule's fact on the predecessor from the predecessor's own provisions", () => {
    const { deal } = buildExceptionContext(
      contextInput({
        exception: { id: EXCEPTION_ID, deal_id: DEAL_ID, rule_key: 'liability_cap_below_12_months', rule_version: '1' },
        provisions: [liabilityCap(6, 'months_of_fees')],
        predecessorProvisions: [],
      }),
    )

    // The predecessor has no liability cap: a missing fact, not "unchanged".
    expect(deal.predecessor?.facts).toEqual([{ label: 'Liability cap', value: null, provision_id: null }])
  })

  it('has no predecessor context without a predecessor row', () => {
    expect(buildExceptionContext(contextInput({ predecessor: null })).deal.predecessor).toBeNull()
  })

  it('gives the account context with missing values as null, and none without an account', () => {
    expect(buildExceptionContext(contextInput()).account).toEqual({
      id: ACCOUNT_ID,
      name: 'Acme GmbH',
      region: 'EMEA',
      country_code: 'DE',
      segment: 'Enterprise',
      industry: null,
    })
    expect(buildExceptionContext(contextInput({ account: null })).account).toEqual({
      id: null,
      name: null,
      region: null,
      country_code: null,
      segment: null,
      industry: null,
    })
  })

  it('states the current policy when the exception was raised under the current version', () => {
    const discount = RULES.find((rule) => rule.rule_key === 'discount_above_20_pct')

    expect(buildExceptionContext(contextInput()).policy).toEqual({
      status: 'current',
      version: '1',
      statement: discount?.policy,
    })
  })

  it('never presents the current policy as the one an older version raised under', () => {
    const context = buildExceptionContext(
      contextInput({
        exception: { id: EXCEPTION_ID, deal_id: DEAL_ID, rule_key: 'discount_above_20_pct', rule_version: '0' },
      }),
    )

    expect(context.policy).toEqual({
      status: 'changed',
      raisedUnderVersion: '0',
      currentVersion: '1',
      currentStatement: RULES.find((rule) => rule.rule_key === 'discount_above_20_pct')?.policy,
    })
    expect(context.policy).not.toHaveProperty('statement')
    // The facts shown are the current rule's reading.
    expect(context.factsUsed.basis).toBe('current_rule')
  })

  it('shows no policy and no facts for a rule the registry does not know', () => {
    const context = buildExceptionContext(
      contextInput({
        exception: { id: EXCEPTION_ID, deal_id: DEAL_ID, rule_key: 'not_a_rule', rule_version: '1' },
      }),
    )

    expect(context.policy).toEqual({ status: 'unknown', raisedUnderVersion: '1' })
    expect(context.factsUsed).toEqual({ basis: 'unknown_rule', facts: [] })
    expect(context.deal.predecessor?.facts).toEqual([])
  })

  it('passes the precedent through unchanged, with its ids and rule versions', () => {
    const precedent = [
      {
        decision_id: '77777777-7777-4777-8777-777777777777',
        decision_type: 'approve' as const,
        rationale: 'Approved on the sister deal.',
        created_at: '2026-09-01T10:00:00Z',
        exception_id: '88888888-8888-4888-8888-888888888888',
        rule_version: '1',
        deal_id: '99999999-9999-4999-8999-999999999999',
        deal_name: 'Acme 2025',
      },
    ]

    expect(buildExceptionContext(contextInput({ precedent })).precedent).toEqual(precedent)
  })
})
