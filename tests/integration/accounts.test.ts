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
 * Integration tests for app/lib/db/accounts.ts against the hosted canonical
 * database, run as real users.
 *
 * Only client construction is replaced (J3): `getSupabaseClient()` normally
 * builds a cookie-bound client from the Next.js request, which a test process
 * does not have. Here it returns whichever real client the test selects with
 * `actAs()` — test user A, test user B, or anonymous. Every query the module
 * sends still goes to the real database as that role and is subject to the
 * real grants and row level security. Nothing uses a service-role key.
 *
 * Test data: every account name starts with this run's RUN_PREFIX. Every id
 * created is recorded and deleted in `afterAll` by its owner, and `afterAll`
 * then fails the run if any row with the prefix is still visible to either
 * test user.
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
  DealDeskDatabaseError,
  deleteAccount,
  getAccount,
  listAccounts,
  updateAccount,
} from '../../app/lib/db'
import type { CreateAccountInput } from '../../app/lib/deal-desk/domain'

const RUN_PREFIX = `[deal-desk-test ${randomUUID().slice(0, 8)}]`

let userA: SignedInTestUser
let userB: SignedInTestUser
const anonymous = createAnonymousClient()

/** Ids of every account created by this run, deleted in afterAll. */
const createdIds = new Set<string>()

function actAs(client: TestClient) {
  current.client = client
}

function testName(label: string) {
  return `${RUN_PREFIX} ${label}`
}

/** Creates an account as user A through the module and records it for cleanup. */
async function createOwnedByA(label: string, extra: Partial<CreateAccountInput> = {}) {
  actAs(userA.client)
  const account = await createAccount({ name: testName(label), ...extra })
  createdIds.add(account.id)
  return account
}

/** Asserts that `promise` rejects with a DealDeskDatabaseError of `kind`. */
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
  expect((error as DealDeskDatabaseError).table).toBe('accounts')
}

beforeAll(async () => {
  userA = await signInTestUser('A')
  userB = await signInTestUser('B')
})

afterAll(async () => {
  try {
    if (userA && createdIds.size > 0) {
      const { error } = await userA.client
        .from('accounts')
        .delete()
        .in('id', [...createdIds])
      if (error) throw new Error(`Cleanup delete failed (${error.code}).`)
    }

    // Nothing from this run may remain, for either user.
    for (const user of [userA, userB].filter(Boolean)) {
      const { data, error } = await user.client
        .from('accounts')
        .select('id')
        .like('name', `${RUN_PREFIX}%`)
      if (error) throw new Error(`Cleanup check failed (${error.code}).`)
      if (data.length > 0) {
        throw new Error(
          `Cleanup left ${data.length} test account(s) for user ${user.label}.`,
        )
      }
    }
  } finally {
    await Promise.all([userA, userB].filter(Boolean).map(signOutTestUser))
  }
})

describe('accounts: owner lifecycle (user A)', () => {
  let accountId: string

  it('creates an account and returns it without user_id', async () => {
    const account = await createOwnedByA('lifecycle', {
      region: 'EMEA',
      country_code: 'DE',
      segment: 'Enterprise',
      industry: 'Software',
    })
    accountId = account.id

    expect(account).toMatchObject({
      name: testName('lifecycle'),
      region: 'EMEA',
      country_code: 'DE',
      segment: 'Enterprise',
      industry: 'Software',
    })
    expect(typeof account.id).toBe('string')
    expect(typeof account.created_at).toBe('string')
    expect(typeof account.updated_at).toBe('string')
    expect(account).not.toHaveProperty('user_id')
  })

  it('gets the account by id', async () => {
    actAs(userA.client)
    const account = await getAccount(accountId)

    expect(account?.id).toBe(accountId)
    expect(account?.name).toBe(testName('lifecycle'))
    expect(account).not.toHaveProperty('user_id')
  })

  it('lists the account', async () => {
    actAs(userA.client)
    const accounts = await listAccounts()

    expect(accounts.map((account) => account.id)).toContain(accountId)
    for (const account of accounts) {
      expect(account).not.toHaveProperty('user_id')
    }
  })

  it('updates only the supplied fields', async () => {
    actAs(userA.client)
    const before = await getAccount(accountId)
    const updated = await updateAccount(accountId, {
      name: testName('lifecycle renamed'),
      region: null,
    })

    expect(updated).toMatchObject({
      id: accountId,
      name: testName('lifecycle renamed'),
      region: null,
      country_code: 'DE',
      segment: 'Enterprise',
      industry: 'Software',
    })
    expect(updated).not.toHaveProperty('user_id')
    // Maintained by the accounts_set_updated_at trigger, not the application.
    expect(Date.parse(updated!.updated_at)).toBeGreaterThanOrEqual(
      Date.parse(before!.updated_at),
    )
  })

  it('returns the account unchanged for an update with no fields', async () => {
    actAs(userA.client)
    const unchanged = await updateAccount(accountId, {})

    expect(unchanged?.name).toBe(testName('lifecycle renamed'))
  })

  it('deletes the account and returns the removed row', async () => {
    actAs(userA.client)
    const removed = await deleteAccount(accountId)

    expect(removed?.id).toBe(accountId)
    expect(await getAccount(accountId)).toBeNull()
    expect((await listAccounts()).map((account) => account.id)).not.toContain(
      accountId,
    )
  })

  it('returns null for an account that does not exist', async () => {
    actAs(userA.client)
    const missing = randomUUID()

    expect(await getAccount(missing)).toBeNull()
    expect(await updateAccount(missing, { name: testName('ghost') })).toBeNull()
    expect(await deleteAccount(missing)).toBeNull()
  })

  it('reports a constraint violation as invalid_input', async () => {
    actAs(userA.client)

    await expectDatabaseError(
      createAccount({ name: testName('bad country'), country_code: 'germany' }),
      'invalid_input',
    )
  })
})

