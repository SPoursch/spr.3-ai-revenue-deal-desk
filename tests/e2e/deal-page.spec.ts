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
 * The deal page at /workspace/deals/[dealId] (UI Phase 5): the header with
 * the account link, the key facts with the deal's notice status, the
 * exception count and badges, and that every existing section is still
 * rendered with each action once. The sections' own behaviour keeps its
 * specs (deal-records*, provisions-citations, evidence-excerpts,
 * exceptions-decisions, copilot); this covers what the redesign added.
 *
 * Fixtures are set up directly as user A under RLS: one account with a deal
 * whose notice deadline was missed, one open high-severity exception on it,
 * and a renewal deal. No name contains another. `afterAll` deletes every E2E
 * account of user A, which cascades to the deals and exceptions, and signs out.
 */

const E2E_PREFIX = 'E2E '
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const RUN_PREFIX = `${E2E_PREFIX}${RUN_ID}`

const ACCOUNT_NAME = `${RUN_PREFIX} Harbour Account`
const DEAL_NAME = `${RUN_PREFIX} Harbour Platform`
const RENEWAL_NAME = `${RUN_PREFIX} Harbour Successor`

const TODAY = todayInBerlin(new Date())

let userA: SignedInTestUser
const ids: Record<string, string> = {}

function plusDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

// Renewal in 20 days with 30 days' notice: the deadline was 10 days ago.
const MISSED_DEADLINE = plusDays(TODAY, -10)

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(requireTestEnv('DEAL_DESK_TEST_USER_A_EMAIL'))
  await page.getByLabel('Password').fill(requireTestEnv('DEAL_DESK_TEST_USER_A_PASSWORD'))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  // On a fresh dev server the redirect also waits for /workspace to compile.
  await expect(page).toHaveURL(/\/workspace$/, { timeout: 30_000 })
}

/** The value of one term in the Key facts list. */
function keyFact(page: Page, term: string): Locator {
  return page
    .getByRole('region', { name: 'Key facts' })
    .locator('div')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${term}$`) }) })
    .locator('dd')
}

test.beforeAll(async () => {
  userA = await signInTestUser('A')

  const account = await userA.client.from('accounts').insert({ name: ACCOUNT_NAME }).select('id').single()
  if (account.error) throw new Error(`E2E setup: account insert failed (${account.error.code}).`)
  ids.account = account.data.id

  const deal = await userA.client
    .from('deals')
    .insert({
      account_id: ids.account,
      name: DEAL_NAME,
      deal_type: 'new_business',
      stage: 'negotiation',
      arr_eur: 84000,
      tcv_eur: 252000,
      term_months: 36,
      renewal_date: plusDays(TODAY, 20),
      notice_period_days: 30,
    })
    .select('id')
    .single()
  if (deal.error) throw new Error(`E2E setup: deal insert failed (${deal.error.code}).`)
  ids.deal = deal.data.id

  const renewal = await userA.client.from('deals').insert({
    account_id: ids.account,
    name: RENEWAL_NAME,
    deal_type: 'renewal',
    stage: 'discovery',
    arr_eur: 90000,
    predecessor_deal_id: ids.deal,
  })
  if (renewal.error) throw new Error(`E2E setup: renewal insert failed (${renewal.error.code}).`)

  const exception = await userA.client.from('exceptions').insert({
    deal_id: ids.deal,
    rule_key: 'e2e_deal_page_open',
    rule_version: '1',
    kind: 'threshold_breach',
    severity: 'high',
    title: `${RUN_PREFIX} Harbour exception`,
    why: 'Created by the deal page end-to-end tests.',
    origin: 'deterministic',
  })
  if (exception.error) throw new Error(`E2E setup: exception insert failed (${exception.error.code}).`)
})

test.afterAll(async () => {
  if (!userA) return
  try {
    // Deleting the account cascades to the deals and their exceptions.
    const { error } = await userA.client.from('accounts').delete().like('name', `${E2E_PREFIX}%`)
    if (error) throw new Error(`E2E cleanup failed (${error.code}).`)
  } finally {
    await signOutTestUser(userA)
  }
})

test.describe('deal page', () => {
  test('the header names the deal and links its account', async ({ page }) => {
    await signIn(page)
    await page.goto(`/workspace/deals/${ids.deal}`)

    await expect(page.getByRole('heading', { level: 1, name: DEAL_NAME })).toBeVisible()
    await page.getByRole('main').getByRole('link', { name: ACCOUNT_NAME, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/workspace/accounts/${ids.account}$`))
  })

  test('the key facts show real values and the notice status', async ({ page }) => {
    await signIn(page)
    await page.goto(`/workspace/deals/${ids.deal}`)

    await expect(keyFact(page, 'ARR')).toHaveText('€84,000.00')
    await expect(keyFact(page, 'TCV')).toHaveText('€252,000.00')
    await expect(keyFact(page, 'Term')).toHaveText('36 months')
    await expect(keyFact(page, 'Notice deadline')).toContainText(`Missed ${formatDate(MISSED_DEADLINE)}`)
    await expect(keyFact(page, 'Notice deadline')).toContainText('Renewal created')
  })

  test('the exceptions card counts and labels the live exception', async ({ page }) => {
    await signIn(page)
    await page.goto(`/workspace/deals/${ids.deal}`)

    const exceptions = page.getByRole('region', { name: 'Exceptions' })
    await expect(exceptions.getByRole('heading', { name: 'Exceptions (1 open)' })).toBeVisible()
    const item = exceptions.getByRole('listitem')
    await expect(item).toHaveCount(1)
    await expect(item).toContainText('High')
    await expect(item).toContainText('Open')
  })

  test('every section is rendered, and each action appears once', async ({ page }) => {
    await signIn(page)
    await page.goto(`/workspace/deals/${ids.deal}`)

    for (const name of ['Key facts', 'Exceptions', 'Provisions', 'Evidence', 'Deal details', 'Renewal lineage']) {
      await expect(page.getByRole('region', { name, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('region', { name: 'Copilot', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Copilot answers' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Renewal lineage' })).toContainText(
      `Renewed by ${RENEWAL_NAME}`,
    )

    for (const name of ['Edit deal', 'Delete deal', 'Create renewal']) {
      await expect(page.getByRole('link', { name, exact: true })).toHaveCount(1)
    }
  })
})
