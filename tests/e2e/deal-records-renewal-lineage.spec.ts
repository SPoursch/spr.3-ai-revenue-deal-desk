import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import { requireTestEnv } from '../support/env'
import {
  signInTestUser,
  signOutTestUser,
  type SignedInTestUser,
} from '../support/supabase-clients'

/**
 * Deal Records, slice 3: renewal lineage.
 *
 * A renewal is a new deal linked to its predecessor (U13). It is started from
 * the predecessor's own page, at /workspace/deals/[dealId]/renew, so the
 * predecessor comes from the deal the user is looking at, never from a picker
 * or a free field. The renewal is always of type Renewal and sits on the
 * predecessor's account. Afterwards each deal's page links to the other:
 * "Renewal of <predecessor>" on the renewal, "Renewed by <renewal>" on the
 * predecessor, which is otherwise left exactly as it was.
 *
 * The account is set up directly as user A (publishable key, user A's own
 * session, under RLS), as in deal-records-manage.spec.ts; the ordinary deal
 * and its renewal are created through the UI. Around that, the access
 * boundaries: a signed-out visitor is sent to /login, and user B can neither
 * open the renewal workflow for user A's deal nor see either deal. That the
 * database refuses another user's deal as a predecessor is covered by
 * tests/integration/deals.test.ts.
 *
 * Names carry a per-run id. `afterAll` deletes every E2E account as user A,
 * which cascades to the deals on it, renewal chains included, and signs that
 * session out.
 */

const E2E_PREFIX = 'E2E '
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const RUN_PREFIX = `${E2E_PREFIX}${RUN_ID}`
const ACCOUNT_NAME = `${RUN_PREFIX} Lineage Account`
const PREDECESSOR_NAME = `${RUN_PREFIX} Lineage Deal 2026`
const RENEWAL_NAME = `${RUN_PREFIX} Lineage Renewal 2027`

const DEAL_COLUMNS =
  'id, account_id, predecessor_deal_id, name, deal_type, stage, arr_eur, renewal_date, updated_at'

let userA: SignedInTestUser
let accountId = ''

async function signIn(page: Page, label: 'A' | 'B') {
  await page.goto('/login')
  await page.getByLabel('Email').fill(requireTestEnv(`DEAL_DESK_TEST_USER_${label}_EMAIL`))
  await page
    .getByLabel('Password')
    .fill(requireTestEnv(`DEAL_DESK_TEST_USER_${label}_PASSWORD`))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/workspace$/)
}

/** Reads one of user A's deals directly, under RLS. */
async function readDealAsA(dealId: string) {
  const { data, error } = await userA.client
    .from('deals')
    .select(DEAL_COLUMNS)
    .eq('id', dealId)
    .single()
  if (error) throw new Error(`E2E read of deal failed (${error.code}).`)
  return data
}

test.beforeAll(async () => {
  userA = await signInTestUser('A')

  const account = await userA.client
    .from('accounts')
    .insert({ name: ACCOUNT_NAME })
    .select('id')
    .single()
  if (account.error) throw new Error(`E2E setup: account insert failed (${account.error.code}).`)
  accountId = account.data.id
})

test.afterAll(async () => {
  if (!userA) return

  try {
    // Deleting the account cascades to both deals, predecessor and renewal.
    const { error } = await userA.client
      .from('accounts')
      .delete()
      .like('name', `${E2E_PREFIX}%`)
    if (error) throw new Error(`E2E cleanup failed (${error.code}).`)
  } finally {
    await signOutTestUser(userA)
  }
})

test.describe('signed-out visitor', () => {
  test('is sent to /login from /workspace/deals/[id]/renew', async ({ page }) => {
    await page.goto(`/workspace/deals/${randomUUID()}/renew`)
    await expect(page).toHaveURL(/\/login$/)
  })
})

test.describe('ordinary deal creation', () => {
  test('creating an ordinary deal still does not offer the Renewal type', async ({
    page,
  }) => {
    await signIn(page, 'A')

    await page.goto('/workspace/deals/new')
    const dealType = page.getByLabel('Deal type')
    await expect(dealType.locator('option', { hasText: 'New business' })).toHaveCount(1)
    await expect(dealType.locator('option', { hasText: 'Renewal' })).toHaveCount(0)
  })
})

