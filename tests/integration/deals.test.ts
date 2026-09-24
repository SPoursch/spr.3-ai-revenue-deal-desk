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
 * Integration tests for app/lib/db/deals.ts against the hosted canonical
 * database, run as real users.
 *
 * As in accounts.test.ts, only client construction is replaced (J3):
 * `getSupabaseClient()` returns whichever real client `actAs()` selected —
 * test user A, test user B or anonymous — so every query meets the real
 * grants and row level security. Nothing uses a service-role key.
 *
 * Test data: every account and deal name starts with this run's RUN_PREFIX.
 * Every deal belongs to an account, so `afterAll` deletes this run's accounts
 * for each user and the database cascades to their deals — including renewal
 * chains, whose predecessor could not be deleted on its own. `afterAll` then
 * fails the run if either user can still see a prefixed account or deal.
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
  DealDeskDatabaseError,
  deleteAccount,
  deleteDeal,
  getDeal,
  listDeals,
  updateDeal,
} from '../../app/lib/db'
import type { TablesUpdate } from '../../app/lib/database.types'
import type {
  Account,
  CreateDealInput,
  CreateNonRenewalDealInput,
  Deal,
  UpdateDealInput,
} from '../../app/lib/deal-desk/domain'

const RUN_PREFIX = `[deal-desk-test ${randomUUID().slice(0, 8)}]`

let userA: SignedInTestUser
let userB: SignedInTestUser
const anonymous = createAnonymousClient()

let accountA: Account
let accountB: Account

function actAs(client: TestClient) {
  current.client = client
}

function testName(label: string) {
  return `${RUN_PREFIX} ${label}`
}

/** A valid new_business deal on user A's account, before overrides. */
function newBusiness(
  label: string,
  overrides: Partial<CreateNonRenewalDealInput> = {},
): CreateNonRenewalDealInput {
  return {
    account_id: accountA.id,
    name: testName(label),
    deal_type: 'new_business',
    stage: 'discovery',
    arr_eur: 60000,
    ...overrides,
  }
}

/** Creates a deal as user A through the module. */
async function createAsA(input: CreateDealInput): Promise<Deal> {
  actAs(userA.client)
  return createDeal(input)
}

/** Asserts that `promise` rejects with a DealDeskDatabaseError of `kind` on deals. */
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
  expect((error as DealDeskDatabaseError).table).toBe('deals')
}

/** Names of this run's deals visible to `client`, read directly. */
async function visibleDealNames(client: TestClient): Promise<string[]> {
  const { data, error } = await client
    .from('deals')
    .select('name')
    .like('name', `${RUN_PREFIX}%`)
  if (error) throw new Error(`Deal lookup failed (${error.code}).`)
  return data.map((row) => row.name)
}

beforeAll(async () => {
  userA = await signInTestUser('A')
  userB = await signInTestUser('B')

  actAs(userA.client)
  accountA = await createAccount({ name: testName('account A') })
  actAs(userB.client)
  accountB = await createAccount({ name: testName('account B') })
})

afterAll(async () => {
  try {
    for (const user of [userA, userB].filter(Boolean)) {
      // Deleting the accounts cascades to every deal on them.
      const { error } = await user.client
        .from('accounts')
        .delete()
        .like('name', `${RUN_PREFIX}%`)
      if (error) throw new Error(`Cleanup delete failed (${error.code}).`)
    }

    for (const user of [userA, userB].filter(Boolean)) {
      for (const table of ['accounts', 'deals'] as const) {
        const { data, error } = await user.client
          .from(table)
          .select('id')
          .like('name', `${RUN_PREFIX}%`)
        if (error) throw new Error(`Cleanup check failed (${error.code}).`)
        if (data.length > 0) {
          throw new Error(
            `Cleanup left ${data.length} test ${table} row(s) for user ${user.label}.`,
          )
        }
      }
    }
  } finally {
    await Promise.all([userA, userB].filter(Boolean).map(signOutTestUser))
  }
})

