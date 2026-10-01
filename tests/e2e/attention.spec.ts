import { expect, test, type Locator, type Page } from '@playwright/test'

import { nextCalendarQuarter, todayInBerlin } from '../../app/lib/deal-desk/attention'
import { formatDate } from '../../app/lib/deal-desk/format'
import { requireTestEnv } from '../support/env'
import {
  signInTestUser,
  signOutTestUser,
  type SignedInTestUser,
} from '../support/supabase-clients'

/**
 * Feature 7: Attention / Renewal Intelligence V1 at /workspace/attention.
 * Contract: docs/sprint-3-domain-index.md §10.
 *
 * Attention is a derived, time-dependent read model (A1), so the fixtures are
 * seeded with dates computed from the run date by the same pure helpers the
 * page uses, kept well away from the window edges. Assertions name this run's
 * deals, so other data the test user owns cannot affect them.
 *
 * Fixtures are set up directly as user A under RLS (publishable key, user A's
 * own session), as in the other specs: one account with five deals — a missed
 * notice deadline with live and closed exceptions, a deadline due soon at
 * exactly €50,000 ARR, a deal renewing next quarter that has renewal deals,
 * a deal with no notice period, and a deal whose renewal has passed. The
 * next-quarter deal has two renewal deals, and both are shown. User B
 * owns nothing here and sees the empty states.
 *
 * `afterAll` deletes every E2E account of user A, which cascades to the deals
 * and their exceptions, and signs out.
 */

const E2E_PREFIX = 'E2E '
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const RUN_PREFIX = `${E2E_PREFIX}${RUN_ID}`
const ACCOUNT_NAME = `${RUN_PREFIX} Attention Account`

const MISSED = `${RUN_PREFIX} Attention Missed`
const DUE_SOON = `${RUN_PREFIX} Attention Due Soon`
const NEXT_QUARTER = `${RUN_PREFIX} Attention Next Quarter`
const SUCCESSOR = `${RUN_PREFIX} Attention Next Quarter Renewal`
const SECOND_SUCCESSOR = `${RUN_PREFIX} Attention Second Renewal`
const NO_NOTICE = `${RUN_PREFIX} Attention No Notice`
const PASSED = `${RUN_PREFIX} Attention Passed`

const TODAY = todayInBerlin(new Date())
const NEXT = nextCalendarQuarter(TODAY)

let userA: SignedInTestUser
const dealIds: Record<string, string> = {}

function plusDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

