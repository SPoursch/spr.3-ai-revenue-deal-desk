import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  signInTestUser,
  signOutTestUser,
  type SignedInTestUser,
  type TestClient,
} from '../support/supabase-clients'

/**
 * Integration tests for the Contract / Document Intelligence V1 additions to
 * the data layer, against the hosted canonical database, run as real users:
 *
 * - `addProvisionExcerpts` (provisions.ts): an item's citations in one
 *   multi-row insert, so a batch is stored whole or not at all.
 * - `listProvisionCitations` (provisions.ts): a provision's cited excerpts
 *   with their evidence item's title, for the provision page.
 * - `listDealExcerptsByItem` (evidence.ts): every excerpt of a deal grouped
 *   under its evidence item, for the excerpt picker.
 *
 * As in provisions.test.ts, only client construction is replaced (J3):
 * `getSupabaseClient()` returns whichever real client `actAs()` selected, so
 * every query meets the real grants and row level security. Nothing uses a
 * service-role key. Neither read returns an item's `body_text`.
 *
 * Test data carries this run's RUN_PREFIX; `afterAll` deletes this run's
 * accounts for each user, which cascades to deals, evidence, provisions and
 * citations, then fails the run if any of it is still visible.
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
  addProvisionExcerpts,
  createAccount,
  createDeal,
  createEvidenceExcerpts,
  createEvidenceItem,
  createProvision,
  DealDeskDatabaseError,
  listDealExcerptsByItem,
  listProvisionCitations,
  listProvisionExcerpts,
} from '../../app/lib/db'
import { splitIntoParagraphs } from '../../app/lib/deal-desk/excerpts'
import type {
  Deal,
  EvidenceExcerpt,
  EvidenceItem,
  Provision,
  ProvisionType,
} from '../../app/lib/deal-desk/domain'

const RUN_PREFIX = `[deal-desk-test ${randomUUID().slice(0, 8)}]`

let userA: SignedInTestUser
let userB: SignedInTestUser

let dealA1: Deal
let dealA2: Deal
let dealB: Deal

/** Deal A1's two evidence items and their excerpts, in the order added. */
let msa: { item: EvidenceItem; excerpts: EvidenceExcerpt[] }
let orderForm: { item: EvidenceItem; excerpts: EvidenceExcerpt[] }
/** An excerpt of deal A2, which no provision of deal A1 may cite. */
let otherDealExcerpt: EvidenceExcerpt

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

/** Pasted evidence on `deal` with one excerpt per paragraph, as the app stores it. */
async function addEvidence(deal: Deal, label: string, body: string) {
  const item = await createEvidenceItem({
    deal_id: deal.id,
    evidence_type: 'msa',
    title: testName(label),
    body_text: body,
  })
  const excerpts = await createEvidenceExcerpts(
    splitIntoParagraphs(body).map((excerpt) => ({
      ...excerpt,
      evidence_item_id: item.id,
      deal_id: deal.id,
    })),
  )
  return { item, excerpts }
}

async function createProvisionAsA(deal: Deal, provisionType: ProvisionType): Promise<Provision> {
  actAs(userA.client)
  return createProvision({
    deal_id: deal.id,
    provision_type: provisionType,
    value_text: 'test value',
    source: 'human_entered',
  })
}

function citation(provision: Provision, excerpt: EvidenceExcerpt) {
  return { provision_id: provision.id, excerpt_id: excerpt.id, deal_id: provision.deal_id }
}

async function citedIds(provision: Provision) {
  actAs(userA.client)
  return (await listProvisionExcerpts(provision.id)).map((link) => link.excerpt_id).sort()
}

/** Asserts that `promise` rejects with a DealDeskDatabaseError of `kind` on provision_excerpts. */
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
  expect((error as DealDeskDatabaseError).table).toBe('provision_excerpts')
}

