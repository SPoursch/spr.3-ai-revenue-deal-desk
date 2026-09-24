import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  createAnonymousClient,
  signInTestUser,
  signOutTestUser,
  type SignedInTestUser,
  type TestClient,
} from '../support/supabase-clients'

/**
 * Integration tests for app/lib/db/decisions.ts against the hosted canonical
 * database, run as real users.
 *
 * As in the other data-access tests, only client construction is replaced
 * (J3): `getSupabaseClient()` returns whichever real client `actAs()`
 * selected, so every query meets the real grants, row level security and
 * triggers. Nothing uses a service-role key.
 *
 * Canonical semantics under test (M3): INSERT and SELECT only — a Decision is
 * immutable and disappears only with its deal. Inserting a Decision sets its
 * exception's status in the same transaction through the
 * `decisions_apply_to_exception` trigger: 'dismissed' for
 * dismiss_false_positive, 'decided' otherwise (E5, E6). The exception and the
 * considered finding must be of the Decision's deal (composite foreign keys),
 * and a failed insert leaves the exception untouched.
 *
 * Test data: account and deal names start with this run's RUN_PREFIX.
 * `afterAll` deletes this run's accounts for each user and the database
 * cascades to deals, exceptions, findings and decisions, then fails the run if
 * either user can still see a prefixed account or deal, or any exception or
 * decision on this run's deals.
 */

const current = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('../../app/lib/supabase', () => ({
  getSupabaseClient: () => {
    if (!current.client) throw new Error('No test client selected: call actAs().')
    return current.client
  },
}))

// Imported after vi.mock is registered (vi.mock is hoisted above imports).
import * as decisionsModule from '../../app/lib/db/decisions'
import {
  createAccount,
  createAiFinding,
  createDeal,
  createException,
  DealDeskDatabaseError,
  DecisionValidationError,
  deleteDeal,
  getDecision,
  getException,
  listDecisions,
  listExceptionDecisions,
  recordDecision,
  updateExceptionStatus,
} from '../../app/lib/db'
import type { TablesUpdate } from '../../app/lib/database.types'
import type {
  Deal,
  DealException,
  RecordExceptionDecisionInput,
} from '../../app/lib/deal-desk/domain'

const RUN_PREFIX = `[deal-desk-test ${randomUUID().slice(0, 8)}]`

let userA: SignedInTestUser
let userB: SignedInTestUser
const anonymous = createAnonymousClient()

let dealA1: Deal
let dealA2: Deal
let dealB: Deal

/** Every deal this run created, for the leftover check. */
const createdDealIds = new Set<string>()

function actAs(client: TestClient) {
  current.client = client
}

function testName(label: string) {
  return `${RUN_PREFIX} ${label}`
}

async function createTestDeal(label: string, accountId: string) {
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

/** Raises an open deterministic exception on `deal` as `user`. */
async function exceptionOn(
  user: SignedInTestUser,
  deal: Deal,
  ruleKey: string,
): Promise<DealException> {
  actAs(user.client)
  return createException({
    deal_id: deal.id,
    rule_key: ruleKey,
    rule_version: '1',
    kind: 'non_standard_provision',
    severity: 'high',
    title: 'Liability cap below standard',
    why: 'The cap is 6 months of fees; the standard is at least 12.',
    origin: 'deterministic',
  })
}

/** Records an AI finding on `deal` as `user`, through the findings module. */
async function findingOn(user: SignedInTestUser, deal: Deal): Promise<string> {
  actAs(user.client)
  const finding = await createAiFinding({
    deal_id: deal.id,
    finding_type: 'risk_explanation',
    content: 'The cap is half the standard; similar deals accepted it.',
    model: 'openrouter/test-model',
    prompt_version: 'risk-explanation-v1',
  })
  return finding.id
}

/** A Decision on `exception`, before overrides. */
function decisionOn(
  exception: DealException,
  overrides: Partial<RecordExceptionDecisionInput> = {},
): RecordExceptionDecisionInput {
  return {
    deal_id: exception.deal_id,
    exception_id: exception.id,
    decision_type: 'accept_risk',
    rationale: 'Strategic customer; legal has reviewed the cap.',
    ...overrides,
  }
}

/** Asserts that `promise` rejects with a DealDeskDatabaseError of `kind` on decisions. */
async function expectDatabaseError(
  promise: Promise<unknown>,
  kind: DealDeskDatabaseError['kind'],
) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(DealDeskDatabaseError)
  expect((error as DealDeskDatabaseError).kind).toBe(kind)
  expect((error as DealDeskDatabaseError).table).toBe('decisions')
}

