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
 * Integration tests for app/lib/db/ai-findings.ts against the hosted canonical
 * database, run as real users.
 *
 * As in the other data-access tests, only client construction is replaced
 * (J3): `getSupabaseClient()` returns whichever real client `actAs()`
 * selected, so every query meets the real grants and row level security.
 * Nothing uses a service-role key.
 *
 * Canonical semantics under test (M3, verified by probe before writing):
 * INSERT and SELECT; UPDATE of `status` only; no DELETE — a finding
 * disappears only with its deal. A finding is never a Decision: nothing here
 * may create one.
 *
 * Test data: account and deal names start with this run's RUN_PREFIX.
 * `afterAll` deletes this run's accounts for each user and the database
 * cascades to deals and their findings, then fails the run if either user can
 * still see a prefixed account or deal, or any finding on this run's deals.
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
import * as aiFindingsModule from '../../app/lib/db/ai-findings'
import {
  createAccount,
  createAiFinding,
  createDeal,
  DealDeskDatabaseError,
  deleteDeal,
  getAiFinding,
  listAiFindings,
  updateAiFindingStatus,
} from '../../app/lib/db'
import type { TablesUpdate } from '../../app/lib/database.types'
import type {
  AiFinding,
  AiFindingStatus,
  CreateAiFindingInput,
  CreateOtherAiFindingInput,
  Deal,
} from '../../app/lib/deal-desk/domain'

const RUN_PREFIX = `[deal-desk-test ${randomUUID().slice(0, 8)}]`

let userA: SignedInTestUser
let userB: SignedInTestUser
const anonymous = createAnonymousClient()

let dealA1: Deal
let dealA2: Deal

/** Every deal this run created, for the finding leftover check. */
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

/** A valid risk explanation on `deal`, before overrides. */
function riskExplanation(
  deal: Deal,
  overrides: Partial<CreateOtherAiFindingInput> = {},
): CreateOtherAiFindingInput {
  return {
    deal_id: deal.id,
    finding_type: 'risk_explanation',
    content: 'The renewal notice deadline falls within 30 days.',
    model: 'openrouter/test-model',
    prompt_version: 'risk-explanation-v1',
    ...overrides,
  }
}

async function createAsA(input: CreateAiFindingInput): Promise<AiFinding> {
  actAs(userA.client)
  return createAiFinding(input)
}

/** Asserts that `promise` rejects with a DealDeskDatabaseError of `kind` on ai_findings. */
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
  expect((error as DealDeskDatabaseError).table).toBe('ai_findings')
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
  await createAccount({ name: testName('account B') })
})

