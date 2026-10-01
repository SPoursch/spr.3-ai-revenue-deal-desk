import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  signInTestUser,
  signOutTestUser,
  type SignedInTestUser,
  type TestClient,
} from '../support/supabase-clients'

/**
 * Integration tests for listRulePrecedents (app/lib/db/decisions.ts), the one
 * new data-layer read of Feature 5: Exception / Context V1, against the hosted
 * canonical database, run as real users.
 *
 * Precedent for an exception is the human Decisions already recorded on
 * exceptions of the same rule, on the deals of the same account: this deal's
 * own earlier exceptions and the account's other deals. It leaves out the
 * current exception (its Decisions are shown separately) and deal-level
 * Decisions, returns at most the newest 5, and carries each exception's
 * rule_version. One bounded read, under RLS: nothing is loaded per deal.
 *
 * As in the other data-layer tests, only client construction is replaced
 * (J3), so every query meets the real grants and row level security. Test
 * data carries this run's RUN_PREFIX and `afterAll` deletes it for each user.
 */

const current = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('../../app/lib/supabase', () => ({
  getSupabaseClient: () => {
    if (!current.client) throw new Error('No test client selected: call actAs().')
    return current.client
  },
}))

// Imported after vi.mock is registered (vi.mock is hoisted above imports).
import {
  createAccount,
  createDeal,
  createException,
  DealDeskDatabaseError,
  listRulePrecedents,
  recordDecision,
} from '../../app/lib/db'
import type { Account, Deal, DealException } from '../../app/lib/deal-desk/domain'

const RUN_PREFIX = `[deal-desk-test ${randomUUID().slice(0, 8)}]`
const RULE = 'discount_above_20_pct'
const OTHER_RULE = 'payment_terms_over_net_30'

let userA: SignedInTestUser
let userB: SignedInTestUser

let account: Account
let otherAccount: Account
let thisDeal: Deal
let sisterDeal: Deal
let otherAccountDeal: Deal
/** The exception whose page asks for precedent. */
let currentException: DealException

const createdDealIds = new Set<string>()

function actAs(client: TestClient) {
  current.client = client
}

function testName(label: string) {
  return `${RUN_PREFIX} ${label}`
}

async function dealOn(accountId: string, label: string): Promise<Deal> {
  const deal = await createDeal({
    account_id: accountId,
    name: testName(label),
    deal_type: 'new_business',
    stage: 'negotiation',
    arr_eur: 60000,
  })
  createdDealIds.add(deal.id)
  return deal
}

async function exceptionOn(deal: Deal, ruleKey: string, ruleVersion: string): Promise<DealException> {
  return createException({
    deal_id: deal.id,
    rule_key: ruleKey,
    rule_version: ruleVersion,
    kind: 'threshold_breach',
    severity: 'medium',
    title: 'Discount above 20%',
    why: 'The deal discount is above the 20% standard.',
    origin: 'deterministic',
  })
}

async function decide(exception: DealException, rationale: string) {
  return recordDecision({
    deal_id: exception.deal_id,
    exception_id: exception.id,
    decision_type: 'approve',
    rationale,
    conditions: null,
    considered_finding_id: null,
  })
}

async function precedentAsA() {
  actAs(userA.client)
  return listRulePrecedents({
    accountId: account.id,
    ruleKey: RULE,
    excludeExceptionId: currentException.id,
  })
}

beforeAll(async () => {
  userA = await signInTestUser('A')
  userB = await signInTestUser('B')

  actAs(userA.client)
  account = await createAccount({ name: testName('account') })
  otherAccount = await createAccount({ name: testName('other account') })
  thisDeal = await dealOn(account.id, 'this deal')
  sisterDeal = await dealOn(account.id, 'sister deal')
  otherAccountDeal = await dealOn(otherAccount.id, 'other account deal')

  // This deal's own earlier exception, raised under version 0 and decided.
  const earlier = await exceptionOn(thisDeal, RULE, '0')
  await decide(earlier, 'precedent 1: earlier version on this deal')

  // The sister deal: one exception, and a change of mind recorded on it
  // repeatedly, so that there are more than five precedents in total.
  const sister = await exceptionOn(sisterDeal, RULE, '1')
  for (const n of [2, 3, 4, 5, 6]) {
    await decide(sister, `precedent ${n}: sister deal`)
  }

  // Not precedent: another rule on the same account.
  await decide(await exceptionOn(sisterDeal, OTHER_RULE, '1'), 'excluded: another rule')

  // Not precedent: the same rule on another account's deal.
  await decide(await exceptionOn(otherAccountDeal, RULE, '1'), 'excluded: another account')

  // Not precedent: a deal-level Decision (no exception).
  const dealLevel = await userA.client.from('decisions').insert({
    deal_id: sisterDeal.id,
    exception_id: null,
    decision_type: 'accept_risk',
    rationale: 'excluded: deal-level decision',
  })
  if (dealLevel.error) throw new Error(`Deal-level fixture failed (${dealLevel.error.code}).`)

  // The current exception, decided too: its own Decisions are not precedent.
  currentException = await exceptionOn(thisDeal, RULE, '1')
  await decide(currentException, 'excluded: the current exception')
})

