import type {
  Deal,
  DealException,
  ExceptionKind,
  ExceptionSeverity,
  Provision,
  ProvisionType,
} from './domain'
import { formatEur, formatPercent, formatProvisionAmount } from './format'

/**
 * The Deal Desk rule registry, V1 (Rules → Exceptions → Decisions).
 *
 * Rules are fixed, versioned application logic, not configurable records (U3).
 * Each is a pure, deterministic function over one deal's stored data: its
 * facts, its provisions and, for a renewal, its predecessor. No rule calls a
 * model or reads the database, and none can record a Decision.
 *
 * A rule either holds, does not hold, or cannot be evaluated because the data
 * it needs is missing or not in a comparable unit. Only a rule that holds can
 * raise an exception, and missing data is never read as compliance.
 *
 * Every evaluation also reports the facts the rule read, whatever its outcome,
 * so the Exception Context shows exactly what was judged rather than reading
 * it again. Each rule states its policy, built from the same threshold
 * constants as its verdict and its why.
 *
 * The thresholds are business policy, fixed by the product owner. Changing
 * one means a new `rule_version`, so an exception already decided under the
 * old version can be raised again under the new one.
 */

/** Discount above this percentage breaches policy; exactly this is compliant. */
const MAX_DISCOUNT_PCT = 20
/** A liability cap below this many months of fees is non-standard. */
const MIN_LIABILITY_CAP_MONTHS = 12
/** Payment terms longer than this many days are non-standard (Net 30). */
const MAX_PAYMENT_TERMS_DAYS = 30

/** What a rule reads: one deal, its provisions, and its predecessor if any. */
export type RuleInput = {
  deal: Pick<Deal, 'deal_type' | 'arr_eur' | 'discount_pct'>
  provisions: Pick<Provision, 'id' | 'provision_type' | 'value_numeric' | 'value_unit'>[]
  predecessor: Pick<Deal, 'arr_eur'> | null
}

export type RuleOutcome = 'holds' | 'does_not_hold' | 'cannot_evaluate'

/**
 * One fact a rule read, ready to show: a label, the value as displayed, or
 * null when it is missing, and the provision it came from, if any. A fact
 * without a provision id is one of the deal's own figures.
 */
export type RuleFact = {
  label: string
  value: string | null
  provision_id: string | null
}

/** A rule's verdict on one deal. `title` and `why` are set only when it holds. */
export type RuleEvaluation = {
  rule_key: string
  rule_version: string
  kind: ExceptionKind
  severity: ExceptionSeverity
  outcome: RuleOutcome
  title: string | null
  why: string | null
  provision_id: string | null
  /** The facts the rule read, for every outcome. */
  facts: RuleFact[]
}

type Verdict = Pick<RuleEvaluation, 'outcome' | 'title' | 'why' | 'provision_id' | 'facts'>

type Rule = {
  rule_key: string
  rule_version: string
  kind: ExceptionKind
  severity: ExceptionSeverity
  /** The provision the rule is about, or null for a rule on the deal's own figures. */
  provision_type: ProvisionType | null
  /** The policy this version of the rule enforces, stated from its threshold. */
  policy: string
  evaluate: (input: RuleInput) => Verdict
}

function doesNotHold(facts: RuleFact[]): Verdict {
  return { outcome: 'does_not_hold', title: null, why: null, provision_id: null, facts }
}

function cannotEvaluate(facts: RuleFact[]): Verdict {
  return { outcome: 'cannot_evaluate', title: null, why: null, provision_id: null, facts }
}

function holds(
  title: string,
  why: string,
  facts: RuleFact[],
  provisionId: string | null = null,
): Verdict {
  return { outcome: 'holds', title, why, provision_id: provisionId, facts }
}

function provisionOf(input: RuleInput, type: ProvisionType) {
  return input.provisions.find((provision) => provision.provision_type === type) ?? null
}

/** A provision as a fact: its amount with its unit, or missing when it has no number. */
function provisionFact(
  label: string,
  provision: RuleInput['provisions'][number] | null,
): RuleFact {
  return {
    label,
    value:
      provision !== null && provision.value_numeric !== null
        ? formatProvisionAmount(provision.value_numeric, provision.value_unit)
        : null,
    provision_id: provision?.id ?? null,
  }
}

function dealFact(label: string, value: string | null): RuleFact {
  return { label, value, provision_id: null }
}