/** Asserts that user A still sees `exception` unchanged and without a Decision. */
async function expectUntouched(exception: DealException) {
  actAs(userA.client)
  expect(await getException(exception.id)).toEqual(exception)
  expect(await listExceptionDecisions(exception.id)).toEqual([])
}

beforeAll(async () => {
  userA = await signInTestUser('A')
  userB = await signInTestUser('B')

  actAs(userA.client)
  const accountA = await createAccount({ name: testName('account A') })
  dealA1 = await createTestDeal('deal A1', accountA.id)
  dealA2 = await createTestDeal('deal A2', accountA.id)

  actAs(userB.client)
  const accountB = await createAccount({ name: testName('account B') })
  dealB = await createTestDeal('deal B', accountB.id)
})

afterAll(async () => {
  try {
    for (const user of [userA, userB].filter(Boolean)) {
      // Account → deals → exceptions, findings, decisions, by cascade.
      const { error } = await user.client
        .from('accounts')
        .delete()
        .like('name', `${RUN_PREFIX}%`)
      if (error) throw new Error(`Cleanup delete failed (${error.code}).`)
    }

    for (const user of [userA, userB].filter(Boolean)) {
      const checks = [
        user.client.from('accounts').select('id').like('name', `${RUN_PREFIX}%`),
        user.client.from('deals').select('id').like('name', `${RUN_PREFIX}%`),
        user.client.from('exceptions').select('id').in('deal_id', [...createdDealIds]),
        user.client.from('decisions').select('id').in('deal_id', [...createdDealIds]),
      ]
      for (const { data, error } of await Promise.all(checks)) {
        if (error) throw new Error(`Cleanup check failed (${error.code}).`)
        if (data.length > 0) {
          throw new Error(
            `Cleanup left ${data.length} test row(s) for user ${user.label}.`,
          )
        }
      }
    }
  } finally {
    await Promise.all([userA, userB].filter(Boolean).map(signOutTestUser))
  }
})

describe('decisions: recording a Decision sets the exception status (E5, E6)', () => {
  it('records an approval and moves the exception to decided', async () => {
    const exception = await exceptionOn(userA, dealA1, 'approve_rule')

    actAs(userA.client)
    const decision = await recordDecision(
      decisionOn(exception, {
        decision_type: 'approve',
        rationale: '  Within the regional precedent.  ',
      }),
    )
    const after = (await getException(exception.id))!

    expect(decision).toMatchObject({
      deal_id: dealA1.id,
      exception_id: exception.id,
      decision_type: 'approve',
      rationale: 'Within the regional precedent.',
      conditions: null,
      considered_finding_id: null,
    })
    expect(typeof decision.created_at).toBe('string')
    expect(decision).not.toHaveProperty('user_id')

    expect(after).toMatchObject({ id: exception.id, status: 'decided' })
    expect(Date.parse(after.status_changed_at)).toBeGreaterThan(
      Date.parse(exception.status_changed_at),
    )
  })

  it('records dismiss_false_positive and moves the exception to dismissed', async () => {
    const exception = await exceptionOn(userA, dealA1, 'dismiss_rule')

    actAs(userA.client)
    const decision = await recordDecision(
      decisionOn(exception, { decision_type: 'dismiss_false_positive' }),
    )

    expect(decision.decision_type).toBe('dismiss_false_positive')
    expect((await getException(exception.id))?.status).toBe('dismissed')
  })

  it('decides an exception that is under review', async () => {
    const exception = await exceptionOn(userA, dealA1, 'under_review_rule')
    actAs(userA.client)
    await updateExceptionStatus(exception.id, 'under_review')

    await recordDecision(decisionOn(exception, { decision_type: 'request_change' }))

    expect((await getException(exception.id))?.status).toBe('decided')
  })

  it('stores the conditions of an approval with conditions', async () => {
    const exception = await exceptionOn(userA, dealA1, 'conditional_rule')

    actAs(userA.client)
    const decision = await recordDecision(
      decisionOn(exception, {
        decision_type: 'approve_with_conditions',
        conditions: 'Cap raised to 9 months at renewal.',
      }),
    )

    expect(decision.conditions).toBe('Cap raised to 9 months at renewal.')
    expect((await getException(exception.id))?.status).toBe('decided')
  })

  it('records the AI finding that was in view, without making it the decider', async () => {
    const exception = await exceptionOn(userA, dealA1, 'considered_finding_rule')
    const findingId = await findingOn(userA, dealA1)

    actAs(userA.client)
    const decision = await recordDecision(
      decisionOn(exception, { considered_finding_id: findingId }),
    )

    expect(decision.considered_finding_id).toBe(findingId)
    expect(decision.rationale).toBe('Strategic customer; legal has reviewed the cap.')
  })
})

