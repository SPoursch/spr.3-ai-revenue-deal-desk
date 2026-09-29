import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import { requireTestEnv } from '../support/env'
import {
  signInTestUser,
  signOutTestUser,
  type SignedInTestUser,
} from '../support/supabase-clients'

/**
 * Deal Records, slice 2: edit and delete deals, and manage accounts.
 *
 * Creating an account and a deal through the UI is covered by
 * deal-records.spec.ts, so each test here starts from records set up
 * directly as user A: the publishable key and user A's own session, under
 * row level security, exactly the access the app itself has. Then the test
 * drives the UI as a person would: edit a deal, delete one after a
 * confirmation step, rename an account, delete an account with its deals.
 * Around that, the access boundaries: user B cannot open user A's edit or
 * delete pages, and a signed-out visitor is sent to /login.
 *
 * Names carry a per-run id. `afterAll` deletes every E2E account as user A
 * (which removes their deals too) and signs that session out.
 */

const E2E_PREFIX = 'E2E '
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const RUN_PREFIX = `${E2E_PREFIX}${RUN_ID}`

type Fixture = { accountId: string; accountName: string; dealId: string; dealName: string }

let userA: SignedInTestUser
/** One account-with-deal per test, created in `beforeAll`. */
const fixtures = {} as Record<
  'edit' | 'deleteDeal' | 'rename' | 'deleteAccount' | 'isolation',
  Fixture
>

/** Creates an account with one deal on it, as user A, under RLS. */
async function createAccountWithDeal(label: string): Promise<Fixture> {
  const accountName = `${RUN_PREFIX} ${label} Account`
  const dealName = `${RUN_PREFIX} ${label} Deal`

  const account = await userA.client
    .from('accounts')
    .insert({ name: accountName })
    .select('id')
    .single()
  if (account.error) throw new Error(`E2E setup: account insert failed (${account.error.code}).`)

  const deal = await userA.client
    .from('deals')
    .insert({
      account_id: account.data.id,
      name: dealName,
      deal_type: 'new_business',
      stage: 'negotiation',
      arr_eur: 60000,
    })
    .select('id')
    .single()
  if (deal.error) throw new Error(`E2E setup: deal insert failed (${deal.error.code}).`)

  return { accountId: account.data.id, accountName, dealId: deal.data.id, dealName }
}

async function signIn(page: Page, label: 'A' | 'B') {
  await page.goto('/login')
  await page.getByLabel('Email').fill(requireTestEnv(`DEAL_DESK_TEST_USER_${label}_EMAIL`))
  await page
    .getByLabel('Password')
    .fill(requireTestEnv(`DEAL_DESK_TEST_USER_${label}_PASSWORD`))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/workspace$/)
}

test.beforeAll(async () => {
  userA = await signInTestUser('A')
  fixtures.edit = await createAccountWithDeal('Edit')
  fixtures.deleteDeal = await createAccountWithDeal('DeleteDeal')
  fixtures.rename = await createAccountWithDeal('Rename')
  fixtures.deleteAccount = await createAccountWithDeal('DeleteAccount')
  fixtures.isolation = await createAccountWithDeal('Isolation')
})

test.afterAll(async () => {
  if (!userA) return

  try {
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
  const someId = randomUUID()

  for (const path of [
    '/workspace/accounts',
    `/workspace/accounts/${someId}/edit`,
    `/workspace/accounts/${someId}/delete`,
    `/workspace/deals/${someId}/edit`,
    `/workspace/deals/${someId}/delete`,
  ]) {
    test(`is sent to /login from ${path.replace(someId, '[id]')}`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login$/)
    })
  }
})