describe('deals: owner lifecycle (user A)', () => {
  let dealId: string

  it('creates a new_business deal and returns it without user_id', async () => {
    const deal = await createAsA(
      newBusiness('lifecycle', {
        arr_eur: 60000.5,
        tcv_eur: 180000,
        list_price_eur: 75000,
        discount_pct: 20,
        term_months: 36,
        start_date: '2026-01-01',
        end_date: '2028-12-31',
        renewal_date: '2029-01-01',
        notice_period_days: 90,
        auto_renew: true,
      }),
    )
    dealId = deal.id

    expect(deal).toMatchObject({
      account_id: accountA.id,
      predecessor_deal_id: null,
      name: testName('lifecycle'),
      deal_type: 'new_business',
      stage: 'discovery',
      arr_eur: 60000.5,
      tcv_eur: 180000,
      list_price_eur: 75000,
      discount_pct: 20,
      term_months: 36,
      start_date: '2026-01-01',
      end_date: '2028-12-31',
      renewal_date: '2029-01-01',
      notice_period_days: 90,
      auto_renew: true,
    })
    expect(typeof deal.id).toBe('string')
    expect(typeof deal.created_at).toBe('string')
    expect(typeof deal.updated_at).toBe('string')
    expect(deal).not.toHaveProperty('user_id')
  })

  it('leaves optional fields null when they are omitted', async () => {
    const deal = await createAsA(newBusiness('minimal'))

    expect(deal).toMatchObject({
      tcv_eur: null,
      list_price_eur: null,
      discount_pct: null,
      term_months: null,
      start_date: null,
      end_date: null,
      renewal_date: null,
      notice_period_days: null,
      auto_renew: null,
      predecessor_deal_id: null,
    })
  })

  it('gets the deal by id', async () => {
    actAs(userA.client)
    const deal = await getDeal(dealId)

    expect(deal?.id).toBe(dealId)
    expect(deal?.name).toBe(testName('lifecycle'))
    expect(deal).not.toHaveProperty('user_id')
  })

  it('lists the deal', async () => {
    actAs(userA.client)
    const deals = await listDeals()

    expect(deals.map((deal) => deal.id)).toContain(dealId)
    for (const deal of deals) {
      expect(deal).not.toHaveProperty('user_id')
    }
  })

  it('updates only the supplied fields', async () => {
    actAs(userA.client)
    const before = await getDeal(dealId)
    const updated = await updateDeal(dealId, {
      stage: 'negotiation',
      arr_eur: 55000,
      discount_pct: null,
      auto_renew: false,
    })

    expect(updated).toMatchObject({
      id: dealId,
      account_id: accountA.id,
      name: testName('lifecycle'),
      deal_type: 'new_business',
      stage: 'negotiation',
      arr_eur: 55000,
      discount_pct: null,
      auto_renew: false,
      tcv_eur: 180000,
      term_months: 36,
      renewal_date: '2029-01-01',
    })
    expect(updated).not.toHaveProperty('user_id')
    // Maintained by the deals_set_updated_at trigger, not the application.
    expect(Date.parse(updated!.updated_at)).toBeGreaterThanOrEqual(
      Date.parse(before!.updated_at),
    )
  })

  it('returns the deal unchanged for an update with no fields', async () => {
    actAs(userA.client)
    const before = await getDeal(dealId)
    const unchanged = await updateDeal(dealId, {})

    expect(unchanged).toEqual(before)
  })

  it('deletes the deal and returns the removed row', async () => {
    actAs(userA.client)
    const removed = await deleteDeal(dealId)

    expect(removed?.id).toBe(dealId)
    expect(await getDeal(dealId)).toBeNull()
    expect((await listDeals()).map((deal) => deal.id)).not.toContain(dealId)
  })

  it('returns null for a deal that does not exist', async () => {
    actAs(userA.client)
    const missing = randomUUID()

    expect(await getDeal(missing)).toBeNull()
    expect(await updateDeal(missing, { stage: 'closed' })).toBeNull()
    expect(await deleteDeal(missing)).toBeNull()
  })
})

describe("deals: user B cannot reach user A's deal", () => {
  let deal: Deal

  beforeAll(async () => {
    deal = await createAsA(newBusiness('isolation'))
  })

  /** Reads the deal as its owner, to prove B's attempt changed nothing. */
  async function ownerView() {
    actAs(userA.client)
    return getDeal(deal.id)
  }

  it('cannot get it: the row looks nonexistent', async () => {
    actAs(userB.client)
    expect(await getDeal(deal.id)).toBeNull()
  })

  it('does not see it in the list', async () => {
    actAs(userB.client)
    expect((await listDeals()).map((d) => d.id)).not.toContain(deal.id)
  })

  it('cannot update it: nothing matches and nothing changes', async () => {
    actAs(userB.client)
    expect(
      await updateDeal(deal.id, { name: testName('hijacked'), arr_eur: 1 }),
    ).toBeNull()

    expect(await ownerView()).toEqual(deal)
  })

  it('cannot delete it: nothing matches and the row survives', async () => {
    actAs(userB.client)
    expect(await deleteDeal(deal.id)).toBeNull()

    expect((await ownerView())?.id).toBe(deal.id)
  })
})

