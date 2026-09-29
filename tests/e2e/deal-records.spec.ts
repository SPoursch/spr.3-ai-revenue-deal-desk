import { expect, test, type Page } from '@playwright/test'

import { requireTestEnv } from '../support/env'
import { signInTestUser } from '../support/supabase-clients'

/**
 * Deal Records, slice 1: create and view deals.
 *
 * The happy path a person follows: sign in, create an account, create a deal
 * on it, find the deal in the list and open it. Around it, the two access
 * boundaries: a signed-out visitor is sent to /login, and a second user
 * cannot open the first user's deal by its URL.
 *
 * Everything runs against the hosted canonical database as the two dedicated
 * test users, signed in through the real login form. The names carry a
 * per-run id, and `afterAll` deletes this run's account as user A through the
 * publishable key and user A's own session (RLS applies), which removes its
 * deals too.
 */

const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const RUN_PREFIX = `E2E ${RUN_ID}`
const ACCOUNT_NAME = `${RUN_PREFIX} Account`
const DEAL_NAME = `${RUN_PREFIX} Deal`

async function signIn(page: Page, label: 'A' | 'B') {
  await page.goto('/login')
  await page.getByLabel('Email').fill(requireTestEnv(`DEAL_DESK_TEST_USER_${label}_EMAIL`))
  await page
    .getByLabel('Password')
    .fill(requireTestEnv(`DEAL_DESK_TEST_USER_${label}_PASSWORD`))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/workspace$/)
}

test.describe('signed-out visitor', () => {
  for (const path of ['/workspace', '/workspace/deals/new', '/workspace/accounts/new']) {
    test(`is sent to /login from ${path}`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login$/)
    })
  }
})

test.describe.serial('deal records', () => {
  let dealUrl = ''

  test.afterAll(async () => {
    const userA = await signInTestUser('A')
    const { error } = await userA.client
      .from('accounts')
      .delete()
      .like('name', `${RUN_PREFIX}%`)
    if (error) throw new Error(`E2E cleanup failed (${error.code}).`)
  })

  test('user A creates an account and a deal, and finds it in the list', async ({
    page,
  }) => {
    await signIn(page, 'A')

    // Create the account the deal will belong to.
    await page.getByRole('link', { name: 'New account' }).click()
    await expect(page).toHaveURL(/\/workspace\/accounts\/new$/)
    await page.getByLabel('Account name').fill(ACCOUNT_NAME)
    await page.getByRole('button', { name: 'Create account' }).click()

    // Saving an account continues to a new deal with that account chosen.
    await expect(page).toHaveURL(/\/workspace\/deals\/new\?accountId=/)
    await expect(page.getByLabel('Account').locator('option:checked')).toHaveText(
      ACCOUNT_NAME,
    )

    await page.getByLabel('Deal name').fill(DEAL_NAME)
    await page.getByLabel('Deal type').selectOption({ label: 'New business' })
    await page.getByLabel('Stage').selectOption({ label: 'Negotiation' })
    await page.getByLabel('ARR (EUR)').fill('60000')
    await page.getByLabel('Renewal date').fill('2027-03-31')
    await page.getByRole('button', { name: 'Create deal' }).click()

    // The new deal's detail page.
    await expect(page).toHaveURL(/\/workspace\/deals\/[0-9a-f-]{36}$/)
    dealUrl = new URL(page.url()).pathname

    await expect(page.getByRole('heading', { level: 1, name: DEAL_NAME })).toBeVisible()
    const details = page.getByRole('region', { name: 'Deal details' })
    await expect(details).toContainText(ACCOUNT_NAME)
    await expect(details).toContainText('New business')
    await expect(details).toContainText('Negotiation')
    await expect(details).toContainText('€60,000.00')
    await expect(details).toContainText('31 Mar 2027')

    // Back in the list, the deal is there and opens the same page.
    await page.goto('/workspace')
    const list = page.getByRole('region', { name: 'Deals' })
    const row = list.getByRole('row', { name: new RegExp(DEAL_NAME) })
    await expect(row).toContainText(ACCOUNT_NAME)
    await expect(row).toContainText('€60,000.00')

    await row.getByRole('link', { name: DEAL_NAME }).click()
    await expect(page).toHaveURL(new RegExp(`${dealUrl}$`))
    await expect(page.getByRole('heading', { level: 1, name: DEAL_NAME })).toBeVisible()
  })

  test("user B cannot open user A's deal by its URL", async ({ page }) => {
    expect(dealUrl, 'the previous test must have created a deal').not.toBe('')

    await signIn(page, 'B')
    await page.goto(dealUrl)

    await expect(page.getByRole('heading', { name: 'Deal not found' })).toBeVisible()
    await expect(page.getByText(DEAL_NAME)).toHaveCount(0)
    await expect(page.getByText(ACCOUNT_NAME)).toHaveCount(0)
  })
})
