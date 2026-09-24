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
 * Integration tests for app/lib/db/evidence.ts against the hosted canonical
 * database, run as real users.
 *
 * As in accounts.test.ts and deals.test.ts, only client construction is
 * replaced (J3): `getSupabaseClient()` returns whichever real client `actAs()`
 * selected, so every query meets the real grants and row level security.
 * Nothing uses a service-role key.
 *
 * Canonical semantics under test (M3, E3): evidence items and excerpts are
 * immutable and not independently deletable — INSERT and SELECT are the only
 * grants — and they disappear only with their deal.
 *
 * Test data: account, deal and evidence titles start with this run's
 * RUN_PREFIX. Evidence cannot be deleted directly, so `afterAll` deletes this
 * run's accounts for each user and the database cascades to their deals and
 * from there to evidence and excerpts. `afterAll` then fails the run if
 * either user can still see a prefixed account, deal or evidence item, or any
 * excerpt on this run's deals.
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
import {
  createAccount,
  createDeal,
  createEvidenceExcerpt,
  createEvidenceItem,
  DealDeskDatabaseError,
  deleteDeal,
  getEvidenceExcerpt,
  getEvidenceItem,
  listEvidenceExcerpts,
  listEvidenceItems,
} from '../../app/lib/db'
import type {
  CreateEvidenceExcerptInput,
  CreateEvidenceItemInput,
  Deal,
  EvidenceExcerpt,
  EvidenceItem,
} from '../../app/lib/deal-desk/domain'

const RUN_PREFIX = `[deal-desk-test ${randomUUID().slice(0, 8)}]`

const BODY =
  'The Supplier’s total liability is capped at the fees paid in the prior ' +
  '12 months. Customer data is stored in the EU.'

let userA: SignedInTestUser
let userB: SignedInTestUser
const anonymous = createAnonymousClient()

/** Two deals of user A, to test that evidence cannot cross between them. */
let dealA1: Deal
let dealA2: Deal
let dealB: Deal

/** Every deal this run created, for the excerpt leftover check. */
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
    stage: 'discovery',
    arr_eur: 60000,
  })
  createdDealIds.add(deal.id)
  return deal
}

/** A valid pasted evidence item on `deal`, before overrides. */
function pasted(
  label: string,
  deal: Deal,
  overrides: Partial<CreateEvidenceItemInput> = {},
): CreateEvidenceItemInput {
  return {
    deal_id: deal.id,
    evidence_type: 'msa',
    title: testName(label),
    body_text: BODY,
    ...overrides,
  }
}

/** A valid excerpt of `item`: its first 30 characters. */
function excerptOf(
  item: EvidenceItem,
  overrides: Partial<CreateEvidenceExcerptInput> = {},
): CreateEvidenceExcerptInput {
  return {
    evidence_item_id: item.id,
    deal_id: item.deal_id,
    ordinal: 0,
    start_offset: 0,
    end_offset: 30,
    content: item.body_text.slice(0, 30),
    ...overrides,
  }
}

async function createItemAsA(input: CreateEvidenceItemInput) {
  actAs(userA.client)
  return createEvidenceItem(input)
}

async function createExcerptAsA(input: CreateEvidenceExcerptInput) {
  actAs(userA.client)
  return createEvidenceExcerpt(input)
}

/** Asserts that `promise` rejects with a DealDeskDatabaseError of `kind` on `table`. */
async function expectDatabaseError(
  promise: Promise<unknown>,
  kind: DealDeskDatabaseError['kind'],
  table: 'evidence_items' | 'evidence_excerpts',
) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(DealDeskDatabaseError)
  expect((error as DealDeskDatabaseError).kind).toBe(kind)
  expect((error as DealDeskDatabaseError).table).toBe(table)
}

