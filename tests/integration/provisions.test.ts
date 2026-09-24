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
 * Integration tests for app/lib/db/provisions.ts against the hosted canonical
 * database, run as real users.
 *
 * As in the other data-access tests, only client construction is replaced
 * (J3): `getSupabaseClient()` returns whichever real client `actAs()`
 * selected, so every query meets the real grants and row level security.
 * Nothing uses a service-role key.
 *
 * Canonical semantics under test (M3, verified by probe before writing):
 * - provisions: INSERT, SELECT, DELETE; UPDATE of value_text, value_numeric,
 *   value_unit and confirmed_at only; one per (deal, provision_type);
 *   'ai_confirmed' requires a same-deal source finding.
 * - provision_excerpts (citations): INSERT, SELECT, DELETE; no UPDATE.
 *
 * AI findings are out of scope for the application layer, so the findings a
 * provision cites are inserted here directly by their owner, as test fixtures.
 *
 * Test data: account, deal and evidence titles start with this run's
 * RUN_PREFIX. `afterAll` deletes this run's accounts for each user and the
 * database cascades to deals, provisions, citations, evidence and findings,
 * then fails the run if either user can still see a prefixed account or deal,
 * or any provision on this run's deals.
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
  addProvisionExcerpt,
  createAccount,
  createDeal,
  createEvidenceExcerpt,
  createEvidenceItem,
  createProvision,
  DealDeskDatabaseError,
  deleteDeal,
  deleteProvision,
  getEvidenceExcerpt,
  getProvision,
  listProvisionExcerpts,
  listProvisions,
  removeProvisionExcerpt,
  updateProvision,
} from '../../app/lib/db'
import type { TablesUpdate } from '../../app/lib/database.types'
import type {
  CreateHumanEnteredProvisionInput,
  CreateProvisionInput,
  Deal,
  EvidenceExcerpt,
  Provision,
  UpdateProvisionInput,
} from '../../app/lib/deal-desk/domain'

const RUN_PREFIX = `[deal-desk-test ${randomUUID().slice(0, 8)}]`

let userA: SignedInTestUser
let userB: SignedInTestUser
const anonymous = createAnonymousClient()

let dealA1: Deal
let dealA2: Deal
let dealB: Deal

/** Every deal this run created, for the provision leftover check. */
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

/** A human-entered liability cap on `deal`, before overrides. */
function liabilityCap(
  deal: Deal,
  overrides: Partial<CreateHumanEnteredProvisionInput> = {},
): CreateHumanEnteredProvisionInput {
  return {
    deal_id: deal.id,
    provision_type: 'liability_cap',
    value_text: '12 months of fees',
    value_numeric: 12,
    value_unit: 'months_of_fees',
    source: 'human_entered',
    ...overrides,
  }
}

async function createAsA(input: CreateProvisionInput): Promise<Provision> {
  actAs(userA.client)
  return createProvision(input)
}

/**
 * Inserts an AI finding directly as its owner. A test fixture only: the
 * application has no findings module yet.
 */
async function insertFinding(client: TestClient, deal: Deal): Promise<string> {
  const { data, error } = await client
    .from('ai_findings')
    .insert({
      deal_id: deal.id,
      finding_type: 'provision_candidate',
      content: 'Liability appears capped at 12 months of fees.',
      payload: { provision_type: 'liability_cap' },
      model: 'test-model',
      prompt_version: 'test-v1',
    })
    .select('id')
    .single()
  if (error) throw new Error(`Finding fixture failed (${error.code}).`)
  return data.id
}

/** Creates an evidence item with one excerpt on `deal`, as user A. */
async function createExcerpt(deal: Deal, label: string): Promise<EvidenceExcerpt> {
  actAs(userA.client)
  const item = await createEvidenceItem({
    deal_id: deal.id,
    evidence_type: 'msa',
    title: testName(label),
    body_text: 'Liability is capped at twelve months of fees.',
  })
  return createEvidenceExcerpt({
    evidence_item_id: item.id,
    deal_id: deal.id,
    ordinal: 0,
    start_offset: 0,
    end_offset: 21,
    content: 'Liability is capped a',
  })
}

