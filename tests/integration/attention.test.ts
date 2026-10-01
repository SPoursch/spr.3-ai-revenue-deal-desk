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
 * Integration tests for the Feature 7 (Attention / Renewal Intelligence)
 * data layer against the hosted canonical database, run as real users.
 * Contract: docs/sprint-3-domain-index.md §10.
 *
 * - listLiveExceptions (app/lib/db/exceptions.ts): the caller's exceptions
 *   with status 'open' or 'under_review' across all their deals, with only
 *   deal_id, severity and status. Never another user's; a failed read, or a
 *   response cut short by the hosted row cap, throws.
 *
 * As in the other data-access tests, only client construction is replaced
 * (J3), so every query meets the real grants and row level security. The test
 * users may own other data, so assertions are scoped to this run's deals.
 * Test data carries RUN_PREFIX and is deleted with its accounts in `afterAll`.
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
  listLiveExceptions,
  updateExceptionStatus,
} from '../../app/lib/db'
import type { Deal, DealException, ExceptionSeverity } from '../../app/lib/deal-desk/domain'

const RUN_PREFIX = `[deal-desk-test ${randomUUID().slice(0, 8)}]`

let userA: SignedInTestUser
let userB: SignedInTestUser
const anonymous = createAnonymousClient()

let dealA1: Deal
let dealA2: Deal
let dealB: Deal

function actAs(client: TestClient) {
  current.client = client
}

function testName(label: string) {
  return `${RUN_PREFIX} ${label}`
}

async function dealOn(accountId: string, label: string): Promise<Deal> {
  return createDeal({
    account_id: accountId,
    name: testName(label),
    deal_type: 'new_business',
    stage: 'closed',
    arr_eur: 60000,
    renewal_date: '2027-02-15',
    notice_period_days: 30,
  })
}

/** A deterministic exception on `deal`, as the deal's owner (selected with actAs). */
async function exceptionOn(deal: Deal, ruleKey: string, severity: ExceptionSeverity): Promise<DealException> {
  return createException({
    deal_id: deal.id,
    rule_key: ruleKey,
    rule_version: '1',
    kind: 'threshold_breach',
    severity,
    title: `Attention test ${ruleKey}`,
    why: 'Created by the Feature 7 integration tests.',
    origin: 'deterministic',
  })
}

/**
 * Closes an exception directly. Normally a recorded Decision sets 'decided' or
 * 'dismissed' (E5, E6); the database also accepts a plain status update, used
 * here to keep this test independent of the decisions module, as in
 * tests/integration/exceptions.test.ts. The application never sends it.
 */
async function close(client: TestClient, exception: DealException, status: 'decided' | 'dismissed') {
  const { error } = await client.from('exceptions').update({ status }).eq('id', exception.id)
  if (error) throw new Error(`Test setup: closing an exception failed (${error.code}).`)
}

beforeAll(async () => {
  userA = await signInTestUser('A')
  userB = await signInTestUser('B')

  actAs(userA.client)
  const accountA = await createAccount({ name: testName('attention account A') })
  dealA1 = await dealOn(accountA.id, 'attention deal A1')
  dealA2 = await dealOn(accountA.id, 'attention deal A2')

  await exceptionOn(dealA1, 'attention_open', 'high')
  const review = await exceptionOn(dealA1, 'attention_review', 'medium')
  await updateExceptionStatus(review.id, 'under_review')
  await close(userA.client, await exceptionOn(dealA1, 'attention_decided', 'high'), 'decided')
  await close(userA.client, await exceptionOn(dealA1, 'attention_dismissed', 'low'), 'dismissed')
  await exceptionOn(dealA2, 'attention_open', 'low')

  actAs(userB.client)
  const accountB = await createAccount({ name: testName('attention account B') })
  dealB = await dealOn(accountB.id, 'attention deal B')
  await exceptionOn(dealB, 'attention_open', 'high')
})

afterAll(async () => {
  try {
    for (const user of [userA, userB].filter(Boolean)) {
      // Account → deals → exceptions, by cascade.
      const { error } = await user.client.from('accounts').delete().like('name', `${RUN_PREFIX}%`)
      if (error) throw new Error(`Cleanup delete failed (${error.code}).`)
    }
  } finally {
    await Promise.all([userA, userB].filter(Boolean).map(signOutTestUser))
  }
})

/** The rows of `rows` on `deals`, in a stable order for comparison. */
function onDeals<T extends { deal_id: string; status: string }>(rows: T[], deals: Deal[]): T[] {
  const ids = new Set(deals.map((deal) => deal.id))
  return rows
    .filter((row) => ids.has(row.deal_id))
    .sort((a, b) => a.deal_id.localeCompare(b.deal_id) || a.status.localeCompare(b.status))
}

describe('listLiveExceptions', () => {
  it('returns only open and under-review exceptions, with only deal_id, severity and status', async () => {
    actAs(userA.client)
    const rows = await listLiveExceptions()

    expect(onDeals(rows, [dealA1, dealA2])).toEqual(
      onDeals(
        [
          { deal_id: dealA1.id, severity: 'high', status: 'open' },
          { deal_id: dealA1.id, severity: 'medium', status: 'under_review' },
          { deal_id: dealA2.id, severity: 'low', status: 'open' },
        ],
        [dealA1, dealA2],
      ),
    )
    // Across everything the caller owns: no closed status, no other column.
    for (const row of rows) {
      expect(['open', 'under_review']).toContain(row.status)
      expect(Object.keys(row).sort()).toEqual(['deal_id', 'severity', 'status'])
    }
  })

  it("never returns another user's exceptions", async () => {
    actAs(userB.client)
    const rowsOfB = await listLiveExceptions()
    expect(onDeals(rowsOfB, [dealA1, dealA2])).toEqual([])
    expect(onDeals(rowsOfB, [dealB])).toEqual([{ deal_id: dealB.id, severity: 'high', status: 'open' }])

    actAs(userA.client)
    expect(onDeals(await listLiveExceptions(), [dealB])).toEqual([])
  })

  it('fails loudly when the response is cut short, never returning an incomplete list', async () => {
    // The hosted API's row cap cannot be reached with test data, so a client
    // whose response holds fewer rows than its exact count stands in for it.
    const truncating = (rows: unknown[], count: number | null) =>
      ({
        from: () => ({
          select: () => ({ in: async () => ({ data: rows, error: null, count }) }),
        }),
      }) as unknown as TestClient
    const row = { deal_id: dealA1.id, severity: 'high', status: 'open' }

    actAs(truncating([row], 2))
    await expect(listLiveExceptions()).rejects.toThrow(/incomplete: 1 of 2 rows/)

    // A total it cannot verify fails too.
    actAs(truncating([row], null))
    await expect(listLiveExceptions()).rejects.toThrow(/incomplete/)

    // A complete response is returned as read.
    actAs(truncating([row], 1))
    await expect(listLiveExceptions()).resolves.toEqual([row])
  })

  it('throws on a failed read rather than returning an empty list', async () => {
    // The anonymous role has no privilege on exceptions: a real refused read.
    actAs(anonymous)
    const error = await listLiveExceptions().then(
      () => null,
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(DealDeskDatabaseError)
    expect((error as DealDeskDatabaseError).kind).toBe('not_permitted')
    expect((error as DealDeskDatabaseError).table).toBe('exceptions')
  })
})
