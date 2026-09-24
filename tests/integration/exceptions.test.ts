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
 * Integration tests for app/lib/db/exceptions.ts against the hosted canonical
 * database, run as real users.
 *
 * As in the other data-access tests, only client construction is replaced
 * (J3): `getSupabaseClient()` returns whichever real client `actAs()`
 * selected, so every query meets the real grants and row level security.
 * Nothing uses a service-role key.
 *
 * Canonical semantics under test (M3, verified by probe before writing):
 * INSERT and SELECT; UPDATE of `status` only; no DELETE — an exception
 * disappears only with its deal. `status_changed_at` is set by a trigger when,
 * and only when, the status changes (E9). At most one live exception per
 * (deal, rule_key). `source_finding_id` is `on delete no action` (E10);
 * `provision_id` is `on delete set null`.
 *
 * `decided` and `dismissed` are set by recording a Decision (E5, E6), which
 * tests/integration/decisions.test.ts covers. The database would accept them
 * from a plain status update; this module refuses to send them.
 *
 * Test data: account and deal names start with this run's RUN_PREFIX.
 * `afterAll` deletes this run's accounts for each user and the database
 * cascades to deals, exceptions, findings and provisions, then fails the run if
 * either user can still see a prefixed account or deal, or any exception on
 * this run's deals.
 */

const current = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('../../app/lib/supabase', () => ({
  getSupabaseClient: () => {
    if (!current.client) throw new Error('No test client selected: call actAs().')
    return current.client
  },
}))

// Imported after vi.mock is registered (vi.mock is hoisted above imports).
import * as db from '../../app/lib/db'
import * as exceptionsModule from '../../app/lib/db/exceptions'
import {
  createAccount,
  createAiFinding,
  createDeal,
  createException,
  createProvision,
  DealDeskDatabaseError,
  deleteDeal,
  deleteProvision,
  getAiFinding,
  getException,
  listExceptions,
  updateExceptionStatus,
} from '../../app/lib/db'
import type { TablesUpdate } from '../../app/lib/database.types'
import type {
  CreateDeterministicExceptionInput,
  CreateExceptionInput,
  Deal,
  DealException,
  ExceptionReviewStatus,
} from '../../app/lib/deal-desk/domain'

const RUN_PREFIX = `[deal-desk-test ${randomUUID().slice(0, 8)}]`

let userA: SignedInTestUser
let userB: SignedInTestUser
const anonymous = createAnonymousClient()

let dealA1: Deal
let dealA2: Deal
let dealB: Deal

/** Every deal this run created, for the exception leftover check. */
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

/** A deterministic exception on `deal` for `ruleKey`, before overrides. */
function deterministic(
  deal: Deal,
  ruleKey: string,
  overrides: Partial<CreateDeterministicExceptionInput> = {},
): CreateDeterministicExceptionInput {
  return {
    deal_id: deal.id,
    rule_key: ruleKey,
    rule_version: '1',
    kind: 'non_standard_provision',
    severity: 'high',
    title: 'Liability cap below standard',
    why: 'The cap is 6 months of fees; the standard is at least 12.',
    origin: 'deterministic',
    ...overrides,
  }
}

async function createAsA(input: CreateExceptionInput): Promise<DealException> {
  actAs(userA.client)
  return createException(input)
}

/** Records an AI finding on `deal` as `user`, through the findings module. */
async function findingOn(user: SignedInTestUser, deal: Deal): Promise<string> {
  actAs(user.client)
  const finding = await createAiFinding({
    deal_id: deal.id,
    finding_type: 'exception_proposal',
    content: 'This liability cap looks non-standard.',
    model: 'openrouter/test-model',
    prompt_version: 'exception-proposal-v1',
  })
  return finding.id
}

/** Asserts that `promise` rejects with a DealDeskDatabaseError of `kind` on exceptions. */
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
  expect((error as DealDeskDatabaseError).table).toBe('exceptions')
}