describe('decisions: history — a change of mind is a new Decision', () => {
  let exception: DealException

  beforeAll(async () => {
    exception = await exceptionOn(userA, dealA2, 'change_of_mind_rule')
  })

  it('keeps every Decision, newest first, and the newest sets the status', async () => {
    actAs(userA.client)
    const first = await recordDecision(
      decisionOn(exception, { decision_type: 'approve' }),
    )
    const second = await recordDecision(
      decisionOn(exception, {
        decision_type: 'dismiss_false_positive',
        rationale: 'The cap was misread; it is 12 months.',
      }),
    )

    expect((await getException(exception.id))?.status).toBe('dismissed')
    expect((await listExceptionDecisions(exception.id)).map((d) => d.id)).toEqual([
      second.id,
      first.id,
    ])
    // The earlier Decision is unchanged.
    expect(await getDecision(first.id)).toEqual(first)
  })

  it("lists the deal's Decisions newest first, and only that deal's", async () => {
    const other = await exceptionOn(userA, dealA2, 'second_exception_rule')
    actAs(userA.client)
    const newest = await recordDecision(decisionOn(other, { decision_type: 'reject' }))

    const dealDecisions = await listDecisions(dealA2.id)

    expect(dealDecisions[0].id).toBe(newest.id)
    expect(dealDecisions.every((d) => d.deal_id === dealA2.id)).toBe(true)
    expect(dealDecisions.map((d) => d.exception_id)).toContain(exception.id)
  })

  it('returns null or an empty list for what does not exist', async () => {
    actAs(userA.client)
    const missing = randomUUID()

    expect(await getDecision(missing)).toBeNull()
    expect(await listDecisions(missing)).toEqual([])
    expect(await listExceptionDecisions(missing)).toEqual([])
  })
})