afterAll(async () => {
  try {
    for (const user of [userA, userB].filter(Boolean)) {
      const { error } = await user.client.from('accounts').delete().like('name', `${RUN_PREFIX}%`)
      if (error) throw new Error(`Cleanup delete failed (${error.code}).`)
    }
    for (const user of [userA, userB].filter(Boolean)) {
      const { data, error } = await user.client
        .from('decisions')
        .select('id')
        .in('deal_id', [...createdDealIds])
      if (error) throw new Error(`Cleanup check failed (${error.code}).`)
      if (data.length > 0) {
        throw new Error(`Cleanup left ${data.length} decision(s) for user ${user.label}.`)
      }
    }
  } finally {
    await Promise.all([userA, userB].filter(Boolean).map(signOutTestUser))
  }
})

describe('listRulePrecedents', () => {
  it('returns the newest five Decisions on the same rule for the current account, newest first', async () => {
    const precedent = await precedentAsA()

    expect(precedent.map((p) => p.rationale)).toEqual([
      'precedent 6: sister deal',
      'precedent 5: sister deal',
      'precedent 4: sister deal',
      'precedent 3: sister deal',
      'precedent 2: sister deal',
    ])
  })

  it("covers this deal's own earlier exceptions as well as the account's other deals", async () => {
    // With the five sister-deal Decisions out of the way, the earlier one on
    // this deal is next: ask for the precedent of the sister deal's exception.
    actAs(userA.client)
    const sister = (await precedentAsA())[0]
    const precedent = await listRulePrecedents({
      accountId: account.id,
      ruleKey: RULE,
      excludeExceptionId: sister.exception_id,
    })

    expect(precedent.map((p) => p.rationale)).toEqual([
      'excluded: the current exception',
      'precedent 1: earlier version on this deal',
    ])
    expect(precedent[1]).toMatchObject({ deal_id: thisDeal.id, rule_version: '0' })
  })

  it("carries the Decision, its exception's rule version and its deal on every row", async () => {
    const [newest] = await precedentAsA()

    expect(newest).toEqual({
      decision_id: expect.any(String),
      decision_type: 'approve',
      rationale: 'precedent 6: sister deal',
      created_at: expect.any(String),
      exception_id: expect.any(String),
      rule_version: '1',
      deal_id: sisterDeal.id,
      deal_name: sisterDeal.name,
    })
  })

  it('leaves out the current exception, other rules, other accounts and deal-level Decisions', async () => {
    const precedent = await precedentAsA()
    const rationales = precedent.map((p) => p.rationale)

    expect(precedent.every((p) => p.exception_id !== currentException.id)).toBe(true)
    for (const excluded of [
      'excluded: the current exception',
      'excluded: another rule',
      'excluded: another account',
      'excluded: deal-level decision',
    ]) {
      expect(rationales).not.toContain(excluded)
    }
    expect(precedent.every((p) => p.deal_id !== otherAccountDeal.id)).toBe(true)
  })

  it("returns nothing to user B for user A's account", async () => {
    actAs(userB.client)
    expect(
      await listRulePrecedents({
        accountId: account.id,
        ruleKey: RULE,
        excludeExceptionId: currentException.id,
      }),
    ).toEqual([])
  })

  it('throws on a failed read rather than returning an empty precedent list', async () => {
    actAs(userA.client)
    const error = await listRulePrecedents({
      accountId: 'not-a-uuid',
      ruleKey: RULE,
      excludeExceptionId: currentException.id,
    }).then(
      () => null,
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(DealDeskDatabaseError)
  })
})
