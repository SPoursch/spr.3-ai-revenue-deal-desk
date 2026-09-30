import { randomUUID } from 'node:crypto'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { requireTestEnv } from '../support/env'
import {
  signInTestUser,
  signOutTestUser,
  type SignedInTestUser,
} from '../support/supabase-clients'

/**
 * Rules → Exceptions → Decisions V1 (deterministic, no AI).
 *
 * "Check deal" runs the fixed, versioned rules (app/lib/deal-desk/rules.ts)
 * over one deal and stores an exception for each rule that holds:
 * discount > 20 %, liability cap < 12 months of fees, payment terms > Net 30,
 * and a renewal priced below its predecessor. A rule raises at most one live
 * exception, and never again for the same rule version once it was decided or
 * dismissed. A human then records a Decision on an exception, which closes it
 * as decided (or dismissed, for "dismiss as false positive") through the
 * database trigger. The AI plays no part.
 *
 * Routes: the deal page's "Exceptions" section (with "Check deal"), and
 * /workspace/deals/[dealId]/exceptions/[exceptionId] (details, evidence,
 * current check, Decision history, "Record decision"). Another user's deal or
 * exception renders a not-found page.
 *
 * Server-controlled, never taken from a form: the deal, every exception
 * field (rule, version, kind, severity, title, why, origin, status, finding,
 * provision), and a Decision's deal, exception and considered finding (null).
 *
 * Fixtures are set up directly as each test user under RLS; exceptions and
 * Decisions are created through the UI. `afterAll` deletes every E2E account
 * of both users, which cascades to everything, and signs out.
 */

const E2E_PREFIX = 'E2E '
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const RUN_PREFIX = `${E2E_PREFIX}${RUN_ID}`

const LIABILITY_EXCERPT = 'Liability is capped at six months of fees.'

type DealFields = {
  deal_type?: 'new_business' | 'renewal'
  arr_eur?: number
  discount_pct?: number | null
  predecessor_deal_id?: string
}
type Fixture = { accountId: string; dealId: string; dealName: string }

let userA: SignedInTestUser
let userB: SignedInTestUser
const fixtures = {} as Record<'breaching' | 'compliant' | 'renewal' | 'dealB', Fixture>
let liabilityProvisionId = ''
let paymentProvisionId = ''

async function createAccount(user: SignedInTestUser, label: string): Promise<string> {
  const account = await user.client
    .from('accounts')
    .insert({ name: `${RUN_PREFIX} ${label} Account` })
    .select('id')
    .single()
  if (account.error) throw new Error(`E2E setup: account insert failed (${account.error.code}).`)
  return account.data.id
}

async function createDeal(
  user: SignedInTestUser,
  accountId: string,
  label: string,
  fields: DealFields,
): Promise<Fixture> {
  const dealName = `${RUN_PREFIX} ${label} Deal`
  const deal = await user.client
    .from('deals')
    .insert({
      account_id: accountId,
      name: dealName,
      deal_type: fields.deal_type ?? 'new_business',
      stage: 'negotiation',
      arr_eur: fields.arr_eur ?? 60000,
      discount_pct: fields.discount_pct ?? null,
      predecessor_deal_id: fields.predecessor_deal_id ?? null,
    })
    .select('id')
    .single()
  if (deal.error) throw new Error(`E2E setup: deal insert failed (${deal.error.code}).`)
  return { accountId, dealId: deal.data.id, dealName }
}

async function createProvision(
  user: SignedInTestUser,
  dealId: string,
  fields: {
    provision_type: 'liability_cap' | 'payment_terms'
    value_text: string
    value_numeric: number
    value_unit: 'months_of_fees' | 'days'
  },
): Promise<string> {
  const provision = await user.client
    .from('provisions')
    .insert({ deal_id: dealId, source: 'human_entered', ...fields })
    .select('id')
    .single()
  if (provision.error) throw new Error(`E2E setup: provision insert failed (${provision.error.code}).`)
  return provision.data.id
}