/** Asserts that `promise` rejects with a DealDeskDatabaseError of `kind` on `table`. */
async function expectDatabaseError(
  promise: Promise<unknown>,
  kind: DealDeskDatabaseError['kind'],
  table: 'provisions' | 'provision_excerpts' = 'provisions',
) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(DealDeskDatabaseError)
  expect((error as DealDeskDatabaseError).kind).toBe(kind)
  expect((error as DealDeskDatabaseError).table).toBe(table)
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
      // Account → deals → provisions, citations, evidence, findings.
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
        user.client.from('provisions').select('id').in('deal_id', [...createdDealIds]),
        user.client
          .from('provision_excerpts')
          .select('provision_id')
          .in('deal_id', [...createdDealIds]),
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

describe('provisions: owner lifecycle (user A)', () => {
  let provision: Provision

  it('creates a human-entered provision; the database stamps confirmed_at', async () => {
    const before = Date.now()
    provision = await createAsA(liabilityCap(dealA1))

    expect(provision).toMatchObject({
      deal_id: dealA1.id,
      provision_type: 'liability_cap',
      value_text: '12 months of fees',
      value_numeric: 12,
      value_unit: 'months_of_fees',
      source: 'human_entered',
      source_finding_id: null,
    })
    expect(typeof provision.id).toBe('string')
    // Stamped by the database default, within a generous clock-skew window.
    expect(Math.abs(Date.parse(provision.confirmed_at) - before)).toBeLessThan(
      5 * 60_000,
    )
    expect(provision).not.toHaveProperty('user_id')
  })

  it('creates a text-only provision with no numeric value', async () => {
    const residency = await createAsA({
      deal_id: dealA1.id,
      provision_type: 'data_residency',
      value_text: 'EU only',
      source: 'human_entered',
    })

    expect(residency).toMatchObject({ value_numeric: null, value_unit: null })
  })

  it('gets the provision by id', async () => {
    actAs(userA.client)
    expect(await getProvision(provision.id)).toEqual(provision)
  })

  it("lists the deal's provisions by type, and only that deal's", async () => {
    const other = await createAsA(liabilityCap(dealA2))

    actAs(userA.client)
    const provisions = await listProvisions(dealA1.id)

    expect(provisions.map((p) => p.provision_type)).toEqual([
      'data_residency',
      'liability_cap',
    ])
    expect(provisions.map((p) => p.id)).not.toContain(other.id)
  })

  it('updates the value and leaves everything else alone', async () => {
    actAs(userA.client)
    const updated = await updateProvision(provision.id, {
      value_text: '24 months of fees',
      value_numeric: 24,
    })

    expect(updated).toMatchObject({
      id: provision.id,
      provision_type: 'liability_cap',
      value_text: '24 months of fees',
      value_numeric: 24,
      value_unit: 'months_of_fees',
      source: 'human_entered',
      confirmed_at: provision.confirmed_at,
    })
    expect(Date.parse(updated!.updated_at)).toBeGreaterThanOrEqual(
      Date.parse(provision.updated_at),
    )
  })

  it('clears the numeric value and its unit together', async () => {
    actAs(userA.client)
    const updated = await updateProvision(provision.id, {
      value_text: 'Uncapped',
      value_numeric: null,
      value_unit: null,
    })

    expect(updated).toMatchObject({
      value_text: 'Uncapped',
      value_numeric: null,
      value_unit: null,
    })
  })

  it('records a re-confirmation through confirmed_at', async () => {
    const reconfirmedAt = new Date(Date.now() + 60_000).toISOString()

    actAs(userA.client)
    const updated = await updateProvision(provision.id, {
      confirmed_at: reconfirmedAt,
    })

    expect(Date.parse(updated!.confirmed_at)).toBe(Date.parse(reconfirmedAt))
  })

  it('returns the provision unchanged for an update with no fields', async () => {
    actAs(userA.client)
    const before = await getProvision(provision.id)

    expect(await updateProvision(provision.id, {})).toEqual(before)
  })

  it('deletes the provision; the type can then be recorded again', async () => {
    actAs(userA.client)
    const removed = await deleteProvision(provision.id)

    expect(removed?.id).toBe(provision.id)
    expect(await getProvision(provision.id)).toBeNull()

    const again = await createAsA(liabilityCap(dealA1, { value_text: 'Re-entered' }))
    expect(again.provision_type).toBe('liability_cap')
  })

  it('returns null or an empty list for what does not exist', async () => {
    actAs(userA.client)
    const missing = randomUUID()

    expect(await getProvision(missing)).toBeNull()
    expect(await updateProvision(missing, { value_text: 'x' })).toBeNull()
    expect(await deleteProvision(missing)).toBeNull()
    expect(await listProvisions(missing)).toEqual([])
  })
})

