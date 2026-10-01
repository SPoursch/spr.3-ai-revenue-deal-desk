import { expect, test, type Locator, type Page } from '@playwright/test'

import { requireTestEnv } from '../support/env'
import {
  signInTestUser,
  signOutTestUser,
  type SignedInTestUser,
} from '../support/supabase-clients'

/**
 * Feature 5: Exception / Context V1 on the exception page.
 *
 * Above the existing sections and the Decision form, the page shows five
 * Context sections for the exception, all derived from stored data and never
 * stored:
 *   Facts used       the facts the rule declared it read
 *   Deal context     type, stage, ARR, renewal date; for a renewal, the
 *                    predecessor and its reading of the same fact
 *   Account context  region, country, segment, industry
 *   Policy           the rule's policy statement and version
 *   Precedent        the newest Decisions on the same rule for this account's
 *                    deals, never this exception's own
 * A missing value reads "Not set". The existing flow — current check,
 * Decisions, Record decision — is unchanged.
 *
 * Fixtures are set up directly as user A under RLS: one account with three
 * deals (a predecessor, its renewal, and a sister deal). Exceptions and
 * Decisions are created through the UI. `afterAll` deletes every E2E account
 * of user A, which cascades to everything, and signs out.
 */

const E2E_PREFIX = 'E2E '
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const RUN_PREFIX = `${E2E_PREFIX}${RUN_ID}`

const SISTER_RATIONALE = 'Approved on the sister deal for a strategic launch.'
const RENEWAL_RATIONALE = 'Accepted for the renewal after review.'

type Fixture = { dealId: string; dealName: string }

let userA: SignedInTestUser
const fixtures = {} as Record<'predecessor' | 'renewal' | 'sister', Fixture>

async function createDeal(
  accountId: string,
  label: string,
  fields: {
    deal_type: 'new_business' | 'renewal'
    arr_eur: number
    discount_pct: number
    predecessor_deal_id?: string
  },
): Promise<Fixture> {
  const dealName = `${RUN_PREFIX} ${label} Deal`
  const deal = await userA.client
    .from('deals')
    .insert({
      account_id: accountId,
      name: dealName,
      stage: 'negotiation',
      renewal_date: null,
      predecessor_deal_id: fields.predecessor_deal_id ?? null,
      deal_type: fields.deal_type,
      arr_eur: fields.arr_eur,
      discount_pct: fields.discount_pct,
    })
    .select('id')
    .single()
  if (deal.error) throw new Error(`E2E setup: deal insert failed (${deal.error.code}).`)
  return { dealId: deal.data.id, dealName }
}

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(requireTestEnv('DEAL_DESK_TEST_USER_A_EMAIL'))
  await page.getByLabel('Password').fill(requireTestEnv('DEAL_DESK_TEST_USER_A_PASSWORD'))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  // This spec signs in first, with no signed-out visit before it, so on a
  // fresh dev server the redirect also waits for /workspace to compile.
  await expect(page).toHaveURL(/\/workspace$/, { timeout: 30_000 })
}