/** Cites one pasted excerpt in support of a provision, as Provisions V1 stores it. */
async function citeExcerpt(user: SignedInTestUser, dealId: string, provisionId: string, text: string) {
  const item = await user.client
    .from('evidence_items')
    .insert({
      deal_id: dealId,
      evidence_type: 'msa',
      title: `${RUN_PREFIX} Master agreement`,
      source_kind: 'pasted',
      body_text: text,
    })
    .select('id')
    .single()
  if (item.error) throw new Error(`E2E setup: evidence insert failed (${item.error.code}).`)
  const excerpt = await user.client
    .from('evidence_excerpts')
    .insert({
      evidence_item_id: item.data.id,
      deal_id: dealId,
      ordinal: 0,
      start_offset: 0,
      end_offset: text.length,
      content: text,
    })
    .select('id')
    .single()
  if (excerpt.error) throw new Error(`E2E setup: excerpt insert failed (${excerpt.error.code}).`)
  const link = await user.client
    .from('provision_excerpts')
    .insert({ provision_id: provisionId, excerpt_id: excerpt.data.id, deal_id: dealId })
  if (link.error) throw new Error(`E2E setup: citation insert failed (${link.error.code}).`)
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

/** The value (`dd`) next to one term (`dt`) inside a details region. */
function detailValue(page: Page, region: Locator, term: string): Locator {
  return region
    .locator('div')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${term}$`) }) })
    .locator('dd')
}

/** Clicks a submit button and waits for the Server Action to answer. */
async function submit(page: Page, button: Locator) {
  const answered = page.waitForResponse((response) => response.request().method() === 'POST')
  await button.click()
  await answered
}

/** Waits until React has hydrated the page's forms, so DOM tampering sticks. */
async function waitForHydration(page: Page) {
  await page.waitForFunction(() => {
    const form = document.querySelector('main form')
    return form !== null && Object.keys(form).some((key) => key.startsWith('__reactFiber'))
  })
}

/** Rewrites every form input in `main` whose value is `from` to `to`, and adds `extra` fields. */
async function tamper(page: Page, from: string | null, to: string | null, extra: Record<string, string> = {}) {
  await waitForHydration(page)
  await page.locator('main').evaluate(
    (main, { from, to, extra }) => {
      if (from !== null && to !== null) {
        for (const input of Array.from(main.querySelectorAll('form input'))) {
          if ((input as HTMLInputElement).value === from) (input as HTMLInputElement).value = to
        }
      }
      for (const form of Array.from(main.querySelectorAll('form'))) {
        for (const [name, value] of Object.entries(extra)) {
          const input = document.createElement('input')
          input.type = 'hidden'
          input.name = name
          input.value = value
          form.appendChild(input)
        }
      }
    },
    { from, to, extra },
  )
}

const EXCEPTION_COLUMNS =
  'id, deal_id, rule_key, rule_version, kind, severity, title, why, origin, source_finding_id, provision_id, status'

async function exceptionsOf(user: SignedInTestUser, dealId: string) {
  const { data, error } = await user.client
    .from('exceptions')
    .select(EXCEPTION_COLUMNS)
    .eq('deal_id', dealId)
  if (error) throw new Error(`E2E read of exceptions failed (${error.code}).`)
  return data
}

async function exceptionFor(user: SignedInTestUser, dealId: string, ruleKey: string) {
  const rows = (await exceptionsOf(user, dealId)).filter((e) => e.rule_key === ruleKey)
  expect(rows, `exactly one ${ruleKey} exception`).toHaveLength(1)
  return rows[0]
}

async function decisionsOf(user: SignedInTestUser, exceptionId: string) {
  const { data, error } = await user.client
    .from('decisions')
    .select('id, deal_id, exception_id, decision_type, rationale, conditions, considered_finding_id')
    .eq('exception_id', exceptionId)
  if (error) throw new Error(`E2E read of decisions failed (${error.code}).`)
  return data
}

async function checkDeal(page: Page, dealId: string) {
  await page.goto(`/workspace/deals/${dealId}`)
  const exceptions = page.getByRole('region', { name: 'Exceptions' })
  await submit(page, exceptions.getByRole('button', { name: 'Check deal' }))
  return exceptions
}

function exceptionPath(dealId: string, exceptionId: string) {
  return `/workspace/deals/${dealId}/exceptions/${exceptionId}`
}

test.beforeAll(async () => {
  userA = await signInTestUser('A')
  userB = await signInTestUser('B')

  const accountA = await createAccount(userA, 'Rules')
  // Breaks three rules: discount 25 %, liability cap 6 months, Net 45.
  fixtures.breaching = await createDeal(userA, accountA, 'Breaching', { discount_pct: 25 })
  liabilityProvisionId = await createProvision(userA, fixtures.breaching.dealId, {
    provision_type: 'liability_cap',
    value_text: '6 months of fees',
    value_numeric: 6,
    value_unit: 'months_of_fees',
  })
  paymentProvisionId = await createProvision(userA, fixtures.breaching.dealId, {
    provision_type: 'payment_terms',
    value_text: 'Net 45',
    value_numeric: 45,
    value_unit: 'days',
  })
  await citeExcerpt(userA, fixtures.breaching.dealId, liabilityProvisionId, LIABILITY_EXCERPT)

  // Exactly at every threshold, so compliant.
  fixtures.compliant = await createDeal(userA, accountA, 'Compliant', { discount_pct: 20 })
  await createProvision(userA, fixtures.compliant.dealId, {
    provision_type: 'liability_cap',
    value_text: '12 months of fees',
    value_numeric: 12,
    value_unit: 'months_of_fees',
  })
  await createProvision(userA, fixtures.compliant.dealId, {
    provision_type: 'payment_terms',
    value_text: 'Net 30',
    value_numeric: 30,
    value_unit: 'days',
  })

  // A renewal of the breaching deal, cheaper than it.
  fixtures.renewal = await createDeal(userA, accountA, 'Renewal', {
    deal_type: 'renewal',
    arr_eur: 50000,
    predecessor_deal_id: fixtures.breaching.dealId,
  })

  const accountB = await createAccount(userB, 'Rules B')
  fixtures.dealB = await createDeal(userB, accountB, 'Rules B', { discount_pct: 30 })
})

test.afterAll(async () => {
  const errors: string[] = []
  for (const user of [userA, userB]) {
    if (!user) continue
    const { error } = await user.client.from('accounts').delete().like('name', `${E2E_PREFIX}%`)
    if (error) errors.push(`user ${user.label} (${error.code})`)
    try {
      await signOutTestUser(user)
    } catch {
      errors.push(`user ${user.label} sign-out`)
    }
  }
  if (errors.length > 0) throw new Error(`E2E cleanup failed: ${errors.join(', ')}.`)
})

test.describe('signed-out visitor', () => {
  test('is sent to /login from /workspace/deals/[id]/exceptions/[id]', async ({ page }) => {
    await page.goto(exceptionPath(randomUUID(), randomUUID()))
    await expect(page).toHaveURL(/\/login$/)
  })
})

test.describe.serial('rules, exceptions and decisions', () => {
  test('a deal that has not been checked shows no exceptions and offers "Check deal"', async ({
    page,
  }) => {
    await signIn(page, 'A')
    await page.goto(`/workspace/deals/${fixtures.breaching.dealId}`)

    const exceptions = page.getByRole('region', { name: 'Exceptions' })
    await expect(exceptions).toContainText('No exceptions')
    await expect(exceptions.getByRole('button', { name: 'Check deal' })).toBeVisible()
  })

  test('"Check deal" raises one open, deterministic exception per rule that holds', async ({
    page,
  }) => {
    const { dealId } = fixtures.breaching
    await signIn(page, 'A')

    const exceptions = await checkDeal(page, dealId)
    await expect(exceptions.getByRole('status')).toContainText('3 raised')

    const stored = await exceptionsOf(userA, dealId)
    expect(stored.map((e) => e.rule_key).sort()).toEqual(
      ['discount_above_20_pct', 'liability_cap_below_12_months', 'payment_terms_over_net_30'].sort(),
    )
    for (const exception of stored) {
      expect(exception).toMatchObject({
        rule_version: '1',
        origin: 'deterministic',
        status: 'open',
        source_finding_id: null,
      })
    }
    expect(stored.find((e) => e.rule_key === 'discount_above_20_pct')).toMatchObject({
      kind: 'threshold_breach',
      severity: 'medium',
      provision_id: null,
    })
    expect(stored.find((e) => e.rule_key === 'liability_cap_below_12_months')).toMatchObject({
      kind: 'non_standard_provision',
      severity: 'high',
      provision_id: liabilityProvisionId,
    })
    expect(stored.find((e) => e.rule_key === 'payment_terms_over_net_30')).toMatchObject({
      kind: 'non_standard_provision',
      severity: 'medium',
      provision_id: paymentProvisionId,
    })

    // The deal page lists them, each linking to its page.
    await page.reload()
    const list = page.getByRole('region', { name: 'Exceptions' }).getByRole('listitem')
    await expect(list).toHaveCount(3)
    for (const exception of stored) {
      await expect(list.filter({ hasText: exception.title })).toContainText('Open')
    }
  })

  test('checking again raises nothing new', async ({ page }) => {
    const { dealId } = fixtures.breaching
    const before = await exceptionsOf(userA, dealId)
    await signIn(page, 'A')

    const exceptions = await checkDeal(page, dealId)
    await expect(exceptions.getByRole('status')).toContainText('0 raised')
    await expect(exceptions.getByRole('status')).toContainText('3 already raised')

    expect((await exceptionsOf(userA, dealId)).map((e) => e.id).sort()).toEqual(
      before.map((e) => e.id).sort(),
    )
  })

  test('an exception page shows the rule, why, current check and the cited evidence', async ({
    page,
  }) => {
    const { dealId } = fixtures.breaching
    const liability = await exceptionFor(userA, dealId, 'liability_cap_below_12_months')
    await signIn(page, 'A')

    await page.goto(exceptionPath(dealId, liability.id))
    await expect(page.getByRole('heading', { level: 1, name: liability.title })).toBeVisible()

    const details = page.getByRole('region', { name: 'Exception details' })
    await expect(detailValue(page, details, 'Rule')).toContainText('liability_cap_below_12_months')
    await expect(detailValue(page, details, 'Severity')).toHaveText('High')
    await expect(detailValue(page, details, 'Status')).toHaveText('Open')
    await expect(detailValue(page, details, 'Current check')).toHaveText('Still applies')
    await expect(page.getByRole('main')).toContainText(liability.why)

    const evidence = page.getByRole('region', { name: 'Evidence' })
    await expect(evidence).toContainText('Liability cap')
    await expect(evidence).toContainText('6 months of fees')
    await expect(evidence).toContainText(LIABILITY_EXCERPT)
  })

  test('a deal exactly at every threshold raises no exception', async ({ page }) => {
    const { dealId } = fixtures.compliant
    await signIn(page, 'A')

    const exceptions = await checkDeal(page, dealId)
    await expect(exceptions.getByRole('status')).toContainText('0 raised')
    expect(await exceptionsOf(userA, dealId)).toEqual([])
    await page.reload()
    await expect(page.getByRole('region', { name: 'Exceptions' })).toContainText('No exceptions')
  })

  test('a renewal priced below its predecessor raises the renewal price rule', async ({ page }) => {
    const { dealId } = fixtures.renewal
    await signIn(page, 'A')

    await checkDeal(page, dealId)
    const stored = await exceptionsOf(userA, dealId)
    expect(stored.map((e) => e.rule_key)).toEqual(['renewal_price_decrease'])
    expect(stored[0]).toMatchObject({
      kind: 'commercial_risk',
      severity: 'high',
      status: 'open',
      provision_id: null,
    })
  })

  test('recording a Decision closes the exception as decided, and conditions are required to approve with conditions', async ({
    page,
  }) => {
    const { dealId } = fixtures.breaching
    const liability = await exceptionFor(userA, dealId, 'liability_cap_below_12_months')
    await signIn(page, 'A')

    await page.goto(exceptionPath(dealId, liability.id))
    const form = page.getByRole('region', { name: 'Record decision' })
    await form.getByLabel('Decision').selectOption('approve_with_conditions')
    await form.getByLabel('Rationale').fill('Strategic account; cap accepted for one term.')
    await submit(page, form.getByRole('button', { name: 'Record decision' }))
    await expect(page.getByRole('main').getByRole('alert')).toContainText(/check the highlighted fields/i)
    expect(await decisionsOf(userA, liability.id)).toEqual([])

    await form.getByLabel('Decision').selectOption('approve_with_conditions')
    await form.getByLabel('Rationale').fill('Strategic account; cap accepted for one term.')
    await form.getByLabel('Conditions').fill('Revisit the cap at renewal.')
    await submit(page, form.getByRole('button', { name: 'Record decision' }))

    const details = page.getByRole('region', { name: 'Exception details' })
    await expect(detailValue(page, details, 'Status')).toHaveText('Decided')
    const history = page.getByRole('region', { name: 'Decisions' }).getByRole('listitem')
    await expect(history).toHaveCount(1)
    await expect(history.first()).toContainText('Approve with conditions')
    await expect(history.first()).toContainText('Strategic account; cap accepted for one term.')
    await expect(history.first()).toContainText('Revisit the cap at renewal.')
    // A closed exception takes no further Decision in V1.
    await expect(page.getByRole('region', { name: 'Record decision' })).toHaveCount(0)

    expect(await decisionsOf(userA, liability.id)).toEqual([
      expect.objectContaining({
        deal_id: dealId,
        exception_id: liability.id,
        decision_type: 'approve_with_conditions',
        rationale: 'Strategic account; cap accepted for one term.',
        conditions: 'Revisit the cap at renewal.',
        considered_finding_id: null,
      }),
    ])
    expect((await exceptionFor(userA, dealId, 'liability_cap_below_12_months')).status).toBe('decided')
  })

  test('dismissing as a false positive closes it as dismissed; smuggled fields are ignored', async ({
    page,
  }) => {
    const { dealId } = fixtures.breaching
    const payment = await exceptionFor(userA, dealId, 'payment_terms_over_net_30')
    await signIn(page, 'A')

    await page.goto(exceptionPath(dealId, payment.id))
    const form = page.getByRole('region', { name: 'Record decision' })
    await form.getByLabel('Decision').selectOption('dismiss_false_positive')
    await form.getByLabel('Rationale').fill('Net 45 was agreed with finance.')
    await tamper(page, null, null, {
      considered_finding_id: randomUUID(),
      deal_id: fixtures.dealB.dealId,
      dealId: fixtures.dealB.dealId,
      status: 'open',
      severity: 'low',
      kind: 'timing_risk',
    })
    await submit(page, form.getByRole('button', { name: 'Record decision' }))

    await expect(
      detailValue(page, page.getByRole('region', { name: 'Exception details' }), 'Status'),
    ).toHaveText('Dismissed')

    expect(await decisionsOf(userA, payment.id)).toEqual([
      expect.objectContaining({
        deal_id: dealId,
        decision_type: 'dismiss_false_positive',
        considered_finding_id: null,
      }),
    ])
    // The exception itself is exactly as raised, apart from its status.
    expect(await exceptionFor(userA, dealId, 'payment_terms_over_net_30')).toEqual({
      ...payment,
      status: 'dismissed',
    })
  })

  test('checking again does not re-raise a decided or dismissed exception of the same rule version', async ({
    page,
  }) => {
    const { dealId } = fixtures.breaching
    await signIn(page, 'A')

    const exceptions = await checkDeal(page, dealId)
    await expect(exceptions.getByRole('status')).toContainText('0 raised')

    const stored = await exceptionsOf(userA, dealId)
    expect(stored).toHaveLength(3)
    expect(Object.fromEntries(stored.map((e) => [e.rule_key, e.status]))).toEqual({
      discount_above_20_pct: 'open',
      liability_cap_below_12_months: 'decided',
      payment_terms_over_net_30: 'dismissed',
    })
  })

  test('the current check says when a rule no longer applies or cannot be checked, without closing the exception', async ({
    page,
  }) => {
    const { dealId } = fixtures.breaching
    const discount = await exceptionFor(userA, dealId, 'discount_above_20_pct')
    await signIn(page, 'A')

    const setDiscount = async (discount_pct: number | null) => {
      const { error } = await userA.client.from('deals').update({ discount_pct }).eq('id', dealId)
      if (error) throw new Error(`E2E update of deal failed (${error.code}).`)
    }

    await setDiscount(10)
    await page.goto(exceptionPath(dealId, discount.id))
    const details = page.getByRole('region', { name: 'Exception details' })
    await expect(detailValue(page, details, 'Current check')).toHaveText('No longer applies')
    await expect(detailValue(page, details, 'Status')).toHaveText('Open')

    await setDiscount(null)
    await page.reload()
    await expect(detailValue(page, details, 'Current check')).toHaveText('Cannot be checked')

    // Only a Decision closes an exception.
    expect((await exceptionFor(userA, dealId, 'discount_above_20_pct')).status).toBe('open')
    expect(await decisionsOf(userA, discount.id)).toEqual([])
  })

  test("user B cannot open user A's exceptions", async ({ page }) => {
    const { dealId, dealName } = fixtures.breaching
    const discount = await exceptionFor(userA, dealId, 'discount_above_20_pct')
    await signIn(page, 'B')

    for (const path of [
      exceptionPath(dealId, discount.id),
      // A's exception under B's own deal.
      exceptionPath(fixtures.dealB.dealId, discount.id),
    ]) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: /not found/i })).toBeVisible()
      await expect(page.getByText(discount.title)).toHaveCount(0)
      await expect(page.getByText(dealName)).toHaveCount(0)
    }

    // Nor read it directly under RLS.
    const { data, error } = await userB.client.from('exceptions').select('id').eq('id', discount.id)
    if (error) throw new Error(`E2E read failed (${error.code}).`)
    expect(data).toEqual([])
  })

  test("user B cannot record a Decision on user A's exception", async ({ page }) => {
    const aDiscount = await exceptionFor(userA, fixtures.breaching.dealId, 'discount_above_20_pct')
    await signIn(page, 'B')

    // B's own deal breaks the discount rule, so B has an exception to decide.
    await checkDeal(page, fixtures.dealB.dealId)
    const bDiscount = await exceptionFor(userB, fixtures.dealB.dealId, 'discount_above_20_pct')

    await page.goto(exceptionPath(fixtures.dealB.dealId, bDiscount.id))
    const form = page.getByRole('region', { name: 'Record decision' })
    await form.getByLabel('Decision').selectOption('approve')
    await form.getByLabel('Rationale').fill('Attempt on another user exception')
    await tamper(page, bDiscount.id, aDiscount.id)
    await submit(page, form.getByRole('button', { name: 'Record decision' }))

    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      /no longer exists, or it is not one of yours/i,
    )
    // A's exception is untouched, and B's own was not decided either.
    expect(await exceptionFor(userA, fixtures.breaching.dealId, 'discount_above_20_pct')).toEqual(aDiscount)
    expect(await decisionsOf(userA, aDiscount.id)).toEqual([])
    expect((await exceptionFor(userB, fixtures.dealB.dealId, 'discount_above_20_pct')).status).toBe('open')
  })

  test("user B cannot run a check on user A's deal", async ({ page }) => {
    const before = await exceptionsOf(userA, fixtures.compliant.dealId)
    await signIn(page, 'B')

    await page.goto(`/workspace/deals/${fixtures.dealB.dealId}`)
    const exceptions = page.getByRole('region', { name: 'Exceptions' })
    await tamper(page, fixtures.dealB.dealId, fixtures.compliant.dealId, {
      rule_key: 'discount_above_20_pct',
      severity: 'high',
    })
    await submit(page, exceptions.getByRole('button', { name: 'Check deal' }))

    await expect(exceptions.getByRole('alert')).toContainText(
      /no longer exists, or it is not one of yours/i,
    )
    expect(await exceptionsOf(userA, fixtures.compliant.dealId)).toEqual(before)
  })
})