describe("provisions: user B cannot reach user A's provision", () => {
  let provision: Provision

  beforeAll(async () => {
    provision = await createAsA({
      deal_id: dealA1.id,
      provision_type: 'payment_terms',
      value_text: 'Net 30',
      value_numeric: 30,
      value_unit: 'days',
      source: 'human_entered',
    })
  })

  async function ownerView() {
    actAs(userA.client)
    return getProvision(provision.id)
  }

  it('cannot get or list it', async () => {
    actAs(userB.client)
    expect(await getProvision(provision.id)).toBeNull()
    expect(await listProvisions(dealA1.id)).toEqual([])
  })

  it('cannot update it: nothing matches and nothing changes', async () => {
    actAs(userB.client)
    expect(await updateProvision(provision.id, { value_text: 'Net 0' })).toBeNull()

    expect(await ownerView()).toEqual(provision)
  })

  it('cannot delete it: nothing matches and the row survives', async () => {
    actAs(userB.client)
    expect(await deleteProvision(provision.id)).toBeNull()

    expect(await ownerView()).toEqual(provision)
  })

  it("cannot create a provision on A's deal", async () => {
    actAs(userB.client)
    await expectDatabaseError(
      createProvision(liabilityCap(dealA1, { provision_type: 'termination' })),
      'not_permitted',
    )

    actAs(userA.client)
    expect(
      (await listProvisions(dealA1.id)).map((p) => p.provision_type),
    ).not.toContain('termination')
  })
})

describe('provisions: anonymous access is refused', () => {
  let provision: Provision

  beforeAll(async () => {
    provision = await createAsA(liabilityCap(dealA2, { provision_type: 'discount', value_text: '10 %', value_numeric: 10, value_unit: 'percent' }))
  })

  it('cannot read provisions', async () => {
    actAs(anonymous)
    await expectDatabaseError(listProvisions(dealA2.id), 'not_permitted')
    await expectDatabaseError(getProvision(provision.id), 'not_permitted')
  })

  it('cannot create, update or delete provisions', async () => {
    actAs(anonymous)
    await expectDatabaseError(
      createProvision(liabilityCap(dealA2, { provision_type: 'governing_law' })),
      'not_permitted',
    )
    await expectDatabaseError(
      updateProvision(provision.id, { value_text: 'x' }),
      'not_permitted',
    )
    await expectDatabaseError(deleteProvision(provision.id), 'not_permitted')

    actAs(userA.client)
    expect(await getProvision(provision.id)).toEqual(provision)
  })

  it('cannot read or write citations', async () => {
    const excerpt = await createExcerpt(dealA2, 'anonymous citation evidence')

    actAs(anonymous)
    await expectDatabaseError(
      listProvisionExcerpts(provision.id),
      'not_permitted',
      'provision_excerpts',
    )
    await expectDatabaseError(
      addProvisionExcerpt({
        provision_id: provision.id,
        excerpt_id: excerpt.id,
        deal_id: dealA2.id,
      }),
      'not_permitted',
      'provision_excerpts',
    )
    await expectDatabaseError(
      removeProvisionExcerpt(provision.id, excerpt.id),
      'not_permitted',
      'provision_excerpts',
    )
  })
})