describe('deals: anonymous access is refused', () => {
  let deal: Deal

  beforeAll(async () => {
    deal = await createAsA(newBusiness('anonymous target'))
  })

  it('cannot list deals', async () => {
    actAs(anonymous)
    await expectDatabaseError(listDeals(), 'not_permitted')
  })

  it('cannot get a deal', async () => {
    actAs(anonymous)
    await expectDatabaseError(getDeal(deal.id), 'not_permitted')
  })

  it('cannot create a deal', async () => {
    actAs(anonymous)
    await expectDatabaseError(
      createDeal(newBusiness('anonymous create')),
      'not_permitted',
    )
  })

  it('cannot update a deal', async () => {
    actAs(anonymous)
    await expectDatabaseError(
      updateDeal(deal.id, { stage: 'closed' }),
      'not_permitted',
    )

    actAs(userA.client)
    expect(await getDeal(deal.id)).toEqual(deal)
  })

  it('cannot delete a deal', async () => {
    actAs(anonymous)
    await expectDatabaseError(deleteDeal(deal.id), 'not_permitted')

    actAs(userA.client)
    expect((await getDeal(deal.id))?.id).toBe(deal.id)
  })
})

describe('deals: ownership comes from the session, never from input', () => {
  /** Reads user_id directly, as the owner. Tests only; the app never reads it. */
  async function ownerIdOf(id: string) {
    const { data, error } = await userA.client
      .from('deals')
      .select('user_id')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(`Owner lookup failed (${error.code}).`)
    return data?.user_id ?? null
  }

  it('stores the authenticated user as owner', async () => {
    const deal = await createAsA(newBusiness('owned by A'))

    expect(await ownerIdOf(deal.id)).toBe(userA.userId)
  })

  it('ignores a user_id smuggled into the create input at runtime', async () => {
    // Impossible in typed code; this simulates an untyped caller.
    const smuggled = {
      ...newBusiness('smuggled owner'),
      user_id: userB.userId,
    } as unknown as CreateDealInput
    const deal = await createAsA(smuggled)

    expect(await ownerIdOf(deal.id)).toBe(userA.userId)
    actAs(userB.client)
    expect(await getDeal(deal.id)).toBeNull()
  })

  it('ignores non-updatable keys smuggled into the update input', async () => {
    const deal = await createAsA(newBusiness('smuggled update'))
    const predecessor = await createAsA(newBusiness('smuggled predecessor'))

    actAs(userA.client)
    const updated = await updateDeal(deal.id, {
      stage: 'contracting',
      user_id: userB.userId,
      account_id: accountB.id,
      predecessor_deal_id: predecessor.id,
    } as unknown as UpdateDealInput)

    expect(updated).toMatchObject({
      stage: 'contracting',
      account_id: accountA.id,
      predecessor_deal_id: null,
    })
    expect(await ownerIdOf(deal.id)).toBe(userA.userId)
  })

  it('is enforced by the database: user_id is not insertable', async () => {
    const { data, error } = await userA.client
      .from('deals')
      .insert({ ...newBusiness('direct insert'), user_id: userB.userId })
      .select('id')

    expect(error?.code).toBe('42501')
    expect(data).toBeNull()
  })

  it.each(['user_id', 'account_id', 'predecessor_deal_id'] as const)(
    'is enforced by the database: %s is not updatable',
    async (column) => {
      const deal = await createAsA(newBusiness(`direct update ${column}`))
      const value =
        column === 'user_id'
          ? userB.userId
          : column === 'account_id'
            ? accountB.id
            : deal.id

      const patch: TablesUpdate<'deals'> = { [column]: value }
      const { error } = await userA.client
        .from('deals')
        .update(patch)
        .eq('id', deal.id)

      expect(error?.code).toBe('42501')
      actAs(userA.client)
      expect(await getDeal(deal.id)).toEqual(deal)
      expect(await ownerIdOf(deal.id)).toBe(userA.userId)
    },
  )
})

