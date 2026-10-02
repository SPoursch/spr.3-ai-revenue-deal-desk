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
 * The Revenue Deal Desk dashboard at /workspace (UI Phase 2): the summary
 * figures, the "Needs attention" panel and the deal table's notice and
 * exceptions columns, all derived from the caller's own deals, live
 * exceptions and the Attention read model.
 *
 * Attention is time-dependent, so the fixtures are seeded with dates computed
 * from the run date, kept well away from the window edges, as in
 * attention.spec.ts. Assertions name this run's deals only, so other data
 * the test user owns cannot affect them; the summary figures are counts over
 * all of that data, so only their presence is asserted, not their values.
 * (Their arithmetic is unit-tested in tests/unit/deal-desk-dashboard.test.ts,
 * as is the notice column when the exceptions read fails.)
 *
 * Fixtures are set up directly as user A under RLS: one account with a deal
 * whose notice deadline was missed (one open exception, and a renewal deal),
 * a deal due soon, and a deal with no renewal date. No name contains another,
 * so a row or list item found by one name cannot match a second.
 *
 * `afterAll` deletes every E2E account of user A, which cascades to the deals
 * and their exceptions, and signs out.
 */

const E2E_PREFIX = 'E2E '
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const RUN_PREFIX = `${E2E_PREFIX}${RUN_ID}`
const ACCOUNT_NAME = `${RUN_PREFIX} Dashboard Account`

const MISSED = `${RUN_PREFIX} Dashboard Missed`
const SUCCESSOR = `${RUN_PREFIX} Dashboard Successor`
const DUE_SOON = `${RUN_PREFIX} Dashboard Due Soon`
const QUIET = `${RUN_PREFIX} Dashboard Quiet`

const TODAY = todayInBerlin(new Date())

let userA: SignedInTestUser

function plusDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

// Renewal in 20 days with 30 days' notice: the deadline was 10 days ago.
const MISSED_DEADLINE = plusDays(TODAY, -10)
// Renewal in 60 days with 45 days' notice: the deadline is in 15 days.
const DUE_SOON_DEADLINE = plusDays(TODAY, 15)

async function insertDeal(
  accountId: string,
  name: string,
  fields: {
    renewal_date?: string | null
    notice_period_days?: number | null
    deal_type?: 'new_business' | 'renewal'
    predecessor_deal_id?: string
  },
): Promise<string> {
  const { data, error } = await userA.client
    .from('deals')
    .insert({
      account_id: accountId,
      name,
      deal_type: fields.deal_type ?? 'new_business',
      stage: 'negotiation',
      arr_eur: 70000,
      renewal_date: fields.renewal_date ?? null,
      notice_period_days: fields.notice_period_days ?? null,
      predecessor_deal_id: fields.predecessor_deal_id ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error(`E2E setup: deal insert failed (${error.code}).`)
  return data.id
}

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(requireTestEnv('DEAL_DESK_TEST_USER_A_EMAIL'))
  await page.getByLabel('Password').fill(requireTestEnv('DEAL_DESK_TEST_USER_A_PASSWORD'))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  // On a fresh dev server the redirect also waits for /workspace to compile.
  await expect(page).toHaveURL(/\/workspace$/, { timeout: 30_000 })
}

function dealRow(page: Page, dealName: string): Locator {
  return page.getByRole('region', { name: 'Deals' }).getByRole('row', { name: new RegExp(dealName) })
}

/** A deal-table row's Notice deadline cell (Deal, Account, Type, Stage, ARR, Renewal date, Notice deadline, Exceptions). */
function noticeCell(row: Locator): Locator {
  return row.getByRole('cell').nth(6)
}

function exceptionsCell(row: Locator): Locator {
  return row.getByRole('cell').nth(7)
}

function panelItem(page: Page, dealName: string): Locator {
  return page
    .getByRole('region', { name: 'Needs attention' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: dealName, exact: true }) })
}

test.beforeAll(async () => {
  userA = await signInTestUser('A')

  const account = await userA.client.from('accounts').insert({ name: ACCOUNT_NAME }).select('id').single()
  if (account.error) throw new Error(`E2E setup: account insert failed (${account.error.code}).`)
  const accountId = account.data.id

  const missed = await insertDeal(accountId, MISSED, {
    renewal_date: plusDays(TODAY, 20),
    notice_period_days: 30,
  })
  const exception = await userA.client.from('exceptions').insert({
    deal_id: missed,
    rule_key: 'e2e_dashboard_open',
    rule_version: '1',
    kind: 'threshold_breach',
    severity: 'high',
    title: 'E2E dashboard exception',
    why: 'Created by the dashboard end-to-end tests.',
    origin: 'deterministic',
  })
  if (exception.error) throw new Error(`E2E setup: exception insert failed (${exception.error.code}).`)
  // An undated renewal deal: not listed by Attention itself.
  await insertDeal(accountId, SUCCESSOR, { deal_type: 'renewal', predecessor_deal_id: missed })

  await insertDeal(accountId, DUE_SOON, {
    renewal_date: plusDays(TODAY, 60),
    notice_period_days: 45,
  })
  await insertDeal(accountId, QUIET, {})
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

test.describe('dashboard', () => {
  test('shows the summary figures above the deals', async ({ page }) => {
    await signIn(page)

    const summary = page.getByRole('region', { name: 'Summary' })
    for (const label of ['Deals in progress', 'Open exceptions', 'Notice deadlines', 'Renewing next quarter']) {
      await expect(summary.getByText(label, { exact: true })).toBeVisible()
    }
  })

  test('the attention panel lists a missed and a due-soon deal with their reasons', async ({ page }) => {
    await signIn(page)

    const missed = panelItem(page, MISSED)
    await expect(missed).toContainText(`Notice missed ${formatDate(MISSED_DEADLINE)}`)
    await expect(missed).toContainText('1 open exception')
    await expect(missed).toContainText(`Renewed by ${SUCCESSOR}`)
    await expect(missed.getByRole('link', { name: SUCCESSOR, exact: true })).toHaveAttribute(
      'href',
      /^\/workspace\/deals\/[0-9a-f-]{36}$/,
    )

    const dueSoon = panelItem(page, DUE_SOON)
    await expect(dueSoon).toContainText(`Notice due ${formatDate(DUE_SOON_DEADLINE)}`)
    await expect(dueSoon).toContainText('No renewal deal yet')

    // Not due and not renewing next quarter: not listed.
    await expect(panelItem(page, QUIET)).toHaveCount(0)
  })

  test('the deal table shows each notice status and the open exceptions', async ({ page }) => {
    await signIn(page)

    const missed = dealRow(page, MISSED)
    await expect(noticeCell(missed)).toContainText(`Missed ${formatDate(MISSED_DEADLINE)}`)
    await expect(noticeCell(missed)).toContainText('Renewal created')
    await expect(exceptionsCell(missed)).toHaveText('1 open')

    const dueSoon = dealRow(page, DUE_SOON)
    await expect(noticeCell(dueSoon)).toHaveText(`Due ${formatDate(DUE_SOON_DEADLINE)}`)
    await expect(exceptionsCell(dueSoon)).toHaveText('None')

    // No renewal date: no notice deadline at all.
    await expect(noticeCell(dealRow(page, QUIET))).toHaveText('—')

    // The renewal deal is its own row, with its type in the Type cell.
    await expect(dealRow(page, SUCCESSOR).getByRole('cell').nth(2)).toHaveText('Renewal')
  })
})