describe('provisions: nothing outside the granted columns reaches the database', () => {
  it('ignores ownership, identity and confirmation time smuggled into a create', async () => {
    const smuggledId = randomUUID()
    const provision = await createAsA({
      ...liabilityCap(dealA2, { provision_type: 'termination', value_text: '90 days notice', value_numeric: 90, value_unit: 'days' }),
      user_id: userB.userId,
      id: smuggledId,
      confirmed_at: '2000-01-01T00:00:00Z',
    } as unknown as CreateProvisionInput)

    expect(provision.id).not.toBe(smuggledId)
    expect(provision.confirmed_at.startsWith('2000')).toBe(false)
    actAs(userB.client)
    expect(await getProvision(provision.id)).toBeNull()
  })

  it('ignores non-updatable keys smuggled into an update', async () => {
    const provision = await createAsA(
      liabilityCap(dealA2, { provision_type: 'governing_law', value_text: 'German law', value_numeric: null, value_unit: null }),
    )
    const findingId = await insertFinding(userA.client, dealA2)

    actAs(userA.client)
    const updated = await updateProvision(provision.id, {
      value_text: 'Laws of Germany',
      provision_type: 'discount',
      source: 'ai_confirmed',
      source_finding_id: findingId,
      deal_id: dealA1.id,
    } as unknown as UpdateProvisionInput)

    expect(updated).toMatchObject({
      value_text: 'Laws of Germany',
      provision_type: 'governing_law',
      source: 'human_entered',
      source_finding_id: null,
      deal_id: dealA2.id,
    })
  })

  it('is enforced by the database: confirmed_at is not insertable', async () => {
    const { error } = await userA.client.from('provisions').insert({
      deal_id: dealA1.id,
      provision_type: 'auto_renewal',
      value_text: 'Yes',
      source: 'human_entered',
      confirmed_at: '2000-01-01T00:00:00Z',
    })

    expect(error?.code).toBe('42501')
  })

  it.each(['provision_type', 'source', 'source_finding_id', 'deal_id'] as const)(
    'is enforced by the database: %s is not updatable',
    async (column) => {
      const provision = await createAsA(
        liabilityCap(dealA1, { provision_type: 'auto_renewal', value_text: 'Yes', value_numeric: null, value_unit: null }),
      )
      const values = {
        provision_type: 'discount',
        source: 'ai_confirmed',
        source_finding_id: await insertFinding(userA.client, dealA1),
        deal_id: dealA2.id,
      }
      const patch: TablesUpdate<'provisions'> = { [column]: values[column] }

      const { error } = await userA.client
        .from('provisions')
        .update(patch)
        .eq('id', provision.id)

      expect(error?.code).toBe('42501')
      actAs(userA.client)
      expect(await getProvision(provision.id)).toEqual(provision)
      expect(await deleteProvision(provision.id)).not.toBeNull()
    },
  )
})

