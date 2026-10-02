import { expect, test, type Locator, type Page } from '@playwright/test'

import { todayInBerlin } from '../../app/lib/deal-desk/attention'
import { formatDate } from '../../app/lib/deal-desk/format'
import { requireTestEnv } from '../support/env'
import {
  signInTestUser,
  signOutTestUser,
  type SignedInTestUser,
} from '../support/supabase-clients'

/**
 * The account page at /workspace/accounts/[accountId] (UI Phase 3), and the
 * account list's way to it. Create, edit and delete keep their own specs
 * (deal-records*.spec.ts); this covers what the redesign added.
 *
 * The page shows only what the domain holds: the account's own fields, and
 * its deals with the dashboard's figures and notice status over them.
 *
 * Fixtures are set up directly as user A under RLS: an account with every
 * field set and two deals (one with a notice deadline due soon), an account
 * with no deals, and a second account whose deal must not appear on the
 * first one's page. Each of the two accounts has one open exception, so the
 * page's figures and Exceptions column prove they count this account's
 * exceptions only (1, never 2). No name contains another. `afterAll` deletes
 * every E2E account of user A, which cascades to the deals and their
 * exceptions, and signs out.
 */

const E2E_PREFIX = 'E2E '
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const RUN_PREFIX = `${E2E_PREFIX}${RUN_ID}`

const PROFILE_ACCOUNT = `${RUN_PREFIX} Profile Nordlicht`
const EMPTY_ACCOUNT = `${RUN_PREFIX} Profile Empty`
const OTHER_ACCOUNT = `${RUN_PREFIX} Profile Elsewhere`
const DUE_SOON_DEAL = `${RUN_PREFIX} Nordlicht Due Soon Deal`
const CLOSED_DEAL = `${RUN_PREFIX} Nordlicht Closed Deal`
const OTHER_DEAL = `${RUN_PREFIX} Elsewhere Deal`

const TODAY = todayInBerlin(new Date())

let userA: SignedInTestUser
const ids: Record<string, string> = {}

function plusDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

// Renewal in 60 days with 45 days' notice: the deadline is in 15 days.
const DUE_SOON_DEADLINE = plusDays(TODAY, 15)

async function insertAccount(name: string, fields: Record<string, string> = {}): Promise<string> {
  const { data, error } = await userA.client
    .from('accounts')
    .insert({ name, ...fields })
    .select('id')
    .single()
  if (error) throw new Error(`E2E setup: account insert failed (${error.code}).`)
  ids[name] = data.id
  return data.id
}