describe('decisions: invalid input is refused before anything is sent', () => {
  it.each([
    ['a blank rationale', 'rationale', { rationale: '   ' }],
    ['an unknown decision type', 'decision_type', { decision_type: 'escalate' }],
    [
      'a conditional approval without conditions',
      'conditions',
      { decision_type: 'approve_with_conditions' },
    ],
    [
      'conditions on a rejection',
      'conditions',
      { decision_type: 'reject', conditions: 'Net 60.' },
    ],
    [
      'a malformed finding reference',
      'considered_finding_id',
      { considered_finding_id: 'finding-1' },
    ],
  ])('refuses %s with the %s problem', async (_label, field, overrides) => {
    const exception = await exceptionOn(userA, dealA1, `invalid_${randomUUID().slice(0, 8)}`)

    actAs(userA.client)
    const error = await recordDecision(
      decisionOn(exception, overrides as Partial<RecordExceptionDecisionInput>),
    ).then(
      () => null,
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(DecisionValidationError)
    const { problems } = error as DecisionValidationError
    expect(problems.map((problem) => problem.field)).toEqual([field])
    expect(problems[0].message.length).toBeGreaterThan(0)

    await expectUntouched(exception)
  })

  it('ignores an id, timestamp or owner smuggled into the input', async () => {
    const exception = await exceptionOn(userA, dealA1, 'smuggled_decision_rule')
    const smuggledId = randomUUID()

    actAs(userA.client)
    const decision = await recordDecision({
      ...decisionOn(exception),
      id: smuggledId,
      created_at: '2000-01-01T00:00:00Z',
      user_id: userB.userId,
    } as unknown as RecordExceptionDecisionInput)

    expect(decision.id).not.toBe(smuggledId)
    expect(decision.created_at.startsWith('2000')).toBe(false)
  })
})

describe('decisions: same-deal integrity (composite foreign keys)', () => {
  it('rejects an exception of another deal as invalid_input and changes nothing', async () => {
    const exception = await exceptionOn(userA, dealA1, 'cross_deal_exception_rule')

    actAs(userA.client)
    await expectDatabaseError(
      recordDecision(decisionOn(exception, { deal_id: dealA2.id })),
      'invalid_input',
    )
    await expectUntouched(exception)
  })

  it('rejects a finding of another deal as invalid_input and changes nothing', async () => {
    const exception = await exceptionOn(userA, dealA1, 'cross_deal_finding_rule')
    const foreignFinding = await findingOn(userA, dealA2)

    actAs(userA.client)
    await expectDatabaseError(
      recordDecision(decisionOn(exception, { considered_finding_id: foreignFinding })),
      'invalid_input',
    )
    await expectUntouched(exception)
  })

  it('rejects an exception that does not exist as invalid_input', async () => {
    actAs(userA.client)
    await expectDatabaseError(
      recordDecision({
        deal_id: dealA1.id,
        exception_id: randomUUID(),
        decision_type: 'approve',
        rationale: 'No such exception.',
      }),
      'invalid_input',
    )
  })
})

describe("decisions: user B cannot reach user A's Decisions", () => {
  let exception: DealException
  let decisionId: string

  beforeAll(async () => {
    exception = await exceptionOn(userA, dealA1, 'isolation_decision_rule')
    actAs(userA.client)
    decisionId = (await recordDecision(decisionOn(exception))).id
  })

  it('cannot get or list them', async () => {
    actAs(userB.client)
    expect(await getDecision(decisionId)).toBeNull()
    expect(await listDecisions(dealA1.id)).toEqual([])
    expect(await listExceptionDecisions(exception.id)).toEqual([])
  })

  it("cannot record a Decision on A's deal", async () => {
    const open = await exceptionOn(userA, dealA1, 'b_decides_on_a_rule')

    actAs(userB.client)
    await expectDatabaseError(recordDecision(decisionOn(open)), 'not_permitted')
    await expectUntouched(open)
  })

  it("cannot attach A's exception to B's own deal", async () => {
    const open = await exceptionOn(userA, dealA1, 'b_borrows_a_rule')

    actAs(userB.client)
    await expectDatabaseError(
      recordDecision(decisionOn(open, { deal_id: dealB.id })),
      'invalid_input',
    )
    await expectUntouched(open)
  })
})

describe('decisions: anonymous access is refused', () => {
  it('cannot read or record Decisions', async () => {
    const exception = await exceptionOn(userA, dealA2, 'anonymous_decision_rule')

    actAs(anonymous)
    await expectDatabaseError(listDecisions(dealA2.id), 'not_permitted')
    await expectDatabaseError(getDecision(randomUUID()), 'not_permitted')
    await expectDatabaseError(recordDecision(decisionOn(exception)), 'not_permitted')

    await expectUntouched(exception)
  })
})

describe('decisions: immutable and not independently deletable', () => {
  let decisionId: string

  beforeAll(async () => {
    const exception = await exceptionOn(userA, dealA2, 'immutable_decision_rule')
    actAs(userA.client)
    decisionId = (await recordDecision(decisionOn(exception))).id
  })

  it('offers no function that could change or delete a Decision', () => {
    expect(Object.keys(decisionsModule).sort()).toEqual([
      'getDecision',
      'listDecisions',
      'listExceptionDecisions',
      'recordDecision',
    ])
  })

  it.each(['decision_type', 'rationale', 'conditions', 'exception_id'] as const)(
    'is enforced by the database: %s is not updatable, even by the owner',
    async (column) => {
      actAs(userA.client)
      const before = await getDecision(decisionId)
      const values = {
        decision_type: 'reject',
        rationale: 'Rewritten',
        conditions: 'Rewritten',
        exception_id: null,
      }

      const { error } = await userA.client
        .from('decisions')
        .update({ [column]: values[column] } as TablesUpdate<'decisions'>)
        .eq('id', decisionId)

      expect(error?.code).toBe('42501')
      expect(await getDecision(decisionId)).toEqual(before)
    },
  )

  it('refuses a direct delete, even by the owner', async () => {
    const { error } = await userA.client.from('decisions').delete().eq('id', decisionId)

    expect(error?.code).toBe('42501')
    actAs(userA.client)
    expect((await getDecision(decisionId))?.id).toBe(decisionId)
  })

  it('removes Decisions when their deal is deleted', async () => {
    actAs(userA.client)
    const doomed = await createTestDeal('doomed decisions deal', dealA1.account_id)
    const exception = await exceptionOn(userA, doomed, 'doomed_decision_rule')
    actAs(userA.client)
    const decision = await recordDecision(decisionOn(exception))

    expect((await deleteDeal(doomed.id))?.id).toBe(doomed.id)
    expect(await getDecision(decision.id)).toBeNull()
  })
})