describe('provisions: AI-confirmed provenance (source_finding_id)', () => {
  let deal: Deal

  beforeAll(async () => {
    actAs(userA.client)
    deal = await createTestDeal('provenance deal', dealA1.account_id)
  })

  it('rejects ai_confirmed without a source finding as invalid_input', async () => {
    const input = {
      ...liabilityCap(deal),
      source: 'ai_confirmed',
    } as unknown as CreateProvisionInput

    actAs(userA.client)
    await expectDatabaseError(createProvision(input), 'invalid_input')
  })

  it('records ai_confirmed with a finding of the same deal', async () => {
    const findingId = await insertFinding(userA.client, deal)
    const provision = await createAsA({
      ...liabilityCap(deal),
      source: 'ai_confirmed',
      source_finding_id: findingId,
    })

    expect(provision).toMatchObject({
      source: 'ai_confirmed',
      source_finding_id: findingId,
    })
  })

  it('rejects a finding of another deal as invalid_input', async () => {
    const otherDealFinding = await insertFinding(userA.client, dealA2)

    actAs(userA.client)
    await expectDatabaseError(
      createProvision({
        ...liabilityCap(deal, { provision_type: 'termination' }),
        source: 'ai_confirmed',
        source_finding_id: otherDealFinding,
      }),
      'invalid_input',
    )
  })

  it("rejects user A's finding in user B's provision as invalid_input", async () => {
    const findingOfA = await insertFinding(userA.client, dealA1)

    actAs(userB.client)
    await expectDatabaseError(
      createProvision({
        ...liabilityCap(dealB),
        source: 'ai_confirmed',
        source_finding_id: findingOfA,
      }),
      'invalid_input',
    )
    expect(await listProvisions(dealB.id)).toEqual([])
  })

  it('allows a human-entered provision to name a finding, as the schema does', async () => {
    const findingId = await insertFinding(userA.client, deal)
    const provision = await createAsA(
      liabilityCap(deal, {
        provision_type: 'payment_terms',
        value_text: 'Net 45',
        value_numeric: 45,
        value_unit: 'days',
        source_finding_id: findingId,
      }),
    )

    expect(provision).toMatchObject({
      source: 'human_entered',
      source_finding_id: findingId,
    })
  })

  it('cannot delete a finding directly, so the reference cannot be orphaned', async () => {
    const findingId = await insertFinding(userA.client, deal)

    const { error } = await userA.client
      .from('ai_findings')
      .delete()
      .eq('id', findingId)

    expect(error?.code).toBe('42501')
  })

  it('removes AI-confirmed provisions with their findings when the deal is deleted', async () => {
    actAs(userA.client)
    const doomed = await createTestDeal('doomed provenance deal', dealA1.account_id)
    const findingId = await insertFinding(userA.client, doomed)
    const provision = await createAsA({
      ...liabilityCap(doomed),
      source: 'ai_confirmed',
      source_finding_id: findingId,
    })

    actAs(userA.client)
    expect((await deleteDeal(doomed.id))?.id).toBe(doomed.id)
    expect(await getProvision(provision.id)).toBeNull()
  })
})

describe('provision citations (provision_excerpts)', () => {
  let provision: Provision
  let excerpt: EvidenceExcerpt

  beforeAll(async () => {
    actAs(userA.client)
    const deal = await createTestDeal('citation deal', dealA1.account_id)
    provision = await createAsA(liabilityCap(deal))
    excerpt = await createExcerpt(deal, 'citation evidence')
  })

  it('links a provision to an excerpt of its own deal and lists the link', async () => {
    actAs(userA.client)
    const citation = await addProvisionExcerpt({
      provision_id: provision.id,
      excerpt_id: excerpt.id,
      deal_id: provision.deal_id,
    })

    expect(citation).toMatchObject({
      provision_id: provision.id,
      excerpt_id: excerpt.id,
      deal_id: provision.deal_id,
    })
    expect(typeof citation.created_at).toBe('string')
    expect(await listProvisionExcerpts(provision.id)).toEqual([citation])
  })

  it('rejects a duplicate link as invalid_input', async () => {
    actAs(userA.client)
    await expectDatabaseError(
      addProvisionExcerpt({
        provision_id: provision.id,
        excerpt_id: excerpt.id,
        deal_id: provision.deal_id,
      }),
      'invalid_input',
      'provision_excerpts',
    )
  })

  it("rejects an excerpt of another of A's deals, whichever deal_id is sent", async () => {
    const otherExcerpt = await createExcerpt(dealA2, 'other deal evidence')

    actAs(userA.client)
    for (const dealId of [provision.deal_id, dealA2.id]) {
      await expectDatabaseError(
        addProvisionExcerpt({
          provision_id: provision.id,
          excerpt_id: otherExcerpt.id,
          deal_id: dealId,
        }),
        'invalid_input',
        'provision_excerpts',
      )
    }
    expect((await listProvisionExcerpts(provision.id)).map((c) => c.excerpt_id)).toEqual([
      excerpt.id,
    ])
  })

  it("keeps user B out of A's citations", async () => {
    actAs(userB.client)
    expect(await listProvisionExcerpts(provision.id)).toEqual([])
    await expectDatabaseError(
      addProvisionExcerpt({
        provision_id: provision.id,
        excerpt_id: excerpt.id,
        deal_id: provision.deal_id,
      }),
      'not_permitted',
      'provision_excerpts',
    )
    expect(await removeProvisionExcerpt(provision.id, excerpt.id)).toBe(false)

    actAs(userA.client)
    expect(await listProvisionExcerpts(provision.id)).toHaveLength(1)
  })

  it('refuses a direct update of a citation', async () => {
    const { error } = await userA.client
      .from('provision_excerpts')
      .update({ excerpt_id: randomUUID() })
      .eq('provision_id', provision.id)

    expect(error?.code).toBe('42501')
  })

  it('unlinks a citation and reports whether one was removed', async () => {
    actAs(userA.client)
    expect(await removeProvisionExcerpt(provision.id, excerpt.id)).toBe(true)
    expect(await removeProvisionExcerpt(provision.id, excerpt.id)).toBe(false)
    expect(await listProvisionExcerpts(provision.id)).toEqual([])
    // The evidence itself is untouched.
    expect(await getEvidenceExcerpt(excerpt.id)).toEqual(excerpt)
  })

  it('removes citations, not evidence, when the provision is deleted', async () => {
    actAs(userA.client)
    await addProvisionExcerpt({
      provision_id: provision.id,
      excerpt_id: excerpt.id,
      deal_id: provision.deal_id,
    })

    expect(await deleteProvision(provision.id)).not.toBeNull()
    expect(await listProvisionExcerpts(provision.id)).toEqual([])
    expect(await getEvidenceExcerpt(excerpt.id)).toEqual(excerpt)
  })
})