export const RULES: readonly Rule[] = [
  {
    rule_key: 'discount_above_20_pct',
    rule_version: '1',
    kind: 'threshold_breach',
    severity: 'medium',
    provision_type: null,
    policy: `A deal's discount must not exceed ${formatPercent(MAX_DISCOUNT_PCT)}.`,
    evaluate: ({ deal }) => {
      const facts = [
        dealFact('Discount', deal.discount_pct === null ? null : formatPercent(deal.discount_pct)),
      ]
      if (deal.discount_pct === null) return cannotEvaluate(facts)
      if (deal.discount_pct <= MAX_DISCOUNT_PCT) return doesNotHold(facts)
      return holds(
        'Discount above 20%',
        `The deal's discount is ${formatPercent(deal.discount_pct)}, above the ` +
          `${formatPercent(MAX_DISCOUNT_PCT)} standard.`,
        facts,
      )
    },
  },
  {
    rule_key: 'liability_cap_below_12_months',
    rule_version: '1',
    kind: 'non_standard_provision',
    severity: 'high',
    provision_type: 'liability_cap',
    policy:
      `A liability cap must be at least ${MIN_LIABILITY_CAP_MONTHS} months of fees ` +
      `(the deal's ARR, for a cap in EUR).`,
    evaluate: (input) => {
      const cap = provisionOf(input, 'liability_cap')
      const facts = [provisionFact('Liability cap', cap)]
      if (cap === null || cap.value_numeric === null) return cannotEvaluate(facts)

      const title = 'Liability cap below 12 months of fees'
      if (cap.value_unit === 'months_of_fees') {
        if (cap.value_numeric >= MIN_LIABILITY_CAP_MONTHS) return doesNotHold(facts)
        return holds(
          title,
          `The liability cap is ${cap.value_numeric} months of fees, below the ` +
            `${MIN_LIABILITY_CAP_MONTHS}-month standard.`,
          facts,
          cap.id,
        )
      }
      if (cap.value_unit === 'eur') {
        // Twelve months of fees is the deal's ARR, which the rule also read.
        facts.push(dealFact('ARR', formatEur(input.deal.arr_eur)))
        const minimum = (input.deal.arr_eur * MIN_LIABILITY_CAP_MONTHS) / 12
        if (cap.value_numeric >= minimum) return doesNotHold(facts)
        return holds(
          title,
          `The liability cap is ${formatEur(cap.value_numeric)}, below ` +
            `${MIN_LIABILITY_CAP_MONTHS} months of fees (${formatEur(minimum)}, the deal's ARR).`,
          facts,
          cap.id,
        )
      }
      return cannotEvaluate(facts)
    },
  },
  {
    rule_key: 'payment_terms_over_net_30',
    rule_version: '1',
    kind: 'non_standard_provision',
    severity: 'medium',
    provision_type: 'payment_terms',
    policy: `Payment terms must not be longer than Net ${MAX_PAYMENT_TERMS_DAYS}.`,
    evaluate: (input) => {
      const terms = provisionOf(input, 'payment_terms')
      const facts = [provisionFact('Payment terms', terms)]
      if (terms === null || terms.value_numeric === null || terms.value_unit !== 'days') {
        return cannotEvaluate(facts)
      }
      if (terms.value_numeric <= MAX_PAYMENT_TERMS_DAYS) return doesNotHold(facts)
      return holds(
        'Payment terms longer than Net 30',
        `Payment terms are ${terms.value_numeric} days, longer than the ` +
          `Net ${MAX_PAYMENT_TERMS_DAYS} standard.`,
        facts,
        terms.id,
      )
    },
  },
  {
    rule_key: 'renewal_price_decrease',
    rule_version: '1',
    kind: 'commercial_risk',
    severity: 'high',
    provision_type: null,
    policy: 'A renewal must not be priced below its predecessor (any decrease counts).',
    evaluate: ({ deal, predecessor }) => {
      const facts = [
        dealFact('ARR', formatEur(deal.arr_eur)),
        dealFact('Predecessor ARR', predecessor === null ? null : formatEur(predecessor.arr_eur)),
      ]
      if (deal.deal_type !== 'renewal' || predecessor === null) return cannotEvaluate(facts)
      // Any decrease counts.
      if (deal.arr_eur >= predecessor.arr_eur) return doesNotHold(facts)
      return holds(
        'Renewal priced below its predecessor',
        `The renewal's ARR of ${formatEur(deal.arr_eur)} is below its predecessor's ` +
          `${formatEur(predecessor.arr_eur)}.`,
        facts,
      )
    },
  },
]

/** The rule a stored exception names, or null when the registry does not know it. */
export function ruleOf(ruleKey: string): Rule | null {
  return RULES.find((rule) => rule.rule_key === ruleKey) ?? null
}

/** Evaluates every rule for one deal, in registry order. */
export function evaluateDeal(input: RuleInput): RuleEvaluation[] {
  return RULES.map(({ rule_key, rule_version, kind, severity, evaluate }) => ({
    rule_key,
    rule_version,
    kind,
    severity,
    ...evaluate(input),
  }))
}

const LIVE_STATUSES: readonly string[] = ['open', 'under_review']

/**
 * The rules that should raise an exception now: each holds, no exception for
 * its rule key is live in any version (one live per rule, as the database's
 * partial unique index requires), and no exception at all exists for its key
 * and current version, so a decided or dismissed one stays closed.
 */
export function exceptionsToRaise(
  evaluations: RuleEvaluation[],
  existing: Pick<DealException, 'rule_key' | 'rule_version' | 'status'>[],
): RuleEvaluation[] {
  return evaluations.filter(
    (evaluation) =>
      evaluation.outcome === 'holds' &&
      !existing.some(
        (exception) =>
          exception.rule_key === evaluation.rule_key &&
          (LIVE_STATUSES.includes(exception.status) ||
            exception.rule_version === evaluation.rule_version),
      ),
  )
}

export type ExceptionApplicability =
  | 'still_applies'
  | 'no_longer_applies'
  | 'cannot_check'
  | 'rule_changed'
  | 'unknown_rule'

/**
 * Whether an exception's rule still holds on the deal's current data, worked
 * out each time and never stored. An exception raised under another rule
 * version, or by a rule the registry does not know, is not judged; missing
 * data is `cannot_check`, never `no_longer_applies`.
 */
export function exceptionApplicability(
  exception: Pick<DealException, 'rule_key' | 'rule_version'>,
  evaluations: RuleEvaluation[],
): ExceptionApplicability {
  const rule = ruleOf(exception.rule_key)
  if (rule === null) return 'unknown_rule'
  if (rule.rule_version !== exception.rule_version) return 'rule_changed'

  const evaluation = evaluations.find((e) => e.rule_key === exception.rule_key)
  if (!evaluation || evaluation.outcome === 'cannot_evaluate') return 'cannot_check'
  return evaluation.outcome === 'holds' ? 'still_applies' : 'no_longer_applies'
}