beforeAll(async () => {
  userA = await signInTestUser('A')
  userB = await signInTestUser('B')

  actAs(userA.client)
  const accountA = await createAccount({ name: testName('account A') })
  dealA1 = await createTestDeal('deal A1', accountA.id)
  dealA2 = await createTestDeal('deal A2', accountA.id)
  msa = await addEvidence(
    dealA1,
    'Master agreement',
    'Liability is capped at twelve months of fees.\n\nData stays in the EU.',
  )
  orderForm = await addEvidence(
    dealA1,
    'Order form',
    'Payment is due within 45 days.\n\nThe term is 12 months.\n\nIt renews automatically.',
  )
  otherDealExcerpt = (await addEvidence(dealA2, 'Other deal note', 'Unrelated paragraph.'))
    .excerpts[0]

  actAs(userB.client)
  const accountB = await createAccount({ name: testName('account B') })
  dealB = await createTestDeal('deal B', accountB.id)
})

afterAll(async () => {
  try {
    for (const user of [userA, userB].filter(Boolean)) {
      const { error } = await user.client
        .from('accounts')
        .delete()
        .like('name', `${RUN_PREFIX}%`)
      if (error) throw new Error(`Cleanup delete failed (${error.code}).`)
    }

    for (const user of [userA, userB].filter(Boolean)) {
      const checks = [
        user.client.from('deals').select('id').in('id', [...createdDealIds]),
        user.client.from('provisions').select('id').in('deal_id', [...createdDealIds]),
        user.client
          .from('provision_excerpts')
          .select('provision_id')
          .in('deal_id', [...createdDealIds]),
        user.client.from('evidence_items').select('id').in('deal_id', [...createdDealIds]),
      ]
      for (const { data, error } of await Promise.all(checks)) {
        if (error) throw new Error(`Cleanup check failed (${error.code}).`)
        if (data.length > 0) {
          throw new Error(`Cleanup left ${data.length} test row(s) for user ${user.label}.`)
        }
      }
    }
  } finally {
    await Promise.all([userA, userB].filter(Boolean).map(signOutTestUser))
  }
})