/** The value (`dd`) next to one term (`dt`) inside a region. */
function detailValue(page: Page, region: Locator, term: string): Locator {
  return region
    .locator('div')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${term}$`) }) })
    .locator('dd')
}

async function submit(page: Page, button: Locator) {
  const answered = page.waitForResponse((response) => response.request().method() === 'POST')
  await button.click()
  await answered
}

/** Runs "Check deal" and waits for its summary, so the response is complete. */
async function checkDeal(page: Page, dealId: string) {
  await page.goto(`/workspace/deals/${dealId}`)
  const exceptions = page.getByRole('region', { name: 'Exceptions' })
  await submit(page, exceptions.getByRole('button', { name: 'Check deal' }))
  await expect(exceptions.getByRole('status')).toContainText('raised')
}

async function discountExceptionOf(dealId: string) {
  const { data, error } = await userA.client
    .from('exceptions')
    .select('id, title, status')
    .eq('deal_id', dealId)
    .eq('rule_key', 'discount_above_20_pct')
  if (error) throw new Error(`E2E read of exceptions failed (${error.code}).`)
  expect(data, 'exactly one discount exception').toHaveLength(1)
  return data[0]
}

function exceptionPath(dealId: string, exceptionId: string) {
  return `/workspace/deals/${dealId}/exceptions/${exceptionId}`
}

async function recordDecision(page: Page, decision: string, rationale: string) {
  const form = page.getByRole('region', { name: 'Record decision' })
  await form.getByLabel('Decision').selectOption(decision)
  await form.getByLabel('Rationale').fill(rationale)
  await submit(page, form.getByRole('button', { name: 'Record decision' }))
}

test.beforeAll(async () => {
  userA = await signInTestUser('A')

  // An account with a region, country and segment but no industry.
  const account = await userA.client
    .from('accounts')
    .insert({
      name: `${RUN_PREFIX} Context Account`,
      region: 'EMEA',
      country_code: 'DE',
      segment: 'Enterprise',
    })
    .select('id')
    .single()
  if (account.error) throw new Error(`E2E setup: account insert failed (${account.error.code}).`)

  fixtures.predecessor = await createDeal(account.data.id, 'Predecessor', {
    deal_type: 'new_business',
    arr_eur: 70000,
    discount_pct: 30,
  })
  fixtures.renewal = await createDeal(account.data.id, 'Renewal', {
    deal_type: 'renewal',
    arr_eur: 60000,
    discount_pct: 25,
    predecessor_deal_id: fixtures.predecessor.dealId,
  })
  fixtures.sister = await createDeal(account.data.id, 'Sister', {
    deal_type: 'new_business',
    arr_eur: 80000,
    discount_pct: 40,
  })
})

test.afterAll(async () => {
  if (!userA) return
  try {
    const { error } = await userA.client.from('accounts').delete().like('name', `${E2E_PREFIX}%`)
    if (error) throw new Error(`E2E cleanup failed (${error.code}).`)
  } finally {
    await signOutTestUser(userA)
  }
})

test.describe.serial('exception context', () => {
  test("a Decision on the sister deal's discount exception becomes precedent", async ({ page }) => {
    await signIn(page)

    await checkDeal(page, fixtures.sister.dealId)
    const sister = await discountExceptionOf(fixtures.sister.dealId)
    await page.goto(exceptionPath(fixtures.sister.dealId, sister.id))
    await recordDecision(page, 'approve', SISTER_RATIONALE)

    await expect(
      detailValue(page, page.getByRole('region', { name: 'Exception details' }), 'Status'),
    ).toHaveText('Decided')
  })

  test('the renewal exception page shows all five Context sections', async ({ page }) => {
    await signIn(page)

    await checkDeal(page, fixtures.renewal.dealId)
    const renewal = await discountExceptionOf(fixtures.renewal.dealId)
    await page.goto(exceptionPath(fixtures.renewal.dealId, renewal.id))

    // Facts used: the fact the discount rule read.
    const facts = page.getByRole('region', { name: 'Facts used' })
    await expect(detailValue(page, facts, 'Discount')).toHaveText('25%')

    // Deal context, with the predecessor and its reading of the same fact.
    const deal = page.getByRole('region', { name: 'Deal context' })
    await expect(detailValue(page, deal, 'Type')).toHaveText('Renewal')
    await expect(detailValue(page, deal, 'Stage')).toHaveText('Negotiation')
    await expect(detailValue(page, deal, 'ARR')).toHaveText('€60,000.00')
    await expect(detailValue(page, deal, 'Renewal date')).toHaveText('Not set')
    await expect(deal.getByRole('link', { name: fixtures.predecessor.dealName })).toHaveAttribute(
      'href',
      `/workspace/deals/${fixtures.predecessor.dealId}`,
    )
    await expect(deal).toContainText('30%')
    await expect(deal).not.toContainText(/unchanged/i)

    // Account context, with a missing value shown as "Not set".
    const account = page.getByRole('region', { name: 'Account context' })
    await expect(detailValue(page, account, 'Region')).toHaveText('EMEA')
    await expect(detailValue(page, account, 'Country')).toHaveText('DE')
    await expect(detailValue(page, account, 'Segment')).toHaveText('Enterprise')
    await expect(detailValue(page, account, 'Industry')).toHaveText('Not set')

    // Policy: the discount rule's statement, at the version it was raised under.
    const policy = page.getByRole('region', { name: 'Policy' })
    await expect(policy).toContainText('20%')
    await expect(policy).toContainText('version 1')

    // Precedent: the sister deal's Decision on the same rule, with its version.
    const precedent = page.getByRole('region', { name: 'Precedent' }).getByRole('listitem')
    await expect(precedent).toHaveCount(1)
    await expect(precedent.first()).toContainText(SISTER_RATIONALE)
    await expect(precedent.first()).toContainText('Approve')
    await expect(precedent.first()).toContainText(fixtures.sister.dealName)
    await expect(precedent.first()).toContainText('version 1')
  })

  test("the exception's own Decision is recorded as before and never repeated as precedent", async ({
    page,
  }) => {
    await signIn(page)
    const renewal = await discountExceptionOf(fixtures.renewal.dealId)

    await page.goto(exceptionPath(fixtures.renewal.dealId, renewal.id))
    await recordDecision(page, 'accept_risk', RENEWAL_RATIONALE)

    // The existing flow: decided, in its own history, and the form is gone.
    await expect(
      detailValue(page, page.getByRole('region', { name: 'Exception details' }), 'Status'),
    ).toHaveText('Decided')
    const history = page.getByRole('region', { name: 'Decisions' }).getByRole('listitem')
    await expect(history).toHaveCount(1)
    await expect(history.first()).toContainText(RENEWAL_RATIONALE)
    await expect(page.getByRole('region', { name: 'Record decision' })).toHaveCount(0)

    // Precedent still shows only the sister deal's Decision.
    const precedent = page.getByRole('region', { name: 'Precedent' })
    await expect(precedent.getByRole('listitem')).toHaveCount(1)
    await expect(precedent).toContainText(SISTER_RATIONALE)
    await expect(precedent).not.toContainText(RENEWAL_RATIONALE)
  })

  test("the sister deal's page shows the renewal's Decision as precedent in turn", async ({ page }) => {
    await signIn(page)
    const sister = await discountExceptionOf(fixtures.sister.dealId)

    await page.goto(exceptionPath(fixtures.sister.dealId, sister.id))
    const precedent = page.getByRole('region', { name: 'Precedent' })
    await expect(precedent).toContainText(RENEWAL_RATIONALE)
    await expect(precedent).toContainText(fixtures.renewal.dealName)
    await expect(precedent).not.toContainText(SISTER_RATIONALE)

    // A deal with no predecessor has no predecessor context.
    await expect(page.getByRole('region', { name: 'Deal context' })).not.toContainText(
      fixtures.predecessor.dealName,
    )
  })
})