/** Titles of this run's evidence items visible to `client`, read directly. */
async function visibleEvidenceTitles(client: TestClient): Promise<string[]> {
  const { data, error } = await client
    .from('evidence_items')
    .select('title')
    .like('title', `${RUN_PREFIX}%`)
  if (error) throw new Error(`Evidence lookup failed (${error.code}).`)
  return data.map((row) => row.title)
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
      // Account → deals → evidence items → excerpts, all by cascade.
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
        user.client
          .from('evidence_items')
          .select('id')
          .like('title', `${RUN_PREFIX}%`),
        user.client
          .from('evidence_excerpts')
          .select('id')
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

describe('evidence items: owner (user A)', () => {
  let item: EvidenceItem

  it('creates pasted evidence with its provenance', async () => {
    item = await createItemAsA(
      pasted('master agreement', dealA1, {
        author: 'Legal, Acme GmbH',
        version_label: 'v3 signed',
        document_date: '2026-02-15',
        is_executed: true,
      }),
    )

    expect(item).toMatchObject({
      deal_id: dealA1.id,
      evidence_type: 'msa',
      title: testName('master agreement'),
      source_kind: 'pasted',
      body_text: BODY,
      storage_path: null,
      original_filename: null,
      mime_type: null,
      author: 'Legal, Acme GmbH',
      version_label: 'v3 signed',
      document_date: '2026-02-15',
      is_executed: true,
      supersedes_evidence_id: null,
    })
    expect(typeof item.id).toBe('string')
    expect(typeof item.created_at).toBe('string')
    expect(item).not.toHaveProperty('user_id')
  })

  it('defaults is_executed to false and provenance to null', async () => {
    const minimal = await createItemAsA(pasted('call note', dealA1, {
      evidence_type: 'call_note',
    }))

    expect(minimal).toMatchObject({
      evidence_type: 'call_note',
      is_executed: false,
      author: null,
      version_label: null,
      document_date: null,
      supersedes_evidence_id: null,
    })
  })

  it('gets the item by id', async () => {
    actAs(userA.client)
    expect(await getEvidenceItem(item.id)).toEqual(item)
  })

  it("lists the deal's items oldest first, and only that deal's", async () => {
    const other = await createItemAsA(pasted('other deal item', dealA2))

    actAs(userA.client)
    const items = await listEvidenceItems(dealA1.id)
    const ids = items.map((i) => i.id)

    expect(ids[0]).toBe(item.id)
    expect(ids).not.toContain(other.id)
    expect(items.every((i) => i.deal_id === dealA1.id)).toBe(true)
  })

  it('records that a newer version supersedes an older one', async () => {
    const newer = await createItemAsA(
      pasted('master agreement v4', dealA1, {
        supersedes_evidence_id: item.id,
      }),
    )

    expect(newer.supersedes_evidence_id).toBe(item.id)
  })

  it('returns null for an item that does not exist', async () => {
    actAs(userA.client)
    expect(await getEvidenceItem(randomUUID())).toBeNull()
  })

  it('returns an empty list for a deal with no evidence', async () => {
    actAs(userA.client)
    expect(await listEvidenceItems(randomUUID())).toEqual([])
  })
})

describe('evidence excerpts: owner (user A)', () => {
  let item: EvidenceItem
  let first: EvidenceExcerpt

  beforeAll(async () => {
    item = await createItemAsA(pasted('excerpted', dealA1))
  })

  it('creates an excerpt of its own evidence item', async () => {
    first = await createExcerptAsA(
      excerptOf(item, { ordinal: 1, section_label: '§ 9 Liability' }),
    )

    expect(first).toMatchObject({
      evidence_item_id: item.id,
      deal_id: dealA1.id,
      ordinal: 1,
      start_offset: 0,
      end_offset: 30,
      section_label: '§ 9 Liability',
      content: BODY.slice(0, 30),
    })
    expect(typeof first.id).toBe('string')
    expect(first).not.toHaveProperty('content_tsv')
    expect(first).not.toHaveProperty('user_id')
  })

  it('gets the excerpt by id', async () => {
    actAs(userA.client)
    expect(await getEvidenceExcerpt(first.id)).toEqual(first)
  })

  it("lists the item's excerpts in ordinal order", async () => {
    const zeroth = await createExcerptAsA(
      excerptOf(item, { ordinal: 0, start_offset: 30, end_offset: 60, content: BODY.slice(30, 60) }),
    )

    actAs(userA.client)
    const ids = (await listEvidenceExcerpts(item.id)).map((e) => e.id)

    expect(ids).toEqual([zeroth.id, first.id])
  })

  it('returns null for an excerpt that does not exist', async () => {
    actAs(userA.client)
    expect(await getEvidenceExcerpt(randomUUID())).toBeNull()
  })
})

describe("evidence: user B cannot reach user A's evidence", () => {
  let item: EvidenceItem
  let excerpt: EvidenceExcerpt

  beforeAll(async () => {
    item = await createItemAsA(pasted('isolation', dealA1))
    excerpt = await createExcerptAsA(excerptOf(item))
  })

  it('cannot get the item or the excerpt: both look nonexistent', async () => {
    actAs(userB.client)
    expect(await getEvidenceItem(item.id)).toBeNull()
    expect(await getEvidenceExcerpt(excerpt.id)).toBeNull()
  })

  it("sees no items on A's deal and no excerpts on A's item", async () => {
    actAs(userB.client)
    expect(await listEvidenceItems(dealA1.id)).toEqual([])
    expect(await listEvidenceExcerpts(item.id)).toEqual([])
  })

  it("cannot attach evidence to A's deal", async () => {
    actAs(userB.client)
    await expectDatabaseError(
      createEvidenceItem(pasted('B on A deal', dealA1)),
      'not_permitted',
      'evidence_items',
    )
    expect(await visibleEvidenceTitles(userA.client)).not.toContain(
      testName('B on A deal'),
    )
  })

  it("cannot add an excerpt to A's item under A's deal", async () => {
    actAs(userB.client)
    await expectDatabaseError(
      createEvidenceExcerpt(excerptOf(item, { ordinal: 5 })),
      'not_permitted',
      'evidence_excerpts',
    )
  })

  it("cannot add an excerpt to A's item under B's own deal", async () => {
    actAs(userB.client)
    await expectDatabaseError(
      createEvidenceExcerpt(excerptOf(item, { ordinal: 6, deal_id: dealB.id })),
      'invalid_input',
      'evidence_excerpts',
    )

    actAs(userA.client)
    expect((await listEvidenceExcerpts(item.id)).map((e) => e.id)).toEqual([
      excerpt.id,
    ])
  })
})

describe('evidence: anonymous access is refused', () => {
  let item: EvidenceItem
  let excerpt: EvidenceExcerpt

  beforeAll(async () => {
    item = await createItemAsA(pasted('anonymous target', dealA1))
    excerpt = await createExcerptAsA(excerptOf(item))
  })

  it('cannot read items', async () => {
    actAs(anonymous)
    await expectDatabaseError(listEvidenceItems(dealA1.id), 'not_permitted', 'evidence_items')
    await expectDatabaseError(getEvidenceItem(item.id), 'not_permitted', 'evidence_items')
  })

  it('cannot read excerpts', async () => {
    actAs(anonymous)
    await expectDatabaseError(listEvidenceExcerpts(item.id), 'not_permitted', 'evidence_excerpts')
    await expectDatabaseError(getEvidenceExcerpt(excerpt.id), 'not_permitted', 'evidence_excerpts')
  })

  it('cannot create items or excerpts', async () => {
    actAs(anonymous)
    await expectDatabaseError(
      createEvidenceItem(pasted('anonymous create', dealA1)),
      'not_permitted',
      'evidence_items',
    )
    await expectDatabaseError(
      createEvidenceExcerpt(excerptOf(item, { ordinal: 9 })),
      'not_permitted',
      'evidence_excerpts',
    )

    expect(await visibleEvidenceTitles(userA.client)).not.toContain(
      testName('anonymous create'),
    )
  })
})

describe('evidence: nothing outside the input reaches the database', () => {
  it('ignores ownership, identity, timestamps and upload fields smuggled into an item', async () => {
    const smuggledId = randomUUID()
    const input = {
      ...pasted('smuggled item', dealA1),
      user_id: userB.userId,
      id: smuggledId,
      created_at: '2000-01-01T00:00:00Z',
      source_kind: 'uploaded',
      storage_path: 'someone-else/file.txt',
      mime_type: 'text/plain',
    } as unknown as CreateEvidenceItemInput

    const item = await createItemAsA(input)

    expect(item.id).not.toBe(smuggledId)
    expect(item.created_at.startsWith('2000')).toBe(false)
    expect(item).toMatchObject({
      source_kind: 'pasted',
      storage_path: null,
      mime_type: null,
    })
    actAs(userB.client)
    expect(await getEvidenceItem(item.id)).toBeNull()
  })

  it('ignores identity and the generated search column smuggled into an excerpt', async () => {
    const item = await createItemAsA(pasted('smuggled excerpt item', dealA1))
    const smuggledId = randomUUID()

    const excerpt = await createExcerptAsA({
      ...excerptOf(item),
      id: smuggledId,
      content_tsv: "'forged':1",
    } as unknown as CreateEvidenceExcerptInput)

    expect(excerpt.id).not.toBe(smuggledId)
    const { data } = await userA.client
      .from('evidence_excerpts')
      .select('content_tsv')
      .eq('id', excerpt.id)
      .single()
    expect(String(data?.content_tsv)).not.toContain('forged')
  })
})

describe('evidence: immutable and not independently deletable (E3)', () => {
  let item: EvidenceItem
  let excerpt: EvidenceExcerpt

  beforeAll(async () => {
    item = await createItemAsA(pasted('immutable', dealA1))
    excerpt = await createExcerptAsA(excerptOf(item))
  })

  it('offers no update or delete functions', () => {
    for (const name of [
      'updateEvidenceItem',
      'deleteEvidenceItem',
      'updateEvidenceExcerpt',
      'deleteEvidenceExcerpt',
    ]) {
      expect(name in db).toBe(false)
    }
  })

  it('refuses a direct update of an item, even by its owner', async () => {
    const { error } = await userA.client
      .from('evidence_items')
      .update({ title: testName('rewritten') })
      .eq('id', item.id)

    expect(error?.code).toBe('42501')
    actAs(userA.client)
    expect(await getEvidenceItem(item.id)).toEqual(item)
  })

  it('refuses a direct update of an excerpt, even by its owner', async () => {
    const { error } = await userA.client
      .from('evidence_excerpts')
      .update({ content: 'rewritten' })
      .eq('id', excerpt.id)

    expect(error?.code).toBe('42501')
    actAs(userA.client)
    expect(await getEvidenceExcerpt(excerpt.id)).toEqual(excerpt)
  })

  it('refuses a direct delete of an item, even by its owner', async () => {
    const { error } = await userA.client
      .from('evidence_items')
      .delete()
      .eq('id', item.id)

    expect(error?.code).toBe('42501')
    actAs(userA.client)
    expect(await getEvidenceItem(item.id)).toEqual(item)
  })

  it('refuses a direct delete of an excerpt, even by its owner', async () => {
    const { error } = await userA.client
      .from('evidence_excerpts')
      .delete()
      .eq('id', excerpt.id)

    expect(error?.code).toBe('42501')
    actAs(userA.client)
    expect(await getEvidenceExcerpt(excerpt.id)).toEqual(excerpt)
  })

  it('removes items, excerpts and supersession links when the deal is deleted', async () => {
    actAs(userA.client)
    const deal = await createTestDeal('doomed deal', dealA1.account_id)
    const older = await createItemAsA(pasted('doomed v1', deal))
    const newer = await createItemAsA(
      pasted('doomed v2', deal, { supersedes_evidence_id: older.id }),
    )
    const doomedExcerpt = await createExcerptAsA(excerptOf(newer))

    actAs(userA.client)
    expect((await deleteDeal(deal.id))?.id).toBe(deal.id)

    expect(await getEvidenceItem(older.id)).toBeNull()
    expect(await getEvidenceItem(newer.id)).toBeNull()
    expect(await getEvidenceExcerpt(doomedExcerpt.id)).toBeNull()
    expect(await listEvidenceItems(deal.id)).toEqual([])
  })
})

describe('evidence: references cannot cross deals', () => {
  let item: EvidenceItem

  beforeAll(async () => {
    item = await createItemAsA(pasted('deal A1 item', dealA1))
  })

  it("rejects an excerpt whose deal is not its item's deal", async () => {
    // Both deals are user A's: the composite (evidence_item_id, deal_id) key,
    // not row level security, is what refuses this.
    actAs(userA.client)
    await expectDatabaseError(
      createEvidenceExcerpt(excerptOf(item, { deal_id: dealA2.id })),
      'invalid_input',
      'evidence_excerpts',
    )
    expect(await listEvidenceExcerpts(item.id)).toEqual([])
  })

  it('rejects superseding an item of another deal', async () => {
    actAs(userA.client)
    await expectDatabaseError(
      createEvidenceItem(
        pasted('cross-deal supersedes', dealA2, {
          supersedes_evidence_id: item.id,
        }),
      ),
      'invalid_input',
      'evidence_items',
    )
    expect(await visibleEvidenceTitles(userA.client)).not.toContain(
      testName('cross-deal supersedes'),
    )
  })
})

describe('evidence: invalid references and values', () => {
  let item: EvidenceItem

  beforeAll(async () => {
    item = await createItemAsA(pasted('reference target', dealA1))
    await createExcerptAsA(excerptOf(item, { ordinal: 0 }))
  })

  it('refuses an item on a deal that does not exist as not_permitted', async () => {
    // The insert policy only admits the caller's own deals, and it is checked
    // before the foreign key: a missing deal and another user's deal look the
    // same.
    actAs(userA.client)
    await expectDatabaseError(
      createEvidenceItem(pasted('missing deal', dealA1, { deal_id: randomUUID() })),
      'not_permitted',
      'evidence_items',
    )
  })

  it('rejects superseding an item that does not exist as invalid_input', async () => {
    actAs(userA.client)
    await expectDatabaseError(
      createEvidenceItem(
        pasted('missing superseded', dealA1, { supersedes_evidence_id: randomUUID() }),
      ),
      'invalid_input',
      'evidence_items',
    )
  })

  it('rejects an excerpt of an item that does not exist as invalid_input', async () => {
    actAs(userA.client)
    await expectDatabaseError(
      createEvidenceExcerpt(excerptOf(item, { evidence_item_id: randomUUID(), ordinal: 7 })),
      'invalid_input',
      'evidence_excerpts',
    )
  })

  it.each([
    ['an unknown evidence type', { evidence_type: 'contract' }],
    ['a blank title', { title: '   ' }],
    ['an empty body', { body_text: '' }],
  ])('rejects an item with %s', async (_label, overrides) => {
    actAs(userA.client)
    await expectDatabaseError(
      createEvidenceItem({
        ...pasted('bad item', dealA1),
        ...overrides,
      } as unknown as CreateEvidenceItemInput),
      'invalid_input',
      'evidence_items',
    )
  })

  it.each([
    ['a duplicate ordinal', { ordinal: 0 }],
    ['a negative ordinal', { ordinal: -1 }],
    ['a negative start offset', { ordinal: 2, start_offset: -1 }],
    ['an end offset not after the start', { ordinal: 3, start_offset: 10, end_offset: 10 }],
    ['empty content', { ordinal: 4, content: '' }],
  ])('rejects an excerpt with %s', async (_label, overrides) => {
    actAs(userA.client)
    await expectDatabaseError(
      createEvidenceExcerpt(excerptOf(item, overrides)),
      'invalid_input',
      'evidence_excerpts',
    )
  })
})