async function insertDeal(
  accountId: string,
  name: string,
  fields: { stage: string; renewal_date?: string; notice_period_days?: number },
) {
  const { data, error } = await userA.client
    .from('deals')
    .insert({
      account_id: accountId,
      name,
      deal_type: 'new_business',
      stage: fields.stage,
      arr_eur: 48000,
      renewal_date: fields.renewal_date ?? null,
      notice_period_days: fields.notice_period_days ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error(`E2E setup: deal insert failed (${error.code}).`)
  ids[name] = data.id
}

/** One open, medium-severity exception on `dealId`. */
async function insertOpenException(dealId: string, ruleKey: string) {
  const { error } = await userA.client.from('exceptions').insert({
    deal_id: dealId,
    rule_key: ruleKey,
    rule_version: '1',
    kind: 'threshold_breach',
    severity: 'medium',
    title: `E2E account ${ruleKey}`,
    why: 'Created by the account page end-to-end tests.',
    origin: 'deterministic',
  })
  if (error) throw new Error(`E2E setup: exception insert failed (${error.code}).`)
}

async function signIn(page: Page, label: 'A' | 'B') {
  await page.goto('/login')
  await page.getByLabel('Email').fill(requireTestEnv(`DEAL_DESK_TEST_USER_${label}_EMAIL`))
  await page.getByLabel('Password').fill(requireTestEnv(`DEAL_DESK_TEST_USER_${label}_PASSWORD`))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  // On a fresh dev server the redirect also waits for /workspace to compile.
  await expect(page).toHaveURL(/\/workspace$/, { timeout: 30_000 })
}

/** The value of one term in the account page's About list. */
function about(page: Page, term: string): Locator {
  return page
    .getByRole('region', { name: 'About' })
    .locator('div')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${term}$`) }) })
    .locator('dd')
}

/** One summary figure: its value and its detail line. */
function figure(page: Page, label: string): { value: Locator; detail: Locator } {
  const tile = page
    .getByRole('region', { name: 'Summary' })
    .locator('div')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) })
    .locator('dd')
  return { value: tile.nth(0), detail: tile.nth(1) }
}

function dealRow(page: Page, dealName: string): Locator {
  return page.getByRole('region', { name: 'Deals' }).getByRole('row', { name: new RegExp(dealName) })
}

test.beforeAll(async () => {
  userA = await signInTestUser('A')

  const profile = await insertAccount(PROFILE_ACCOUNT, {
    industry: 'Logistics',
    segment: 'Enterprise',
    region: 'EMEA',
    country_code: 'DE',
  })
  await insertDeal(profile, DUE_SOON_DEAL, {
    stage: 'negotiation',
    renewal_date: plusDays(TODAY, 60),
    notice_period_days: 45,
  })
  await insertDeal(profile, CLOSED_DEAL, { stage: 'closed' })

  await insertAccount(EMPTY_ACCOUNT)

  const other = await insertAccount(OTHER_ACCOUNT)
  await insertDeal(other, OTHER_DEAL, { stage: 'discovery' })

  // One open exception on each account: the profile page must count only its own.
  await insertOpenException(ids[DUE_SOON_DEAL], 'e2e_account_profile')
  await insertOpenException(ids[OTHER_DEAL], 'e2e_account_elsewhere')
})

test.afterAll(async () => {
  if (!userA) return
  try {
    // Deleting the accounts cascades to their deals.
    const { error } = await userA.client.from('accounts').delete().like('name', `${E2E_PREFIX}%`)
    if (error) throw new Error(`E2E cleanup failed (${error.code}).`)
  } finally {
    await signOutTestUser(userA)
  }
})

test.describe('signed-out visitor', () => {
  test('is sent to /login from an account page', async ({ page }) => {
    await page.goto(`/workspace/accounts/${crypto.randomUUID()}`)
    await expect(page).toHaveURL(/\/login$/)
  })
})

test.describe('account page', () => {
  test('the account list shows its fields and opens the account page', async ({ page }) => {
    await signIn(page, 'A')
    await page.goto('/workspace/accounts')

    const row = page
      .getByRole('region', { name: 'Accounts' })
      .getByRole('row', { name: new RegExp(PROFILE_ACCOUNT) })
    for (const value of ['Logistics', 'Enterprise', 'EMEA', 'DE', '2 deals']) {
      await expect(row).toContainText(value)
    }

    await row.getByRole('link', { name: 'Open' }).click()
    await expect(page).toHaveURL(new RegExp(`/workspace/accounts/${ids[PROFILE_ACCOUNT]}$`))
    await expect(page.getByRole('heading', { level: 1, name: PROFILE_ACCOUNT })).toBeVisible()
  })

  test('shows what is recorded about the account, and its actions', async ({ page }) => {
    await signIn(page, 'A')
    await page.goto(`/workspace/accounts/${ids[PROFILE_ACCOUNT]}`)

    await expect(about(page, 'Industry')).toHaveText('Logistics')
    await expect(about(page, 'Segment')).toHaveText('Enterprise')
    await expect(about(page, 'Region')).toHaveText('EMEA')
    await expect(about(page, 'Country code')).toHaveText('DE')

    const main = page.getByRole('main')
    const id = ids[PROFILE_ACCOUNT]
    await expect(main.getByRole('link', { name: 'New deal' })).toHaveAttribute(
      'href',
      `/workspace/deals/new?accountId=${id}`,
    )
    await expect(main.getByRole('link', { name: 'Edit account' })).toHaveAttribute(
      'href',
      `/workspace/accounts/${id}/edit`,
    )
    await expect(main.getByRole('link', { name: 'Delete account' })).toHaveAttribute(
      'href',
      `/workspace/accounts/${id}/delete`,
    )
  })

  test("lists the account's deals only, with their figures and notice status", async ({ page }) => {
    await signIn(page, 'A')
    await page.goto(`/workspace/accounts/${ids[PROFILE_ACCOUNT]}`)

    // Only this account's deals and exceptions are counted. User A's other
    // account has an open exception too: counting it would show 2 on 2 deals.
    await expect(figure(page, 'Deals in progress').value).toHaveText('1')
    await expect(figure(page, 'Deals in progress').detail).toHaveText('of 2 deals in total')
    await expect(figure(page, 'Open exceptions').value).toHaveText('1')
    await expect(figure(page, 'Open exceptions').detail).toHaveText('On 1 deal')

    const dueSoon = dealRow(page, DUE_SOON_DEAL)
    await expect(dueSoon).toContainText('Negotiation')
    // Deal, Type, Stage, ARR, Renewal date, Notice deadline, Exceptions: no
    // Account column on the account's own page.
    await expect(dueSoon.getByRole('cell').nth(5)).toHaveText(`Due ${formatDate(DUE_SOON_DEADLINE)}`)
    await expect(page.getByRole('region', { name: 'Deals' }).getByRole('columnheader', { name: 'Account' })).toHaveCount(0)
    await expect(dueSoon.getByRole('cell').nth(6)).toHaveText('1 open')
    await expect(dealRow(page, CLOSED_DEAL)).toContainText('Closed')
    await expect(dealRow(page, CLOSED_DEAL).getByRole('cell').nth(6)).toHaveText('None')
    await expect(page.getByRole('region', { name: 'Deals' }).getByText(OTHER_DEAL)).toHaveCount(0)

    await dueSoon.getByRole('link', { name: DUE_SOON_DEAL }).click()
    await expect(page).toHaveURL(new RegExp(`/workspace/deals/${ids[DUE_SOON_DEAL]}$`))

    // The other account's exception is live and counted on its own page, so
    // the 1 above is this account's alone, not a missing exception.
    await page.goto(`/workspace/accounts/${ids[OTHER_ACCOUNT]}`)
    await expect(figure(page, 'Open exceptions').value).toHaveText('1')
    await expect(dealRow(page, OTHER_DEAL).getByRole('cell').nth(6)).toHaveText('1 open')
    await expect(page.getByRole('region', { name: 'Deals' }).getByText(DUE_SOON_DEAL)).toHaveCount(0)
  })

  test('an account without deals offers to add one for it', async ({ page }) => {
    await signIn(page, 'A')
    await page.goto(`/workspace/accounts/${ids[EMPTY_ACCOUNT]}`)

    const deals = page.getByRole('region', { name: 'Deals' })
    await expect(deals).toContainText('No deals for this account yet')
    await expect(deals.getByRole('link', { name: 'Add a deal' })).toHaveAttribute(
      'href',
      `/workspace/deals/new?accountId=${ids[EMPTY_ACCOUNT]}`,
    )
    await expect(page.getByRole('region', { name: 'Summary' })).toHaveCount(0)
  })

  test("user B cannot open user A's account, and an unknown id is not found", async ({ page }) => {
    await signIn(page, 'B')

    await page.goto(`/workspace/accounts/${ids[PROFILE_ACCOUNT]}`)
    await expect(page.getByRole('heading', { name: 'Account not found' })).toBeVisible()
    await expect(page.getByText(PROFILE_ACCOUNT)).toHaveCount(0)

    for (const id of [crypto.randomUUID(), 'not-a-uuid']) {
      await page.goto(`/workspace/accounts/${id}`)
      await expect(page.getByRole('heading', { name: 'Account not found' })).toBeVisible()
    }
  })
})