test.describe('user A', () => {
  test('edits a deal and sees the new values on its page and in the list', async ({ page }) => {
    const { dealId, dealName } = fixtures.edit
    await signIn(page, 'A')

    await page.goto(`/workspace/deals/${dealId}`)
    await page.getByRole('link', { name: 'Edit deal' }).click()
    await expect(page).toHaveURL(new RegExp(`/workspace/deals/${dealId}/edit$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Edit deal' })).toBeVisible()

    // The form starts from the deal's current values.
    await expect(page.getByLabel('Deal name')).toHaveValue(dealName)
    await expect(page.getByLabel('ARR (EUR)')).toHaveValue('60000')

    await page.getByLabel('Stage').selectOption({ label: 'Contracting' })
    await page.getByLabel('ARR (EUR)').fill('75000.50')
    await page.getByRole('button', { name: 'Save changes' }).click()

    await expect(page).toHaveURL(new RegExp(`/workspace/deals/${dealId}$`))
    const details = page.getByRole('region', { name: 'Deal details' })
    await expect(details).toContainText('Contracting')
    await expect(details).toContainText('€75,000.50')

    await page.goto('/workspace')
    const row = page
      .getByRole('region', { name: 'Deals' })
      .getByRole('row', { name: new RegExp(dealName) })
    await expect(row).toContainText('Contracting')
    await expect(row).toContainText('€75,000.50')
  })

  test('deletes a deal only after confirming, and its page is then not found', async ({
    page,
  }) => {
    const { dealId, dealName } = fixtures.deleteDeal
    await signIn(page, 'A')

    // Cancel leaves the deal intact.
    await page.goto(`/workspace/deals/${dealId}`)
    await page.getByRole('link', { name: 'Delete deal' }).click()
    await expect(page).toHaveURL(new RegExp(`/workspace/deals/${dealId}/delete$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Delete deal' })).toBeVisible()
    await expect(page.getByRole('main')).toContainText(dealName)
    await expect(page.getByRole('main')).toContainText(/cannot be undone/i)

    await page.getByRole('link', { name: 'Cancel' }).click()
    await expect(page).toHaveURL(new RegExp(`/workspace/deals/${dealId}$`))
    await expect(page.getByRole('heading', { level: 1, name: dealName })).toBeVisible()

    // Confirming deletes it.
    await page.getByRole('link', { name: 'Delete deal' }).click()
    await page.getByRole('button', { name: 'Delete deal' }).click()
    await expect(page).toHaveURL(/\/workspace$/)
    await expect(
      page.getByRole('region', { name: 'Deals' }).getByText(dealName),
    ).toHaveCount(0)

    await page.goto(`/workspace/deals/${dealId}`)
    await expect(page.getByRole('heading', { name: 'Deal not found' })).toBeVisible()
  })

  test('sees accounts with their deal count, and a rename shows everywhere', async ({
    page,
  }) => {
    const { accountName, dealId, dealName } = fixtures.rename
    const newName = `${RUN_PREFIX} Renamed Account`
    await signIn(page, 'A')

    await page.getByRole('link', { name: 'Accounts' }).click()
    await expect(page).toHaveURL(/\/workspace\/accounts$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Accounts' })).toBeVisible()

    const accounts = page.getByRole('region', { name: 'Accounts' })
    const row = accounts.getByRole('row', { name: new RegExp(accountName) })
    await expect(row).toContainText('1 deal')

    await row.getByRole('link', { name: 'Edit' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Edit account' })).toBeVisible()
    await expect(page.getByLabel('Account name')).toHaveValue(accountName)
    await page.getByLabel('Account name').fill(newName)
    await page.getByRole('button', { name: 'Save changes' }).click()

    // The account list, the deal list and the deal's page all show the new name.
    await expect(page).toHaveURL(/\/workspace\/accounts$/)
    await expect(accounts.getByRole('row', { name: new RegExp(newName) })).toContainText('1 deal')
    await expect(accounts.getByText(accountName, { exact: true })).toHaveCount(0)

    await page.goto('/workspace')
    await expect(
      page
        .getByRole('region', { name: 'Deals' })
        .getByRole('row', { name: new RegExp(dealName) }),
    ).toContainText(newName)

    await page.goto(`/workspace/deals/${dealId}`)
    await expect(page.getByRole('region', { name: 'Deal details' })).toContainText(newName)
  })

  test('deletes an account and its deal only after confirming', async ({ page }) => {
    const { accountId, accountName, dealId, dealName } = fixtures.deleteAccount
    await signIn(page, 'A')

    await page.goto('/workspace/accounts')
    const accounts = page.getByRole('region', { name: 'Accounts' })
    const row = accounts.getByRole('row', { name: new RegExp(accountName) })

    // The confirmation says what else goes; Cancel leaves everything intact.
    await row.getByRole('link', { name: 'Delete' }).click()
    await expect(page).toHaveURL(new RegExp(`/workspace/accounts/${accountId}/delete$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Delete account' })).toBeVisible()
    const main = page.getByRole('main')
    await expect(main).toContainText(accountName)
    await expect(main).toContainText('1 deal')
    await expect(main).toContainText(dealName)

    await page.getByRole('link', { name: 'Cancel' }).click()
    await expect(page).toHaveURL(/\/workspace\/accounts$/)
    await expect(accounts.getByRole('row', { name: new RegExp(accountName) })).toBeVisible()

    // Confirming deletes the account and its deal.
    await accounts
      .getByRole('row', { name: new RegExp(accountName) })
      .getByRole('link', { name: 'Delete' })
      .click()
    await page.getByRole('button', { name: 'Delete account' }).click()
    await expect(page).toHaveURL(/\/workspace\/accounts$/)
    await expect(accounts.getByText(accountName, { exact: true })).toHaveCount(0)

    await page.goto('/workspace')
    await expect(
      page.getByRole('region', { name: 'Deals' }).getByText(dealName),
    ).toHaveCount(0)

    await page.goto(`/workspace/deals/${dealId}`)
    await expect(page.getByRole('heading', { name: 'Deal not found' })).toBeVisible()
  })
})

test.describe('user B', () => {
  test("cannot open user A's edit or delete pages, nor see A's account", async ({ page }) => {
    const { accountId, accountName, dealId, dealName } = fixtures.isolation
    await signIn(page, 'B')

    for (const path of [`/workspace/deals/${dealId}/edit`, `/workspace/deals/${dealId}/delete`]) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: 'Deal not found' })).toBeVisible()
      await expect(page.getByText(dealName)).toHaveCount(0)
    }

    for (const path of [
      `/workspace/accounts/${accountId}/edit`,
      `/workspace/accounts/${accountId}/delete`,
    ]) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: 'Account not found' })).toBeVisible()
      await expect(page.getByText(accountName)).toHaveCount(0)
    }

    await page.goto('/workspace/accounts')
    await expect(page.getByRole('heading', { level: 1, name: 'Accounts' })).toBeVisible()
    await expect(page.getByText(accountName)).toHaveCount(0)
  })
})