describe("accounts: user B cannot reach user A's account", () => {
  let accountId: string
  const originalName = testName('isolation')

  beforeAll(async () => {
    accountId = (await createOwnedByA('isolation')).id
  })

  /** Reads the account as its owner, to prove B's attempt changed nothing. */
  async function ownerView() {
    actAs(userA.client)
    return getAccount(accountId)
  }

  it("cannot get it: the row looks nonexistent", async () => {
    actAs(userB.client)
    expect(await getAccount(accountId)).toBeNull()
  })

  it('does not see it in the list', async () => {
    actAs(userB.client)
    const ids = (await listAccounts()).map((account) => account.id)

    expect(ids).not.toContain(accountId)
  })

  it('cannot update it: nothing matches and nothing changes', async () => {
    actAs(userB.client)
    expect(
      await updateAccount(accountId, { name: testName('hijacked') }),
    ).toBeNull()

    expect((await ownerView())?.name).toBe(originalName)
  })

  it('cannot delete it: nothing matches and the row survives', async () => {
    actAs(userB.client)
    expect(await deleteAccount(accountId)).toBeNull()

    expect((await ownerView())?.id).toBe(accountId)
  })
})

describe('accounts: anonymous access is refused', () => {
  let accountId: string

  beforeAll(async () => {
    accountId = (await createOwnedByA('anonymous target')).id
  })

  it('cannot list accounts', async () => {
    actAs(anonymous)
    await expectDatabaseError(listAccounts(), 'not_permitted')
  })

  it('cannot get an account', async () => {
    actAs(anonymous)
    await expectDatabaseError(getAccount(accountId), 'not_permitted')
  })

  it('cannot create an account', async () => {
    actAs(anonymous)
    await expectDatabaseError(
      createAccount({ name: testName('anonymous create') }),
      'not_permitted',
    )
  })

  it('cannot update an account', async () => {
    actAs(anonymous)
    await expectDatabaseError(
      updateAccount(accountId, { name: testName('anonymous update') }),
      'not_permitted',
    )

    actAs(userA.client)
    expect((await getAccount(accountId))?.name).toBe(testName('anonymous target'))
  })

  it('cannot delete an account', async () => {
    actAs(anonymous)
    await expectDatabaseError(deleteAccount(accountId), 'not_permitted')

    actAs(userA.client)
    expect((await getAccount(accountId))?.id).toBe(accountId)
  })
})

describe('accounts: ownership comes from the session, never from input', () => {
  /** Reads user_id directly, as the owner. Tests only; the app never reads it. */
  async function ownerIdOf(client: TestClient, id: string) {
    const { data, error } = await client
      .from('accounts')
      .select('user_id')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(`Owner lookup failed (${error.code}).`)
    return data?.user_id ?? null
  }

  it('stores the authenticated user as owner', async () => {
    const account = await createOwnedByA('owned by A')

    expect(await ownerIdOf(userA.client, account.id)).toBe(userA.userId)
  })

  it('ignores a user_id smuggled into the input at runtime', async () => {
    // Impossible in typed code; this simulates an untyped caller, such as a
    // form spread, trying to assign the row to user B.
    const smuggled = {
      name: testName('smuggled owner'),
      user_id: userB.userId,
    } as unknown as CreateAccountInput
    const account = await createOwnedByA('smuggled owner', smuggled)

    expect(await ownerIdOf(userA.client, account.id)).toBe(userA.userId)

    actAs(userB.client)
    expect(await getAccount(account.id)).toBeNull()
  })

  it('is enforced by the database: user_id is not insertable', async () => {
    const { data, error } = await userA.client
      .from('accounts')
      .insert({ name: testName('direct insert'), user_id: userB.userId })
      .select('id')

    if (data) for (const row of data) createdIds.add(row.id)
    expect(error?.code).toBe('42501')
    expect(data).toBeNull()
  })

  it('is enforced by the database: user_id is not updatable', async () => {
    const account = await createOwnedByA('direct update')

    const { error } = await userA.client
      .from('accounts')
      .update({ user_id: userB.userId })
      .eq('id', account.id)

    expect(error?.code).toBe('42501')
    expect(await ownerIdOf(userA.client, account.id)).toBe(userA.userId)
  })
})