afterAll(async () => {
  try {
    for (const user of [userA, userB].filter(Boolean)) {
      // Account → deals → findings, by cascade.
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

describe('AI findings: owner (user A)', () => {
  let finding: AiFinding

  it('records a finding as proposed; the database stamps created_at', async () => {
    finding = await createAsA(
      riskExplanation(dealA1, {
        rule_key: 'notice_deadline_window',
        rule_version: '1',
        payload: { days_until_notice: 21, citations: ['a', 'b'] },
      }),
    )

    expect(finding).toMatchObject({
      deal_id: dealA1.id,
      finding_type: 'risk_explanation',
      content: 'The renewal notice deadline falls within 30 days.',
      rule_key: 'notice_deadline_window',
      rule_version: '1',
      model: 'openrouter/test-model',
      prompt_version: 'risk-explanation-v1',
      status: 'proposed',
      payload: { days_until_notice: 21, citations: ['a', 'b'] },
    })
    expect(typeof finding.id).toBe('string')
    expect(typeof finding.created_at).toBe('string')
    expect(finding).not.toHaveProperty('user_id')
  })

  it('records a provision candidate with its payload', async () => {
    const candidate = await createAsA({
      deal_id: dealA1.id,
      finding_type: 'provision_candidate',
      content: 'Liability appears capped at 12 months of fees.',
      payload: { provision_type: 'liability_cap', value_numeric: 12 },
      model: 'openrouter/test-model',
      prompt_version: 'extract-v1',
    })

    expect(candidate).toMatchObject({
      finding_type: 'provision_candidate',
      payload: { provision_type: 'liability_cap', value_numeric: 12 },
      rule_key: null,
      rule_version: null,
      status: 'proposed',
    })
  })

  it('gets the finding by id', async () => {
    actAs(userA.client)
    expect(await getAiFinding(finding.id)).toEqual(finding)
  })

  it("lists the deal's findings newest first, and only that deal's", async () => {
    const other = await createAsA(riskExplanation(dealA2))
    const newest = await createAsA(riskExplanation(dealA1, { finding_type: 'deal_summary' }))

    actAs(userA.client)
    const findings = await listAiFindings(dealA1.id)
    const ids = findings.map((f) => f.id)

    expect(ids[0]).toBe(newest.id)
    expect(ids).toContain(finding.id)
    expect(ids).not.toContain(other.id)
    expect(findings.every((f) => f.deal_id === dealA1.id)).toBe(true)
  })

  it.each<AiFindingStatus>(['accepted', 'rejected', 'superseded', 'proposed'])(
    'updates the status to %s and changes nothing else',
    async (status) => {
      actAs(userA.client)
      const updated = await updateAiFindingStatus(finding.id, status)

      expect(updated).toEqual({ ...finding, status })
    },
  )

  it('returns null or an empty list for what does not exist', async () => {
    actAs(userA.client)
    const missing = randomUUID()

    expect(await getAiFinding(missing)).toBeNull()
    expect(await updateAiFindingStatus(missing, 'rejected')).toBeNull()
    expect(await listAiFindings(missing)).toEqual([])
  })
})

describe('AI findings: never a Decision', () => {
  it('offers no function that could create or change a Decision', () => {
    const decisionFunctions = Object.keys(aiFindingsModule).filter((name) =>
      /decision/i.test(name),
    )

    expect(decisionFunctions).toEqual([])
  })

  it('records findings and status changes without creating a Decision', async () => {
    actAs(userA.client)
    const deal = await createTestDeal('no decision deal', dealA1.account_id)
    const finding = await createAsA(riskExplanation(deal))
    actAs(userA.client)
    await updateAiFindingStatus(finding.id, 'accepted')

    expect(await decisionCount(deal.id)).toBe(0)
  })
})

describe("AI findings: user B cannot reach user A's findings", () => {
  let finding: AiFinding

  beforeAll(async () => {
    finding = await createAsA(riskExplanation(dealA1, { finding_type: 'answer' }))
  })

  it('cannot get or list them', async () => {
    actAs(userB.client)
    expect(await getAiFinding(finding.id)).toBeNull()
    expect(await listAiFindings(dealA1.id)).toEqual([])
  })

  it('cannot change their status: nothing matches and nothing changes', async () => {
    actAs(userB.client)
    expect(await updateAiFindingStatus(finding.id, 'rejected')).toBeNull()

    actAs(userA.client)
    expect(await getAiFinding(finding.id)).toEqual(finding)
  })

  it("cannot record a finding on A's deal", async () => {
    actAs(userB.client)
    await expectDatabaseError(createAiFinding(riskExplanation(dealA1)), 'not_permitted')
  })
})

describe('AI findings: anonymous access is refused', () => {
  let finding: AiFinding

  beforeAll(async () => {
    finding = await createAsA(riskExplanation(dealA2, { finding_type: 'answer' }))
  })

  it('cannot read findings', async () => {
    actAs(anonymous)
    await expectDatabaseError(listAiFindings(dealA2.id), 'not_permitted')
    await expectDatabaseError(getAiFinding(finding.id), 'not_permitted')
  })

  it('cannot record or update findings', async () => {
    actAs(anonymous)
    await expectDatabaseError(createAiFinding(riskExplanation(dealA2)), 'not_permitted')
    await expectDatabaseError(updateAiFindingStatus(finding.id, 'accepted'), 'not_permitted')

    actAs(userA.client)
    expect(await getAiFinding(finding.id)).toEqual(finding)
  })
})

describe('AI findings: nothing outside the granted columns reaches the database', () => {
  it('ignores ownership, identity, timestamp and status smuggled into a create', async () => {
    const smuggledId = randomUUID()
    const finding = await createAsA({
      ...riskExplanation(dealA1),
      user_id: userB.userId,
      id: smuggledId,
      created_at: '2000-01-01T00:00:00Z',
      status: 'accepted',
    } as unknown as CreateAiFindingInput)

    expect(finding.id).not.toBe(smuggledId)
    expect(finding.created_at.startsWith('2000')).toBe(false)
    // A finding cannot be born accepted: acceptance is a later human review.
    expect(finding.status).toBe('proposed')
  })

  it.each([
    ['content', 'Rewritten by someone'],
    ['payload', { forged: true }],
    ['model', 'another-model'],
    ['prompt_version', 'v999'],
    ['finding_type', 'deal_summary'],
    ['rule_key', 'forged_rule'],
    ['deal_id', 'dealA2'],
  ] as const)('is enforced by the database: %s is not updatable', async (column, value) => {
    const finding = await createAsA(riskExplanation(dealA1))
    const patch = {
      [column]: value === 'dealA2' ? dealA2.id : value,
    } as TablesUpdate<'ai_findings'>

    const { error } = await userA.client
      .from('ai_findings')
      .update(patch)
      .eq('id', finding.id)

    expect(error?.code).toBe('42501')
    actAs(userA.client)
    expect(await getAiFinding(finding.id)).toEqual(finding)
  })
})

describe('AI findings: not independently deletable', () => {
  it('offers no delete function', () => {
    expect('deleteAiFinding' in db).toBe(false)
  })

  it('refuses a direct delete, even by the owner', async () => {
    const finding = await createAsA(riskExplanation(dealA1))

    const { error } = await userA.client.from('ai_findings').delete().eq('id', finding.id)

    expect(error?.code).toBe('42501')
    actAs(userA.client)
    expect(await getAiFinding(finding.id)).toEqual(finding)
  })

  it('removes findings when their deal is deleted', async () => {
    actAs(userA.client)
    const deal = await createTestDeal('doomed findings deal', dealA1.account_id)
    const finding = await createAsA(riskExplanation(deal))

    actAs(userA.client)
    expect((await deleteDeal(deal.id))?.id).toBe(deal.id)
    expect(await getAiFinding(finding.id)).toBeNull()
  })
})

describe('AI findings: invalid references and values', () => {
  it('refuses a finding on a deal that does not exist as not_permitted', async () => {
    // The insert policy admits only the caller's own deals, checked before the
    // foreign key, as for evidence and provisions.
    actAs(userA.client)
    await expectDatabaseError(
      createAiFinding(riskExplanation(dealA1, { deal_id: randomUUID() })),
      'not_permitted',
    )
  })

  it.each([
    ['a provision candidate without a payload', { finding_type: 'provision_candidate', payload: null }],
    ['a rule key without a rule version', { rule_key: 'notice_deadline_window' }],
    ['a rule version without a rule key', { rule_version: '1' }],
    ['an unknown finding type', { finding_type: 'decision' }],
  ])('rejects %s as invalid_input', async (_label, overrides) => {
    actAs(userA.client)
    await expectDatabaseError(
      createAiFinding({
        ...riskExplanation(dealA1),
        ...overrides,
      } as unknown as CreateAiFindingInput),
      'invalid_input',
    )
  })

  it('rejects an unknown status on update and leaves the finding unchanged', async () => {
    const finding = await createAsA(riskExplanation(dealA1))

    actAs(userA.client)
    await expectDatabaseError(
      updateAiFindingStatus(finding.id, 'approved' as AiFindingStatus),
      'invalid_input',
    )
    expect(await getAiFinding(finding.id)).toEqual(finding)
  })
})