describe('provisions: invalid references and values', () => {
  let deal: Deal

  beforeAll(async () => {
    actAs(userA.client)
    deal = await createTestDeal('invalid values deal', dealA1.account_id)
    await createAsA(liabilityCap(deal))
  })

  it('rejects a second provision of the same type on a deal as invalid_input', async () => {
    actAs(userA.client)
    await expectDatabaseError(
      createProvision(liabilityCap(deal, { value_text: 'duplicate' })),
      'invalid_input',
    )
  })

  it('refuses a provision on a deal that does not exist as not_permitted', async () => {
    // The insert policy admits only the caller's own deals and is checked
    // before the foreign key, as for evidence.
    actAs(userA.client)
    await expectDatabaseError(
      createProvision(liabilityCap(deal, { deal_id: randomUUID() })),
      'not_permitted',
    )
  })

  it('rejects a source finding that does not exist as invalid_input', async () => {
    actAs(userA.client)
    await expectDatabaseError(
      createProvision({
        ...liabilityCap(deal, { provision_type: 'termination' }),
        source: 'ai_confirmed',
        source_finding_id: randomUUID(),
      }),
      'invalid_input',
    )
  })

  it.each([
    ['an unknown provision type', { provision_type: 'sla' }],
    ['an unknown value unit', { provision_type: 'discount', value_unit: 'usd' }],
    ['an unknown source', { provision_type: 'discount', source: 'ai_proposed' }],
    ['a numeric value without a unit', { provision_type: 'discount', value_unit: null }],
    ['a unit without a numeric value', { provision_type: 'discount', value_numeric: null }],
  ])('rejects a create with %s', async (_label, overrides) => {
    actAs(userA.client)
    await expectDatabaseError(
      createProvision({
        ...liabilityCap(deal),
        ...overrides,
      } as unknown as CreateProvisionInput),
      'invalid_input',
    )
  })

  it('rejects an update that breaks the value/unit pair and leaves the row unchanged', async () => {
    actAs(userA.client)
    const [provision] = await listProvisions(deal.id)

    await expectDatabaseError(
      updateProvision(provision.id, { value_unit: null }),
      'invalid_input',
    )
    await expectDatabaseError(
      updateProvision(provision.id, { value_unit: 'bananas' } as unknown as UpdateProvisionInput),
      'invalid_input',
    )
    expect(await getProvision(provision.id)).toEqual(provision)
  })
})