async function insertDeal(
  accountId: string,
  name: string,
  fields: {
    arr_eur: number
    renewal_date?: string | null
    notice_period_days?: number | null
    auto_renew?: boolean | null
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
      stage: 'closed',
      arr_eur: fields.arr_eur,
      renewal_date: fields.renewal_date ?? null,
      notice_period_days: fields.notice_period_days ?? null,
      auto_renew: fields.auto_renew ?? null,
      predecessor_deal_id: fields.predecessor_deal_id ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error(`E2E setup: deal insert failed (${error.code}).`)
  dealIds[name] = data.id
  return data.id
}

/**
 * An exception on `dealId` with `status`. 'under_review', 'decided' and
 * 'dismissed' are set with a direct status update after insert, which the
 * database allows; normally a reviewer or a recorded Decision sets them.
 */
async function insertException(dealId: string, ruleKey: string, status: string) {
  const { data, error } = await userA.client
    .from('exceptions')
    .insert({
      deal_id: dealId,
      rule_key: ruleKey,
      rule_version: '1',
      kind: 'threshold_breach',
      severity: 'high',
      title: `E2E attention ${ruleKey}`,
      why: 'Created by the Feature 7 end-to-end tests.',
      origin: 'deterministic',
    })
    .select('id')
    .single()
  if (error) throw new Error(`E2E setup: exception insert failed (${error.code}).`)
  if (status !== 'open') {
    const update = await userA.client.from('exceptions').update({ status }).eq('id', data.id)
    if (update.error) throw new Error(`E2E setup: exception update failed (${update.error.code}).`)
  }
}

async function signIn(page: Page, label: 'A' | 'B') {
  await page.goto('/login')
  await page.getByLabel('Email').fill(requireTestEnv(`DEAL_DESK_TEST_USER_${label}_EMAIL`))
  await page.getByLabel('Password').fill(requireTestEnv(`DEAL_DESK_TEST_USER_${label}_PASSWORD`))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  // On a fresh dev server the redirect also waits for /workspace to compile.
  await expect(page).toHaveURL(/\/workspace$/, { timeout: 30_000 })
}

function table(page: Page, name: string): Locator {
  return page.getByRole('table', { name, exact: true })
}

function row(page: Page, tableName: string, dealName: string): Locator {
  return table(page, tableName).locator('tbody tr', { hasText: dealName })
}

/** A row's Auto-renew cell (Deal, Account, ARR, Renewal date, Notice deadline, Auto-renew, …). */
function autoRenewCell(tableRow: Locator): Locator {
  return tableRow.locator('td').nth(5)
}

const MISSED_TABLE = 'Missed notice deadlines'
const DUE_SOON_TABLE = 'Notice deadlines due soon'
const NEXT_QUARTER_TABLE = 'Deals renewing next quarter'
const CANNOT_COMPUTE_TABLE = 'Deals whose notice deadline cannot be computed'

test.beforeAll(async () => {
  userA = await signInTestUser('A')

  const account = await userA.client.from('accounts').insert({ name: ACCOUNT_NAME }).select('id').single()
  if (account.error) throw new Error(`E2E setup: account insert failed (${account.error.code}).`)
  const accountId = account.data.id

  // Deadline 10 days ago, renewal in 20 days: missed. Two live exceptions.
  const missed = await insertDeal(accountId, MISSED, {
    arr_eur: 80000,
    renewal_date: plusDays(TODAY, 20),
    notice_period_days: 30,
    auto_renew: true,
  })
  await insertException(missed, 'e2e_attention_open', 'open')
  await insertException(missed, 'e2e_attention_review', 'under_review')
  await insertException(missed, 'e2e_attention_decided', 'decided')
  await insertException(missed, 'e2e_attention_dismissed', 'dismissed')

  // Deadline in 15 days: due soon. Exactly €50,000 ARR: out under the filter.
  await insertDeal(accountId, DUE_SOON, {
    arr_eur: 50000,
    renewal_date: plusDays(TODAY, 60),
    notice_period_days: 45,
    auto_renew: false,
  })

  // Renews two weeks into next quarter, and already has two renewal deals:
  // one undated, one dated more than a year after next quarter (so neither is
  // listed itself). The dated one is shown first.
  const nextQuarter = await insertDeal(accountId, NEXT_QUARTER, {
    arr_eur: 120000,
    renewal_date: plusDays(NEXT.start, 14),
    notice_period_days: 0,
  })
  await insertDeal(accountId, SUCCESSOR, {
    arr_eur: 125000,
    deal_type: 'renewal',
    predecessor_deal_id: nextQuarter,
  })
  await insertDeal(accountId, SECOND_SUCCESSOR, {
    arr_eur: 130000,
    deal_type: 'renewal',
    predecessor_deal_id: nextQuarter,
    renewal_date: plusDays(NEXT.end, 400),
    notice_period_days: 30,
  })

  // Renewal date but no notice period: cannot compute, never safe.
  await insertDeal(accountId, NO_NOTICE, {
    arr_eur: 40000,
    renewal_date: plusDays(TODAY, 200),
    notice_period_days: null,
  })

  // Renewal already passed: never listed.
  await insertDeal(accountId, PASSED, {
    arr_eur: 90000,
    renewal_date: plusDays(TODAY, -5),
    notice_period_days: 30,
  })
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

test.describe('signed-out visitor', () => {
  test('is sent to /login from /workspace/attention', async ({ page }) => {
    await page.goto('/workspace/attention')
    await expect(page).toHaveURL(/\/login$/)
  })
})

test.describe('user A', () => {
  test('opens Attention from the workspace and sees the date and quarter it used', async ({ page }) => {
    await signIn(page, 'A')

    await page.getByRole('link', { name: 'Attention', exact: true }).click()

    await expect(page).toHaveURL(/\/workspace\/attention$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Attention' })).toBeVisible()
    await expect(page.getByRole('main')).toContainText(
      `As of ${formatDate(TODAY)} (Europe/Berlin). Next quarter: ${formatDate(NEXT.start)} – ${formatDate(NEXT.end)}.`,
    )
  })

  test("lists the user's deals in the right sections, with every field", async ({ page }) => {
    await signIn(page, 'A')
    await page.goto('/workspace/attention')

    const missed = row(page, MISSED_TABLE, MISSED)
    await expect(missed).toHaveCount(1)
    await expect(missed).toContainText(ACCOUNT_NAME)
    await expect(missed).toContainText('€80,000.00')
    await expect(missed).toContainText(formatDate(plusDays(TODAY, 20)))
    await expect(missed).toContainText(`${formatDate(plusDays(TODAY, -10))} Missed`)
    await expect(autoRenewCell(missed)).toHaveText('Yes')
    await expect(missed).toContainText('No renewal deal yet')

    const dueSoon = row(page, DUE_SOON_TABLE, DUE_SOON)
    await expect(dueSoon).toHaveCount(1)
    await expect(dueSoon).toContainText(`${formatDate(plusDays(TODAY, 15))} Due soon`)
    await expect(autoRenewCell(dueSoon)).toHaveText('No')

    const nextQuarter = row(page, NEXT_QUARTER_TABLE, NEXT_QUARTER)
    await expect(nextQuarter).toHaveCount(1)
    // Both renewal deals, the dated one first, never just one of them.
    await expect(nextQuarter).toContainText(`Renewed by ${SECOND_SUCCESSOR}, ${SUCCESSOR}`)
    await expect(autoRenewCell(nextQuarter)).toHaveText('Unknown')

    // Neither the passed renewal nor the successor (no renewal date) is
    // listed as a deal of its own: no row's deal cell names them.
    await expect(page.getByRole('main')).not.toContainText(PASSED)
    for (const successor of [SUCCESSOR, SECOND_SUCCESSOR]) {
      await expect(page.locator('tbody tr td:first-child', { hasText: successor })).toHaveCount(0)
    }
  })

  test("links each renewal deal in 'Renewed by' to that deal's page", async ({ page }) => {
    await signIn(page, 'A')

    for (const successor of [SECOND_SUCCESSOR, SUCCESSOR]) {
      await page.goto('/workspace/attention')
      await row(page, NEXT_QUARTER_TABLE, NEXT_QUARTER).getByRole('link', { name: successor, exact: true }).click()

      await expect(page).toHaveURL(new RegExp(`/workspace/deals/${dealIds[successor]}$`))
      await expect(page.getByRole('heading', { level: 1, name: successor })).toBeVisible()
    }
  })

  test('counts only open and under-review exceptions', async ({ page }) => {
    await signIn(page, 'A')
    await page.goto('/workspace/attention')

    // Open + under review; the decided and dismissed ones are not counted.
    await expect(row(page, MISSED_TABLE, MISSED)).toContainText('2 open')
    await expect(row(page, DUE_SOON_TABLE, DUE_SOON)).toContainText('None')
  })

  test('shows a deal without a notice period separately, never as safe', async ({ page }) => {
    await signIn(page, 'A')
    await page.goto('/workspace/attention')

    const gap = row(page, CANNOT_COMPUTE_TABLE, NO_NOTICE)
    await expect(gap).toHaveCount(1)
    await expect(gap).toContainText('Cannot compute — no notice period')
    for (const name of [MISSED_TABLE, DUE_SOON_TABLE]) {
      await expect(row(page, name, NO_NOTICE)).toHaveCount(0)
    }
    await expect(page.getByRole('region', { name: 'Cannot compute' })).toContainText('They are not safe')
  })

  test('links each deal to its deal page', async ({ page }) => {
    await signIn(page, 'A')
    await page.goto('/workspace/attention')

    await row(page, MISSED_TABLE, MISSED).getByRole('link', { name: MISSED, exact: true }).click()

    await expect(page).toHaveURL(new RegExp(`/workspace/deals/${dealIds[MISSED]}$`))
    await expect(page.getByRole('heading', { level: 1, name: MISSED })).toBeVisible()
  })

  test('?arr=over-50k keeps only ARR strictly above €50,000', async ({ page }) => {
    await signIn(page, 'A')
    await page.goto('/workspace/attention')

    await page.getByRole('link', { name: 'Only ARR over €50,000' }).click()

    await expect(page).toHaveURL(/\/workspace\/attention\?arr=over-50k$/)
    await expect(page.getByRole('main')).toContainText('Showing only deals with ARR over €50,000.')
    await expect(row(page, MISSED_TABLE, MISSED)).toHaveCount(1)
    await expect(row(page, NEXT_QUARTER_TABLE, NEXT_QUARTER)).toHaveCount(1)
    // Exactly €50,000, and below it: filtered out.
    await expect(page.getByRole('main')).not.toContainText(DUE_SOON)
    await expect(page.getByRole('main')).not.toContainText(NO_NOTICE)

    await page.getByRole('link', { name: 'Show all deals' }).click()
    await expect(page).toHaveURL(/\/workspace\/attention$/)
    await expect(row(page, DUE_SOON_TABLE, DUE_SOON)).toHaveCount(1)
  })

  test('treats an absent or unknown ARR filter value as off', async ({ page }) => {
    await signIn(page, 'A')

    for (const query of ['', '?arr=over-50K', '?arr=yes', '?arr=over-50k&arr=over-50k']) {
      await page.goto(`/workspace/attention${query}`)
      await expect(page.getByRole('link', { name: 'Only ARR over €50,000' })).toBeVisible()
      await expect(page.getByRole('main')).not.toContainText('Showing only deals with ARR over €50,000.')
      await expect(row(page, DUE_SOON_TABLE, DUE_SOON)).toHaveCount(1)
      await expect(row(page, CANNOT_COMPUTE_TABLE, NO_NOTICE)).toHaveCount(1)
    }
  })
})

test.describe('user B', () => {
  test("sees explicit empty states and none of user A's deals", async ({ page }) => {
    // Precondition: user B owns no deal with an upcoming renewal, so every
    // section must be empty. Fail loudly rather than test something else.
    const userB = await signInTestUser('B')
    try {
      const { data, error } = await userB.client.from('deals').select('id').gte('renewal_date', TODAY)
      if (error) throw new Error(`E2E precondition read failed (${error.code}).`)
      expect(data, 'user B must own no deal with an upcoming renewal').toEqual([])
    } finally {
      await signOutTestUser(userB)
    }

    await signIn(page, 'B')
    await page.goto('/workspace/attention')

    await expect(page.getByRole('region', { name: 'Notice deadlines' })).toContainText(
      'No notice deadline has been missed.',
    )
    await expect(page.getByRole('region', { name: 'Notice deadlines' })).toContainText(
      'No notice deadline is due in the next 30 days.',
    )
    await expect(page.getByRole('region', { name: 'Renewing next quarter' })).toContainText(
      'No deal renews next quarter.',
    )
    await expect(page.getByRole('region', { name: 'Cannot compute' })).toContainText(
      'No upcoming renewal is missing its notice period.',
    )
    await expect(page.getByRole('table')).toHaveCount(0)
    await expect(page.getByRole('main')).not.toContainText(RUN_PREFIX)
  })
})