/** Counts the Decisions on `dealId` visible to user A, read directly. */
async function decisionCount(dealId: string): Promise<number> {
  const { data, error } = await userA.client
    .from('decisions')
    .select('id')
    .eq('deal_id', dealId)
  if (error) throw new Error(`Decision lookup failed (${error.code}).`)
  return data.length
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
      // Account → deals → exceptions, findings, provisions, by cascade.
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
        user.client.from('ai_findings').select('id').in('deal_id', [...createdDealIds]),
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

describe('exceptions: owner lifecycle (user A)', () => {
  let exception: DealException

  it('raises a deterministic exception as open; the database stamps status_changed_at', async () => {
    exception = await createAsA(deterministic(dealA1, 'liability_cap_minimum'))

    expect(exception).toMatchObject({
      deal_id: dealA1.id,
      rule_key: 'liability_cap_minimum',
      rule_version: '1',
      kind: 'non_standard_provision',
      severity: 'high',
      title: 'Liability cap below standard',
      why: 'The cap is 6 months of fees; the standard is at least 12.',
      origin: 'deterministic',
      source_finding_id: null,
      provision_id: null,
      status: 'open',
    })
    expect(typeof exception.status_changed_at).toBe('string')
    expect(exception).not.toHaveProperty('user_id')
  })

  it('gets the exception by id', async () => {
    actAs(userA.client)
    expect(await getException(exception.id)).toEqual(exception)
  })

  it("lists the deal's exceptions newest first, and only that deal's", async () => {
    const other = await createAsA(deterministic(dealA2, 'liability_cap_minimum'))
    const newer = await createAsA(
      deterministic(dealA1, 'discount_threshold', {
        kind: 'threshold_breach',
        severity: 'medium',
      }),
    )

    actAs(userA.client)
    const ids = (await listExceptions(dealA1.id)).map((e) => e.id)

    expect(ids).toEqual([newer.id, exception.id])
    expect(ids).not.toContain(other.id)
  })

  it('moves the status to under_review; status_changed_at and updated_at move', async () => {
    actAs(userA.client)
    const updated = await updateExceptionStatus(exception.id, 'under_review')

    expect(updated).toMatchObject({ id: exception.id, status: 'under_review' })
    expect(Date.parse(updated!.status_changed_at)).toBeGreaterThan(
      Date.parse(exception.status_changed_at),
    )
    expect(Date.parse(updated!.updated_at)).toBeGreaterThan(
      Date.parse(exception.updated_at),
    )
    // Nothing but the status and its timestamps changed.
    expect({
      ...updated,
      status: exception.status,
      status_changed_at: exception.status_changed_at,
      updated_at: exception.updated_at,
    }).toEqual(exception)
    exception = updated!
  })

  it('leaves status_changed_at alone when the status does not change (E9)', async () => {
    actAs(userA.client)
    const again = await updateExceptionStatus(exception.id, 'under_review')

    expect(again?.status_changed_at).toBe(exception.status_changed_at)
    expect(Date.parse(again!.updated_at)).toBeGreaterThan(
      Date.parse(exception.updated_at),
    )
    exception = again!
  })

  it('moves the status back to open', async () => {
    actAs(userA.client)
    const reopened = await updateExceptionStatus(exception.id, 'open')

    expect(reopened?.status).toBe('open')
    expect(Date.parse(reopened!.status_changed_at)).toBeGreaterThan(
      Date.parse(exception.status_changed_at),
    )
  })

  it('returns null or an empty list for what does not exist', async () => {
    actAs(userA.client)
    const missing = randomUUID()

    expect(await getException(missing)).toBeNull()
    expect(await updateExceptionStatus(missing, 'under_review')).toBeNull()
    expect(await listExceptions(missing)).toEqual([])
  })
})

describe('exceptions: decided and dismissed are reserved for Decisions', () => {
  it.each(['decided', 'dismissed'])(
    'refuses to set %s without sending anything to the database',
    async (status) => {
      const exception = await createAsA(deterministic(dealA1, `reserved_${status}`))

      actAs(userA.client)
      await expect(
        updateExceptionStatus(exception.id, status as ExceptionReviewStatus),
      ).rejects.toThrow(/Decision/)

      expect(await getException(exception.id)).toEqual(exception)
      expect(await decisionCount(dealA1.id)).toBe(0)
    },
  )

  it('ignores a status smuggled into a create: every exception starts open', async () => {
    const exception = await createAsA({
      ...deterministic(dealA1, 'smuggled_status'),
      status: 'decided',
    } as unknown as CreateExceptionInput)

    expect(exception.status).toBe('open')
  })

  it('offers no function that could create or change a Decision', () => {
    expect(
      Object.keys(exceptionsModule).filter((name) => /decision/i.test(name)),
    ).toEqual([])
  })
})

describe("exceptions: user B cannot reach user A's exceptions", () => {
  let exception: DealException

  beforeAll(async () => {
    exception = await createAsA(deterministic(dealA1, 'isolation_rule'))
  })

  it('cannot get or list them', async () => {
    actAs(userB.client)
    expect(await getException(exception.id)).toBeNull()
    expect(await listExceptions(dealA1.id)).toEqual([])
  })

  it('cannot change their status: nothing matches and nothing changes', async () => {
    actAs(userB.client)
    expect(await updateExceptionStatus(exception.id, 'under_review')).toBeNull()

    actAs(userA.client)
    expect(await getException(exception.id)).toEqual(exception)
  })

  it("cannot raise an exception on A's deal", async () => {
    actAs(userB.client)
    await expectDatabaseError(
      createException(deterministic(dealA1, 'b_on_a_rule')),
      'not_permitted',
    )
  })
})

describe('exceptions: anonymous access is refused', () => {
  let exception: DealException

  beforeAll(async () => {
    exception = await createAsA(deterministic(dealA2, 'anonymous_rule'))
  })

  it('cannot read exceptions', async () => {
    actAs(anonymous)
    await expectDatabaseError(listExceptions(dealA2.id), 'not_permitted')
    await expectDatabaseError(getException(exception.id), 'not_permitted')
  })

  it('cannot raise or update exceptions', async () => {
    actAs(anonymous)
    await expectDatabaseError(
      createException(deterministic(dealA2, 'anonymous_create')),
      'not_permitted',
    )
    await expectDatabaseError(
      updateExceptionStatus(exception.id, 'under_review'),
      'not_permitted',
    )

    actAs(userA.client)
    expect(await getException(exception.id)).toEqual(exception)
  })
})

describe('exceptions: identity, provenance and linkage are fixed at insert (E4)', () => {
  it('ignores ownership, identity and timestamps smuggled into a create', async () => {
    const smuggledId = randomUUID()
    const exception = await createAsA({
      ...deterministic(dealA2, 'smuggled_identity'),
      user_id: userB.userId,
      id: smuggledId,
      status_changed_at: '2000-01-01T00:00:00Z',
      created_at: '2000-01-01T00:00:00Z',
    } as unknown as CreateExceptionInput)

    expect(exception.id).not.toBe(smuggledId)
    expect(exception.status_changed_at.startsWith('2000')).toBe(false)
    expect(exception.created_at.startsWith('2000')).toBe(false)
  })

  it.each([
    'title',
    'why',
    'severity',
    'kind',
    'rule_key',
    'rule_version',
    'origin',
    'source_finding_id',
    'provision_id',
    'deal_id',
    'status_changed_at',
  ] as const)('is enforced by the database: %s is not updatable', async (column) => {
    const exception = await createAsA(deterministic(dealA2, `fixed_${column}`))
    const values: Record<typeof column, unknown> = {
      title: 'Rewritten',
      why: 'Rewritten',
      severity: 'low',
      kind: 'timing_risk',
      rule_key: 'rewritten_rule',
      rule_version: '2',
      origin: 'ai',
      source_finding_id: await findingOn(userA, dealA2),
      provision_id: randomUUID(),
      deal_id: dealA1.id,
      status_changed_at: '2000-01-01T00:00:00Z',
    }
    const patch = { [column]: values[column] } as TablesUpdate<'exceptions'>

    const { error } = await userA.client
      .from('exceptions')
      .update(patch)
      .eq('id', exception.id)

    expect(error?.code).toBe('42501')
    actAs(userA.client)
    expect(await getException(exception.id)).toEqual(exception)
  })
})

describe('exceptions: AI origin and source findings (E10)', () => {
  let deal: Deal

  beforeAll(async () => {
    actAs(userA.client)
    deal = await createTestDeal('ai origin deal', dealA1.account_id)
  })

  it('rejects an AI-origin exception without a source finding as invalid_input', async () => {
    actAs(userA.client)
    await expectDatabaseError(
      createException({
        ...deterministic(deal, 'ai_without_finding'),
        origin: 'ai',
      } as unknown as CreateExceptionInput),
      'invalid_input',
    )
  })

  it('raises an AI-origin exception from a finding of the same deal', async () => {
    const findingId = await findingOn(userA, deal)
    const exception = await createAsA({
      ...deterministic(deal, 'ai_liability_review'),
      origin: 'ai',
      source_finding_id: findingId,
    })

    expect(exception).toMatchObject({
      origin: 'ai',
      source_finding_id: findingId,
      status: 'open',
    })
  })

  it('rejects a finding of another deal as invalid_input', async () => {
    const otherDealFinding = await findingOn(userA, dealA2)

    actAs(userA.client)
    await expectDatabaseError(
      createException({
        ...deterministic(deal, 'ai_cross_deal'),
        origin: 'ai',
        source_finding_id: otherDealFinding,
      }),
      'invalid_input',
    )
  })

  it("rejects user A's finding in user B's exception as invalid_input", async () => {
    const findingOfA = await findingOn(userA, dealA1)

    actAs(userB.client)
    await expectDatabaseError(
      createException({
        ...deterministic(dealB, 'ai_cross_user'),
        origin: 'ai',
        source_finding_id: findingOfA,
      }),
      'invalid_input',
    )
    expect(await listExceptions(dealB.id)).toEqual([])
  })

  it('protects the referenced finding: it cannot be deleted on its own', async () => {
    const findingId = await findingOn(userA, deal)
    await createAsA({
      ...deterministic(deal, 'ai_protected_finding'),
      origin: 'ai',
      source_finding_id: findingId,
    })

    const { error } = await userA.client.from('ai_findings').delete().eq('id', findingId)

    expect(error?.code).toBe('42501')
    actAs(userA.client)
    expect((await getAiFinding(findingId))?.id).toBe(findingId)
  })

  it('does not block whole-deal deletion: the no-action reference goes with the deal', async () => {
    actAs(userA.client)
    const doomed = await createTestDeal('doomed ai deal', dealA1.account_id)
    const findingId = await findingOn(userA, doomed)
    const exception = await createAsA({
      ...deterministic(doomed, 'ai_doomed'),
      origin: 'ai',
      source_finding_id: findingId,
    })

    actAs(userA.client)
    expect((await deleteDeal(doomed.id))?.id).toBe(doomed.id)
    expect(await getException(exception.id)).toBeNull()
    expect(await getAiFinding(findingId)).toBeNull()
  })
})

describe('exceptions: provisions and rules', () => {
  let deal: Deal

  beforeAll(async () => {
    actAs(userA.client)
    deal = await createTestDeal('provision link deal', dealA1.account_id)
  })

  it('links an exception to a provision of the same deal', async () => {
    actAs(userA.client)
    const provision = await createProvision({
      deal_id: deal.id,
      provision_type: 'liability_cap',
      value_text: '6 months of fees',
      value_numeric: 6,
      value_unit: 'months_of_fees',
      source: 'human_entered',
    })

    const exception = await createAsA(
      deterministic(deal, 'linked_to_provision', { provision_id: provision.id }),
    )
    expect(exception.provision_id).toBe(provision.id)
  })

  it('rejects a provision of another deal as invalid_input', async () => {
    actAs(userA.client)
    const foreign = await createProvision({
      deal_id: dealA2.id,
      provision_type: 'discount',
      value_text: '25 %',
      value_numeric: 25,
      value_unit: 'percent',
      source: 'human_entered',
    })

    await expectDatabaseError(
      createException(deterministic(deal, 'foreign_provision', { provision_id: foreign.id })),
      'invalid_input',
    )
  })

  it('keeps the exception and clears its link when the provision is deleted', async () => {
    actAs(userA.client)
    const provision = await createProvision({
      deal_id: deal.id,
      provision_type: 'payment_terms',
      value_text: 'Net 90',
      value_numeric: 90,
      value_unit: 'days',
      source: 'human_entered',
    })
    const exception = await createAsA(
      deterministic(deal, 'payment_terms_long', { provision_id: provision.id }),
    )

    actAs(userA.client)
    expect(await deleteProvision(provision.id)).not.toBeNull()

    const after = await getException(exception.id)
    expect(after).toMatchObject({ id: exception.id, provision_id: null, status: 'open' })
  })

  it('allows only one live exception per rule on a deal', async () => {
    await createAsA(deterministic(deal, 'single_live_rule'))

    actAs(userA.client)
    await expectDatabaseError(
      createException(deterministic(deal, 'single_live_rule')),
      'invalid_input',
    )
  })

  it('allows a new exception for a rule once the live one is resolved', async () => {
    const live = await createAsA(deterministic(deal, 'resolved_rule'))
    // Resolution is normally a Decision (E5, E6). The database also accepts a
    // plain status update, used here directly to keep this test independent
    // of the decisions module; the application layer never sends it.
    const { error } = await userA.client
      .from('exceptions')
      .update({ status: 'dismissed' })
      .eq('id', live.id)
    expect(error).toBeNull()

    const next = await createAsA(deterministic(deal, 'resolved_rule'))
    expect(next.status).toBe('open')
  })
})

describe('exceptions: not independently deletable', () => {
  it('offers no delete function', () => {
    expect('deleteException' in db).toBe(false)
  })

  it('refuses a direct delete, even by the owner', async () => {
    const exception = await createAsA(deterministic(dealA2, 'undeletable_rule'))

    const { error } = await userA.client.from('exceptions').delete().eq('id', exception.id)

    expect(error?.code).toBe('42501')
    actAs(userA.client)
    expect(await getException(exception.id)).toEqual(exception)
  })

  it('removes exceptions when their deal is deleted', async () => {
    actAs(userA.client)
    const doomed = await createTestDeal('doomed exceptions deal', dealA1.account_id)
    const exception = await createAsA(deterministic(doomed, 'doomed_rule'))

    actAs(userA.client)
    expect((await deleteDeal(doomed.id))?.id).toBe(doomed.id)
    expect(await getException(exception.id)).toBeNull()
  })
})

describe('exceptions: invalid references and values', () => {
  it('refuses an exception on a deal that does not exist as not_permitted', async () => {
    actAs(userA.client)
    await expectDatabaseError(
      createException(deterministic(dealA1, 'missing_deal_rule', { deal_id: randomUUID() })),
      'not_permitted',
    )
  })

  it('rejects a source finding that does not exist as invalid_input', async () => {
    actAs(userA.client)
    await expectDatabaseError(
      createException({
        ...deterministic(dealA1, 'missing_finding_rule'),
        origin: 'ai',
        source_finding_id: randomUUID(),
      }),
      'invalid_input',
    )
  })

  it.each([
    ['an uppercase rule key', { rule_key: 'Liability-Cap' }],
    ['a rule key that is too short', { rule_key: 'ab' }],
    ['a rule key starting with a digit', { rule_key: '1_rule' }],
    ['an unknown kind', { kind: 'risk' }],
    ['an unknown severity', { severity: 'critical' }],
    ['an unknown origin', { origin: 'human' }],
  ])('rejects %s as invalid_input', async (_label, overrides) => {
    actAs(userA.client)
    await expectDatabaseError(
      createException({
        ...deterministic(dealA1, 'invalid_value_rule'),
        ...overrides,
      } as unknown as CreateExceptionInput),
      'invalid_input',
    )
  })
})