describe('addProvisionExcerpts: one insert for all citations', () => {
  it('stores every citation of the batch and returns the stored links', async () => {
    const provision = await createProvisionAsA(dealA1, 'liability_cap')
    const excerpts = [msa.excerpts[0], orderForm.excerpts[1]]

    actAs(userA.client)
    const stored = await addProvisionExcerpts(excerpts.map((excerpt) => citation(provision, excerpt)))

    expect(stored.map((link) => link.excerpt_id).sort()).toEqual(
      excerpts.map((excerpt) => excerpt.id).sort(),
    )
    for (const link of stored) {
      expect(link).toMatchObject({ provision_id: provision.id, deal_id: dealA1.id })
    }
    expect(await citedIds(provision)).toEqual(excerpts.map((excerpt) => excerpt.id).sort())
  })

  it('returns an empty list for an empty batch, storing nothing', async () => {
    const provision = await createProvisionAsA(dealA1, 'data_residency')

    actAs(userA.client)
    expect(await addProvisionExcerpts([])).toEqual([])
    expect(await citedIds(provision)).toEqual([])
  })

  it("stores nothing when one excerpt of the batch is another deal's", async () => {
    const provision = await createProvisionAsA(dealA1, 'payment_terms')

    actAs(userA.client)
    await expectDatabaseError(
      addProvisionExcerpts([
        citation(provision, msa.excerpts[1]),
        citation(provision, otherDealExcerpt),
      ]),
      'invalid_input',
    )
    expect(await citedIds(provision)).toEqual([])
  })

  it('stores nothing when the batch repeats an existing citation', async () => {
    const provision = await createProvisionAsA(dealA1, 'termination')

    actAs(userA.client)
    await addProvisionExcerpts([citation(provision, orderForm.excerpts[0])])
    await expectDatabaseError(
      addProvisionExcerpts([
        citation(provision, orderForm.excerpts[1]),
        citation(provision, orderForm.excerpts[0]),
      ]),
      'invalid_input',
    )
    expect(await citedIds(provision)).toEqual([orderForm.excerpts[0].id])
  })

  it("refuses user B's batch on user A's provision, storing nothing", async () => {
    const provision = await createProvisionAsA(dealA1, 'discount')

    actAs(userB.client)
    const error = await addProvisionExcerpts([citation(provision, msa.excerpts[0])]).then(
      () => null,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(DealDeskDatabaseError)
    expect(await citedIds(provision)).toEqual([])
  })
})

describe('listProvisionCitations: cited excerpts with their evidence title', () => {
  it("returns each cited excerpt's content and ordinal with its item's id and title, oldest link first", async () => {
    const provision = await createProvisionAsA(dealA1, 'auto_renewal')

    actAs(userA.client)
    await addProvisionExcerpts([citation(provision, orderForm.excerpts[2])])
    await addProvisionExcerpts([citation(provision, msa.excerpts[0])])

    const citations = await listProvisionCitations(provision.id)

    expect(citations).toHaveLength(2)
    expect(citations[0]).toMatchObject({
      excerpt_id: orderForm.excerpts[2].id,
      excerpt: {
        id: orderForm.excerpts[2].id,
        ordinal: 2,
        content: 'It renews automatically.',
        evidence_item_id: orderForm.item.id,
        evidence_item: { id: orderForm.item.id, title: orderForm.item.title },
      },
    })
    expect(citations[1]).toMatchObject({
      excerpt_id: msa.excerpts[0].id,
      excerpt: { evidence_item: { id: msa.item.id, title: msa.item.title } },
    })
    // The item's full text is never part of the result.
    expect(JSON.stringify(citations)).not.toContain('body_text')
  })

  it('returns an empty list for an unsupported provision', async () => {
    const provision = await createProvisionAsA(dealA1, 'governing_law')

    actAs(userA.client)
    expect(await listProvisionCitations(provision.id)).toEqual([])
  })

  it("returns nothing to user B for user A's provision", async () => {
    actAs(userA.client)
    const [provision] = await listProvisionsWithCitations()

    actAs(userB.client)
    expect(await listProvisionCitations(provision.id)).toEqual([])
  })
})

describe('listDealExcerptsByItem: the excerpt picker', () => {
  it("groups a deal's excerpts under their items, items oldest first, excerpts by ordinal", async () => {
    actAs(userA.client)
    const items = await listDealExcerptsByItem(dealA1.id)

    expect(items.map((item) => item.id)).toEqual([msa.item.id, orderForm.item.id])
    expect(items[0]).toMatchObject({ title: msa.item.title, evidence_type: 'msa' })
    expect(items[1].excerpts.map((excerpt) => [excerpt.ordinal, excerpt.content])).toEqual([
      [0, 'Payment is due within 45 days.'],
      [1, 'The term is 12 months.'],
      [2, 'It renews automatically.'],
    ])
    expect(items[1].excerpts.map((excerpt) => excerpt.id)).toEqual(
      orderForm.excerpts.map((excerpt) => excerpt.id),
    )
    expect(JSON.stringify(items)).not.toContain('body_text')
  })

  it('lists only that deal, and an item without excerpts with an empty list', async () => {
    actAs(userA.client)
    const bare = await createEvidenceItem({
      deal_id: dealA2.id,
      evidence_type: 'email',
      title: testName('no excerpts'),
      body_text: 'An item whose excerpts were never stored.',
    })

    const items = await listDealExcerptsByItem(dealA2.id)

    expect(items.map((item) => item.id)).toContain(bare.id)
    expect(items.find((item) => item.id === bare.id)?.excerpts).toEqual([])
    expect(items.flatMap((item) => item.excerpts).map((excerpt) => excerpt.id)).not.toContain(
      msa.excerpts[0].id,
    )
  })

  it("returns nothing to user B for user A's deal", async () => {
    actAs(userB.client)
    expect(await listDealExcerptsByItem(dealA1.id)).toEqual([])
    expect(await listDealExcerptsByItem(dealB.id)).toEqual([])
  })
})

/** The provisions of deal A1 that cite something, for the isolation check. */
async function listProvisionsWithCitations(): Promise<Provision[]> {
  const { data, error } = await userA.client
    .from('provisions')
    .select('id, deal_id, provision_excerpts!inner(excerpt_id)')
    .eq('deal_id', dealA1.id)
  if (error) throw new Error(`Fixture read failed (${error.code}).`)
  expect(data.length).toBeGreaterThan(0)
  return data as unknown as Provision[]
}
