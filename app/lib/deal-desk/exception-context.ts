import type { Account, Deal, DealException, RulePrecedent } from './domain'
import { ruleOf, type RuleFact, type RuleInput } from './rules'

/**
 * Feature 5: Exception / Context V1 — the context around one exception.
 *
 * The domain Index defines context as what changes the meaning of a fact.
 * This is a derived read model, built by a pure function from rows the page
 * has already read, and never stored. It has five sections:
 *
 * - factsUsed   the facts the exception's rule declares it read (rules.ts),
 *               never read or rebuilt here;
 * - deal        the deal, and for a renewal the predecessor with its own
 *               reading of the same rule, as facts and never as a comparison;
 * - account     the account's details;
 * - policy      the rule's policy statement, for the version the exception
 *               was raised under only when that is still the current one;
 * - precedent   earlier Decisions on the same rule (listRulePrecedents).
 *
 * Ids are kept for later citation. A missing value is null, which the page
 * shows as "Not set". No AI is involved.
 */

export type ExceptionContextInput = {
  exception: Pick<DealException, 'id' | 'deal_id' | 'rule_key' | 'rule_version'>
  deal: Pick<
    Deal,
    'id' | 'name' | 'deal_type' | 'stage' | 'arr_eur' | 'discount_pct' | 'renewal_date'
  >
  account: Pick<Account, 'id' | 'name' | 'region' | 'country_code' | 'segment' | 'industry'> | null
  provisions: RuleInput['provisions']
  /** The renewal's predecessor, read as the caller; it may belong to another account. */
  predecessor: Pick<Deal, 'id' | 'name' | 'deal_type' | 'arr_eur' | 'discount_pct'> | null
  predecessorProvisions: RuleInput['provisions']
  precedent: RulePrecedent[]
}

/**
 * Whose reading the facts are: the rule the exception was raised under, the
 * current version of that rule (its version has changed since), or none
 * (the registry does not know the rule).
 */
export type FactsBasis = 'raising_rule' | 'current_rule' | 'unknown_rule'

export type PolicyContext =
  | { status: 'current'; version: string; statement: string }
  | {
      status: 'changed'
      raisedUnderVersion: string
      currentVersion: string
      currentStatement: string
    }
  | { status: 'unknown'; raisedUnderVersion: string }

export type ExceptionContext = {
  factsUsed: { basis: FactsBasis; facts: RuleFact[] }
  deal: Pick<Deal, 'id' | 'name' | 'deal_type' | 'stage' | 'arr_eur' | 'renewal_date'> & {
    predecessor: { id: string; name: string; facts: RuleFact[] } | null
  }
  account: {
    id: string | null
    name: string | null
    region: string | null
    country_code: string | null
    segment: string | null
    industry: string | null
  }
  policy: PolicyContext
  precedent: RulePrecedent[]
}

export function buildExceptionContext(input: ExceptionContextInput): ExceptionContext {
  const { exception, deal, account, predecessor } = input
  const rule = ruleOf(exception.rule_key)

  // The facts are the rule's own declaration of what it read: the same
  // evaluation that judges the deal, over the same rows.
  const facts = rule
    ? rule.evaluate({
        deal,
        provisions: input.provisions,
        predecessor: predecessor ? { arr_eur: predecessor.arr_eur } : null,
      }).facts
    : []

  const factsUsed: ExceptionContext['factsUsed'] = {
    basis:
      rule === null
        ? 'unknown_rule'
        : rule.rule_version === exception.rule_version
          ? 'raising_rule'
          : 'current_rule',
    facts,
  }

  // The predecessor's own reading of the same rule, over its own data: what
  // it shows, not how it compares.
  const predecessorContext = predecessor
    ? {
        id: predecessor.id,
        name: predecessor.name,
        facts: rule
          ? rule.evaluate({
              deal: predecessor,
              provisions: input.predecessorProvisions,
              predecessor: null,
            }).facts
          : [],
      }
    : null

  let policy: PolicyContext
  if (rule === null) {
    policy = { status: 'unknown', raisedUnderVersion: exception.rule_version }
  } else if (rule.rule_version === exception.rule_version) {
    policy = { status: 'current', version: rule.rule_version, statement: rule.policy }
  } else {
    // Only the current version's wording exists: it is never presented as the
    // policy the exception was raised under.
    policy = {
      status: 'changed',
      raisedUnderVersion: exception.rule_version,
      currentVersion: rule.rule_version,
      currentStatement: rule.policy,
    }
  }

  return {
    factsUsed,
    deal: {
      id: deal.id,
      name: deal.name,
      deal_type: deal.deal_type,
      stage: deal.stage,
      arr_eur: deal.arr_eur,
      renewal_date: deal.renewal_date,
      predecessor: predecessorContext,
    },
    account: {
      id: account?.id ?? null,
      name: account?.name ?? null,
      region: account?.region ?? null,
      country_code: account?.country_code ?? null,
      segment: account?.segment ?? null,
      industry: account?.industry ?? null,
    },
    policy,
    precedent: input.precedent,
  }
}