test.describe.serial('renewal lineage', () => {
  let predecessorId = ''
  let renewalId = ''
  let predecessorBefore: Awaited<ReturnType<typeof readDealAsA>> | null = null

  test('user A creates an ordinary deal', async ({ page }) => {
    await signIn(page, 'A')

    await page.goto(`/workspace/deals/new?accountId=${accountId}`)
    await expect(page.getByLabel('Account').locator('option:checked')).toHaveText(
      ACCOUNT_NAME,
    )
    await page.getByLabel('Deal name').fill(PREDECESSOR_NAME)
    await page.getByLabel('Deal type').selectOption({ label: 'New business' })
    await page.getByLabel('Stage').selectOption({ label: 'Negotiation' })
    await page.getByLabel('ARR (EUR)').fill('60000')
    await page.getByLabel('Renewal date').fill('2027-03-31')
    await page.getByRole('button', { name: 'Create deal' }).click()

    await expect(page).toHaveURL(/\/workspace\/deals\/[0-9a-f-]{36}$/)
    predecessorId = new URL(page.url()).pathname.split('/').pop() ?? ''
    await expect(
      page.getByRole('heading', { level: 1, name: PREDECESSOR_NAME }),
    ).toBeVisible()

    // Remember the stored row, to prove later that the renewal left it alone.
    predecessorBefore = await readDealAsA(predecessorId)
    expect(predecessorBefore.deal_type).toBe('new_business')
    expect(predecessorBefore.predecessor_deal_id).toBeNull()
  })

  test('user A creates a renewal from the deal, tied to it as predecessor', async ({
    page,
  }) => {
    expect(predecessorId, 'the previous test must have created a deal').not.toBe('')
    await signIn(page, 'A')

    // The renewal starts from the predecessor's own page.
    await page.goto(`/workspace/deals/${predecessorId}`)
    await page.getByRole('link', { name: 'Create renewal' }).click()
    await expect(page).toHaveURL(new RegExp(`/workspace/deals/${predecessorId}/renew$`))
    await expect(page.getByRole('heading', { level: 1, name: 'New renewal' })).toBeVisible()

    // The form names the predecessor and its account, and does not offer a
    // choice of deal type: a deal created here is always a renewal.
    const main = page.getByRole('main')
    await expect(main).toContainText(`Renewal of ${PREDECESSOR_NAME}`)
    await expect(main).toContainText(ACCOUNT_NAME)
    await expect(page.getByLabel('Deal type')).toHaveCount(0)

    await page.getByLabel('Deal name').fill(RENEWAL_NAME)
    await page.getByLabel('Stage').selectOption({ label: 'Discovery' })
    await page.getByLabel('ARR (EUR)').fill('66000')
    await page.getByLabel('Renewal date').fill('2028-03-31')
    await page.getByRole('button', { name: 'Create renewal' }).click()

    // The new renewal's own page, a different deal from its predecessor.
    await expect(page).toHaveURL(/\/workspace\/deals\/[0-9a-f-]{36}$/)
    renewalId = new URL(page.url()).pathname.split('/').pop() ?? ''
    expect(renewalId).not.toBe(predecessorId)

    await expect(page.getByRole('heading', { level: 1, name: RENEWAL_NAME })).toBeVisible()
    const details = page.getByRole('region', { name: 'Deal details' })
    await expect(details).toContainText(ACCOUNT_NAME)
    await expect(details).toContainText('Renewal')
    await expect(details).toContainText('Discovery')
    await expect(details).toContainText('€66,000.00')

    // Stored as a renewal of the predecessor, on the predecessor's account.
    const stored = await readDealAsA(renewalId)
    expect(stored.deal_type).toBe('renewal')
    expect(stored.predecessor_deal_id).toBe(predecessorId)
    expect(stored.account_id).toBe(accountId)

    // The renewal names its predecessor and links back to it.
    const lineage = page.getByRole('region', { name: 'Renewal lineage' })
    await expect(lineage).toContainText(`Renewal of ${PREDECESSOR_NAME}`)
    await lineage.getByRole('link', { name: PREDECESSOR_NAME }).click()
    await expect(page).toHaveURL(new RegExp(`/workspace/deals/${predecessorId}$`))
    await expect(
      page.getByRole('heading', { level: 1, name: PREDECESSOR_NAME }),
    ).toBeVisible()
  })

  test('the predecessor links forward to its renewal and is otherwise unchanged', async ({
    page,
  }) => {
    expect(renewalId, 'the previous test must have created a renewal').not.toBe('')
    await signIn(page, 'A')

    await page.goto(`/workspace/deals/${predecessorId}`)

    // Its own details are what they were.
    const details = page.getByRole('region', { name: 'Deal details' })
    await expect(details).toContainText(ACCOUNT_NAME)
    await expect(details).toContainText('New business')
    await expect(details).toContainText('Negotiation')
    await expect(details).toContainText('€60,000.00')
    await expect(details).toContainText('31 Mar 2027')

    // And so is the stored row: creating the renewal wrote nothing to it.
    expect(await readDealAsA(predecessorId)).toEqual(predecessorBefore)

    const lineage = page.getByRole('region', { name: 'Renewal lineage' })
    await expect(lineage).toContainText(`Renewed by ${RENEWAL_NAME}`)
    await lineage.getByRole('link', { name: RENEWAL_NAME }).click()
    await expect(page).toHaveURL(new RegExp(`/workspace/deals/${renewalId}$`))
    await expect(page.getByRole('heading', { level: 1, name: RENEWAL_NAME })).toBeVisible()
  })

  test('both deals are in the list, on the one account', async ({ page }) => {
    expect(renewalId, 'a renewal must have been created').not.toBe('')
    await signIn(page, 'A')

    const deals = page.getByRole('region', { name: 'Deals' })
    const renewalRow = deals.getByRole('row', { name: new RegExp(RENEWAL_NAME) })
    await expect(renewalRow).toContainText(ACCOUNT_NAME)
    await expect(renewalRow).toContainText('Renewal')
    await expect(renewalRow).toContainText('€66,000.00')

    const predecessorRow = deals.getByRole('row', { name: new RegExp(PREDECESSOR_NAME) })
    await expect(predecessorRow).toContainText(ACCOUNT_NAME)
    await expect(predecessorRow).toContainText('New business')
    await expect(predecessorRow).toContainText('€60,000.00')

    await renewalRow.getByRole('link', { name: RENEWAL_NAME }).click()
    await expect(page).toHaveURL(new RegExp(`/workspace/deals/${renewalId}$`))

    // The account is intact and now holds both deals.
    await page.goto('/workspace/accounts')
    await expect(
      page
        .getByRole('region', { name: 'Accounts' })
        .getByRole('row', { name: new RegExp(ACCOUNT_NAME) }),
    ).toContainText('2 deals')
  })

  test("user B cannot start a renewal of user A's deal, nor see either deal", async ({
    page,
  }) => {
    expect(renewalId, 'a renewal must have been created').not.toBe('')
    await signIn(page, 'B')

    await page.goto(`/workspace/deals/${predecessorId}/renew`)
    await expect(page.getByRole('heading', { name: 'Deal not found' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create renewal' })).toHaveCount(0)
    await expect(page.getByText(PREDECESSOR_NAME)).toHaveCount(0)
    await expect(page.getByText(ACCOUNT_NAME)).toHaveCount(0)

    await page.goto(`/workspace/deals/${renewalId}`)
    await expect(page.getByRole('heading', { name: 'Deal not found' })).toBeVisible()
    await expect(page.getByText(RENEWAL_NAME)).toHaveCount(0)
    await expect(page.getByText(PREDECESSOR_NAME)).toHaveCount(0)

    await page.goto('/workspace')
    await expect(page.getByRole('heading', { level: 1, name: 'Deals' })).toBeVisible()
    await expect(page.getByText(RUN_PREFIX)).toHaveCount(0)

    // User A's records are untouched by B's attempts.
    expect((await readDealAsA(predecessorId)).id).toBe(predecessorId)
    expect((await readDealAsA(renewalId)).predecessor_deal_id).toBe(predecessorId)
  })
})