describe('deals: renewal lineage', () => {
  let predecessor: Deal

  beforeAll(async () => {
    predecessor = await createAsA(newBusiness('predecessor', { stage: 'closed' }))
  })

  it('rejects a renewal without a predecessor as invalid_input', async () => {
    // The domain type already forbids this; an untyped caller reaches the
    // deals_renewal_requires_predecessor_check constraint instead.
    const input = {
      ...newBusiness('renewal without predecessor'),
      deal_type: 'renewal',
    } as unknown as CreateDealInput

    actAs(userA.client)
    await expectDatabaseError(createDeal(input), 'invalid_input')
    expect(await visibleDealNames(userA.client)).not.toContain(
      testName('renewal without predecessor'),
    )
  })

  it("creates a renewal linked to the owner's own predecessor", async () => {
    const renewal = await createAsA({
      account_id: accountA.id,
      predecessor_deal_id: predecessor.id,
      name: testName('renewal'),
      deal_type: 'renewal',
      stage: 'discovery',
      arr_eur: 66000,
    })

    expect(renewal).toMatchObject({
      deal_type: 'renewal',
      predecessor_deal_id: predecessor.id,
      account_id: accountA.id,
    })
  })

  it('refuses to delete a predecessor that a renewal still points at', async () => {
    // deals_predecessor_fkey is ON DELETE SET NULL (predecessor_deal_id), which
    // would leave the renewal without a predecessor and so violates
    // deals_renewal_requires_predecessor_check.
    actAs(userA.client)
    await expectDatabaseError(deleteDeal(predecessor.id), 'invalid_input')
    expect((await getDeal(predecessor.id))?.id).toBe(predecessor.id)
  })

  it("rejects user A's deal as user B's predecessor", async () => {
    actAs(userB.client)
    await expectDatabaseError(
      createDeal({
        account_id: accountB.id,
        predecessor_deal_id: predecessor.id,
        name: testName('cross-user renewal'),
        deal_type: 'renewal',
        stage: 'discovery',
        arr_eur: 1,
      }),
      'invalid_input',
    )
    expect(await visibleDealNames(userB.client)).toEqual([])
  })

  it('rejects a predecessor that does not exist', async () => {
    actAs(userA.client)
    await expectDatabaseError(
      createDeal({
        account_id: accountA.id,
        predecessor_deal_id: randomUUID(),
        name: testName('orphan renewal'),
        deal_type: 'renewal',
        stage: 'discovery',
        arr_eur: 1,
      }),
      'invalid_input',
    )
  })
})

describe('deals: account integrity', () => {
  it("rejects a deal on user B's account", async () => {
    actAs(userA.client)
    await expectDatabaseError(
      createDeal(newBusiness('on B account', { account_id: accountB.id })),
      'invalid_input',
    )

    expect(await visibleDealNames(userA.client)).not.toContain(
      testName('on B account'),
    )
    expect(await visibleDealNames(userB.client)).toEqual([])
  })

  it('rejects a deal on an account that does not exist', async () => {
    actAs(userA.client)
    await expectDatabaseError(
      createDeal(newBusiness('on missing account', { account_id: randomUUID() })),
      'invalid_input',
    )
  })

  it('removes the deals of an account when the account is deleted', async () => {
    actAs(userA.client)
    const account = await createAccount({ name: testName('cascade account') })
    const deal = await createAsA(
      newBusiness('cascade deal', { account_id: account.id }),
    )

    actAs(userA.client)
    expect((await deleteAccount(account.id))?.id).toBe(account.id)
    expect(await getDeal(deal.id)).toBeNull()
  })
})

describe('deals: check constraints are reported as invalid_input', () => {
  it.each([
    ['an unknown stage', { stage: 'closed_won' }],
    ['an unknown deal type', { deal_type: 'upsell' }],
    ['a negative ARR', { arr_eur: -1 }],
    ['a discount above 100 %', { discount_pct: 150 }],
    ['a zero-month term', { term_months: 0 }],
    ['a negative notice period', { notice_period_days: -1 }],
    ['an end date before the start date', { start_date: '2026-06-01', end_date: '2026-01-01' }],
    ['a blank name', { name: '   ' }],
  ])('rejects %s', async (_label, overrides) => {
    const input = {
      ...newBusiness('check constraint'),
      ...overrides,
    } as unknown as CreateDealInput

    actAs(userA.client)
    await expectDatabaseError(createDeal(input), 'invalid_input')
  })

  it('rejects an invalid value on update and leaves the row unchanged', async () => {
    const deal = await createAsA(newBusiness('update check'))

    actAs(userA.client)
    await expectDatabaseError(
      updateDeal(deal.id, { discount_pct: 101 }),
      'invalid_input',
    )
    await expectDatabaseError(
      updateDeal(deal.id, { deal_type: 'renewal' }),
      'invalid_input',
    )
    expect(await getDeal(deal.id)).toEqual(deal)
  })
})
