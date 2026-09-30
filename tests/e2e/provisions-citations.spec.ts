import { randomUUID } from 'node:crypto'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { splitIntoParagraphs } from '../../app/lib/deal-desk/excerpts'
import { requireTestEnv } from '../support/env'
import {
  signInTestUser,
  signOutTestUser,
  type SignedInTestUser,
} from '../support/supabase-clients'

/**
 * Contract / Document Intelligence V1: provisions and their citations.
 *
 * A provision is a confirmed commercial or legal term of a deal, entered by a
 * human (`source = 'human_entered'`), at most one per type per deal (C4). It
 * is supported by citations to excerpts of that deal's own evidence; one with
 * no citation is shown as Unsupported, never as an established fact.
 *
 * Routes (under the deal, whose id comes from the URL and is read as the
 * signed-in user):
 *   /workspace/deals/[dealId]/provisions/new
 *   /workspace/deals/[dealId]/provisions/[provisionId]          view, citations
 *   /workspace/deals/[dealId]/provisions/[provisionId]/edit     the value only
 *   /workspace/deals/[dealId]/provisions/[provisionId]/delete   confirmation
 * Another user's deal or provision renders a not-found page.
 *
 * Server-controlled, never taken from a form: the deal, `source`,
 * `source_finding_id` and `confirmed_at`. The value is trimmed, required and
 * at most 500 characters; a number needs a unit allowed for the type; one
 * request cites at most 20 excerpts, all of the provision's deal.
 *
 * Fixtures (accounts, deals and pasted evidence with paragraph excerpts) are
 * set up directly as each test user under RLS, as in evidence-excerpts.spec;
 * provisions are created through the UI. `afterAll` deletes every E2E
 * account of both users, which cascades to everything, and signs out.
 */

const E2E_PREFIX = 'E2E '
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const RUN_PREFIX = `${E2E_PREFIX}${RUN_ID}`

const MSA_TITLE = `${RUN_PREFIX} Master agreement`
const ORDER_FORM_TITLE = `${RUN_PREFIX} Order form`
const PRICING_TITLE = `${RUN_PREFIX} Pricing sheet`
const OTHER_TITLE = `${RUN_PREFIX} Other deal note`

const MSA_BODY = [
  'Liability is capped at twelve months of fees.',
  'Customer data is stored in the EU only.',
  'This agreement is governed by German law.',
].join('\n\n')

const ORDER_FORM_BODY = [
  'Fees are payable within 45 days of invoice.',
  'The order form renews automatically for 12 months.',
].join('\n\n')

/** 21 paragraphs: one more than a request may cite. */
const PRICING_BODY = Array.from({ length: 21 }, (_, i) => `Price line ${i + 1}.`).join('\n\n')

type Evidence = { itemId: string; title: string; excerpts: { id: string; content: string }[] }
type Fixture = { accountId: string; dealId: string; dealName: string }

let userA: SignedInTestUser
let userB: SignedInTestUser
const fixtures = {} as Record<'dealA' | 'otherDealA' | 'dealB', Fixture>
const evidence = {} as Record<'msa' | 'orderForm' | 'pricing' | 'other', Evidence>

async function createAccountWithDeal(user: SignedInTestUser, label: string): Promise<Fixture> {
  const dealName = `${RUN_PREFIX} ${label} Deal`
  const account = await user.client
    .from('accounts')
    .insert({ name: `${RUN_PREFIX} ${label} Account` })
    .select('id')
    .single()
  if (account.error) throw new Error(`E2E setup: account insert failed (${account.error.code}).`)
  const deal = await user.client
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
  return { accountId: account.data.id, dealId: deal.data.id, dealName }
}

/** Pasted evidence with one excerpt per paragraph, exactly as Slice 4 stores it. */
async function addEvidence(
  user: SignedInTestUser,
  dealId: string,
  title: string,
  body: string,
): Promise<Evidence> {
  const item = await user.client
    .from('evidence_items')
    .insert({ deal_id: dealId, evidence_type: 'msa', title, source_kind: 'pasted', body_text: body })
    .select('id')
    .single()
  if (item.error) throw new Error(`E2E setup: evidence insert failed (${item.error.code}).`)
  const excerpts = await user.client
    .from('evidence_excerpts')
    .insert(
      splitIntoParagraphs(body).map((excerpt) => ({
        ...excerpt,
        evidence_item_id: item.data.id,
        deal_id: dealId,
      })),
    )
    .select('id, ordinal, content')
    .order('ordinal', { ascending: true })
  if (excerpts.error) throw new Error(`E2E setup: excerpt insert failed (${excerpts.error.code}).`)
  return { itemId: item.data.id, title, excerpts: excerpts.data }
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

/** The checkbox for excerpt `n` (1-based) of one evidence item, inside `scope`. */
function excerptBox(scope: Locator, itemTitle: string, n: number): Locator {
  return scope
    .getByRole('group', { name: itemTitle, exact: true })
    .getByRole('checkbox', { name: new RegExp(`^Excerpt ${n}\\b`) })
}

/** Clicks a submit button and waits for the Server Action to answer. */
async function submit(page: Page, button: Locator) {
  const answered = page.waitForResponse((response) => response.request().method() === 'POST')
  await button.click()
  await answered
}

/**
 * Waits until React has hydrated the page's form. Tampering with the DOM
 * before that is undone when React regenerates a mismatched tree, so the
 * tampered submission would never be sent.
 */
async function waitForHydration(page: Page) {
  await page.waitForFunction(() => {
    const form = document.querySelector('main form')
    return form !== null && Object.keys(form).some((key) => key.startsWith('__reactFiber'))
  })
}

/** Appends hidden inputs to the page's form, as a tampered submission would. */
async function smuggle(page: Page, fields: Record<string, string>) {
  await waitForHydration(page)
  await page.locator('main form').first().evaluate((form, entries) => {
    for (const [name, value] of Object.entries(entries)) {
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = name
      input.value = value
      form.appendChild(input)
    }
  }, fields)
}

const PROVISION_COLUMNS =
  'id, deal_id, provision_type, value_text, value_numeric, value_unit, source, source_finding_id, confirmed_at'

async function readProvision(user: SignedInTestUser, id: string) {
  const { data, error } = await user.client
    .from('provisions')
    .select(PROVISION_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`E2E read of provision failed (${error.code}).`)
  return data
}

async function provisionsOf(user: SignedInTestUser, dealId: string) {
  const { data, error } = await user.client
    .from('provisions')
    .select(PROVISION_COLUMNS)
    .eq('deal_id', dealId)
  if (error) throw new Error(`E2E read of provisions failed (${error.code}).`)
  return data
}

async function citationsOf(user: SignedInTestUser, provisionId: string) {
  const { data, error } = await user.client
    .from('provision_excerpts')
    .select('excerpt_id, deal_id')
    .eq('provision_id', provisionId)
  if (error) throw new Error(`E2E read of citations failed (${error.code}).`)
  return data
}

function provisionIdFrom(page: Page): string {
  return new URL(page.url()).pathname.split('/').pop() ?? ''
}

test.beforeAll(async () => {
  userA = await signInTestUser('A')
  userB = await signInTestUser('B')
  fixtures.dealA = await createAccountWithDeal(userA, 'Provisions')
  fixtures.otherDealA = await createAccountWithDeal(userA, 'Other')
  fixtures.dealB = await createAccountWithDeal(userB, 'Provisions B')
  evidence.msa = await addEvidence(userA, fixtures.dealA.dealId, MSA_TITLE, MSA_BODY)
  evidence.orderForm = await addEvidence(userA, fixtures.dealA.dealId, ORDER_FORM_TITLE, ORDER_FORM_BODY)
  evidence.pricing = await addEvidence(userA, fixtures.dealA.dealId, PRICING_TITLE, PRICING_BODY)
  evidence.other = await addEvidence(userA, fixtures.otherDealA.dealId, OTHER_TITLE, 'Unrelated note.')
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
  const dealId = randomUUID()
  const provisionId = randomUUID()

  for (const suffix of ['new', provisionId, `${provisionId}/edit`, `${provisionId}/delete`]) {
    const path = `/workspace/deals/${dealId}/provisions/${suffix}`
    test(`is sent to /login from ${path.replaceAll(dealId, '[id]').replaceAll(provisionId, '[id]')}`, async ({
      page,
    }) => {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login$/)
    })
  }
})

test.describe.serial('provisions and citations', () => {
  let liabilityId = ''
  let lawId = ''
  let liabilityConfirmedAt = ''

  test('a deal with no provisions shows the empty state', async ({ page }) => {
    await signIn(page, 'A')
    await page.goto(`/workspace/deals/${fixtures.dealA.dealId}`)

    const provisions = page.getByRole('region', { name: 'Provisions' })
    await expect(provisions).toContainText('No provisions yet')
    await expect(provisions.getByRole('link', { name: 'Add provision' })).toBeVisible()
  })

  test('user A adds a provision with a value, a number and two citations', async ({ page }) => {
    const { dealId, dealName } = fixtures.dealA
    await signIn(page, 'A')

    await page.goto(`/workspace/deals/${dealId}`)
    await page
      .getByRole('region', { name: 'Provisions' })
      .getByRole('link', { name: 'Add provision' })
      .click()
    await expect(page).toHaveURL(new RegExp(`/workspace/deals/${dealId}/provisions/new$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Add provision' })).toBeVisible()
    await expect(page.getByRole('main')).toContainText(dealName)

    await page.getByLabel('Provision type').selectOption('liability_cap')
    await page.getByLabel('Value', { exact: true }).fill('  12 months of fees  ')
    await page.getByLabel('Numeric value', { exact: true }).fill('12')
    await page.getByLabel('Unit', { exact: true }).selectOption('months_of_fees')

    // The picker lists this deal's excerpts, grouped by evidence item.
    const picker = page.getByRole('region', { name: 'Supporting excerpts' })
    await expect(picker.getByRole('group', { name: OTHER_TITLE, exact: true })).toHaveCount(0)
    await excerptBox(picker, MSA_TITLE, 1).check()
    await excerptBox(picker, ORDER_FORM_TITLE, 2).check()
    await submit(page, page.getByRole('button', { name: 'Add provision' }))

    await expect(page).toHaveURL(
      new RegExp(`/workspace/deals/${dealId}/provisions/[0-9a-f-]{36}$`),
    )
    liabilityId = provisionIdFrom(page)

    // Stored on the deal in the URL, human-entered, with exactly those citations.
    const stored = await readProvision(userA, liabilityId)
    expect(stored).toMatchObject({
      deal_id: dealId,
      provision_type: 'liability_cap',
      value_text: '12 months of fees',
      value_numeric: 12,
      value_unit: 'months_of_fees',
      source: 'human_entered',
      source_finding_id: null,
    })
    liabilityConfirmedAt = stored!.confirmed_at
    const cited = await citationsOf(userA, liabilityId)
    expect(cited.map((c) => c.excerpt_id).sort()).toEqual(
      [evidence.msa.excerpts[0].id, evidence.orderForm.excerpts[1].id].sort(),
    )
    expect(cited.every((c) => c.deal_id === dealId)).toBe(true)

    // The provision page shows the value, its support and each cited excerpt.
    await expect(page.getByRole('heading', { level: 1, name: 'Liability cap' })).toBeVisible()
    const details = page.getByRole('region', { name: 'Provision details' })
    await expect(detailValue(page, details, 'Value')).toHaveText('12 months of fees')
    await expect(detailValue(page, details, 'Support')).toHaveText(/^Supported/)

    const citations = page.getByRole('region', { name: 'Citations', exact: true }).getByRole('listitem')
    await expect(citations).toHaveCount(2)
    const msaCitation = citations.filter({ hasText: evidence.msa.excerpts[0].content })
    await expect(msaCitation).toContainText(MSA_TITLE)
    await msaCitation.getByRole('link', { name: MSA_TITLE }).click()
    await expect(page).toHaveURL(
      new RegExp(`/workspace/deals/${dealId}/evidence/${evidence.msa.itemId}$`),
    )
  })

  test('the deal page lists it as supported, and its type cannot be added twice', async ({
    page,
  }) => {
    expect(liabilityId, 'the previous test must have added a provision').not.toBe('')
    const { dealId } = fixtures.dealA
    await signIn(page, 'A')

    await page.goto(`/workspace/deals/${dealId}`)
    const row = page
      .getByRole('region', { name: 'Provisions' })
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: 'Liability cap', exact: true }) })
    await expect(row).toContainText('12 months of fees')
    await expect(row).toContainText('Supported')
    await expect(row).not.toContainText('Unsupported')

    // The form no longer offers the type; a forced submission is refused clearly.
    await page.goto(`/workspace/deals/${dealId}/provisions/new`)
    const type = page.getByLabel('Provision type')
    await expect(type.locator('option[value="liability_cap"]')).toHaveCount(0)
    await waitForHydration(page)
    await type.evaluate((select: HTMLSelectElement) => {
      const option = document.createElement('option')
      option.value = 'liability_cap'
      option.textContent = 'Liability cap'
      select.appendChild(option)
      select.value = 'liability_cap'
    })
    await page.getByLabel('Value', { exact: true }).fill('24 months of fees')
    await submit(page, page.getByRole('button', { name: 'Add provision' }))

    await expect(page.getByRole('main').getByRole('alert')).toContainText(/already has a liability cap provision/i)
    const liabilityCaps = (await provisionsOf(userA, dealId)).filter(
      (p) => p.provision_type === 'liability_cap',
    )
    expect(liabilityCaps.map((p) => p.value_text)).toEqual(['12 months of fees'])
  })

  test('a provision without citations is shown as unsupported', async ({ page }) => {
    const { dealId } = fixtures.dealA
    await signIn(page, 'A')

    await page.goto(`/workspace/deals/${dealId}/provisions/new`)
    await page.getByLabel('Provision type').selectOption('governing_law')
    await page.getByLabel('Value', { exact: true }).fill('German law')
    await submit(page, page.getByRole('button', { name: 'Add provision' }))

    await expect(page).toHaveURL(new RegExp(`/workspace/deals/${dealId}/provisions/[0-9a-f-]{36}$`))
    lawId = provisionIdFrom(page)
    expect(await citationsOf(userA, lawId)).toEqual([])
    expect(await readProvision(userA, lawId)).toMatchObject({
      value_text: 'German law',
      value_numeric: null,
      value_unit: null,
    })

    const details = page.getByRole('region', { name: 'Provision details' })
    await expect(detailValue(page, details, 'Support')).toHaveText('Unsupported')

    await page.goto(`/workspace/deals/${dealId}`)
    await expect(
      page
        .getByRole('region', { name: 'Provisions' })
        .getByRole('listitem')
        .filter({ has: page.getByRole('link', { name: 'Governing law', exact: true }) }),
    ).toContainText('Unsupported')
  })

  test('an invalid value or a unit the type does not allow is refused, storing nothing', async ({
    page,
  }) => {
    const { dealId } = fixtures.dealA
    await signIn(page, 'A')

    // A discount measured in days.
    await page.goto(`/workspace/deals/${dealId}/provisions/new`)
    await page.getByLabel('Provision type').selectOption('discount')
    await page.getByLabel('Value', { exact: true }).fill('10 per cent')
    await page.getByLabel('Numeric value', { exact: true }).fill('10')
    await page.getByLabel('Unit', { exact: true }).selectOption('days')
    await submit(page, page.getByRole('button', { name: 'Add provision' }))
    await expect(page.getByRole('main').getByRole('alert')).toContainText(/check the highlighted fields/i)
    await expect(page).toHaveURL(new RegExp(`/workspace/deals/${dealId}/provisions/new$`))

    // A blank value.
    await page.goto(`/workspace/deals/${dealId}/provisions/new`)
    await page.getByLabel('Provision type').selectOption('discount')
    await page.getByLabel('Value', { exact: true }).fill('   ')
    await submit(page, page.getByRole('button', { name: 'Add provision' }))
    await expect(page.getByRole('main').getByRole('alert')).toContainText(/check the highlighted fields/i)

    expect(
      (await provisionsOf(userA, dealId)).filter((p) => p.provision_type === 'discount'),
    ).toEqual([])
  })

  test('one request may cite at most 20 excerpts', async ({ page }) => {
    const { dealId } = fixtures.dealA
    await signIn(page, 'A')

    await page.goto(`/workspace/deals/${dealId}/provisions/new`)
    await page.getByLabel('Provision type').selectOption('payment_terms')
    await page.getByLabel('Value', { exact: true }).fill('Net 45')
    const picker = page.getByRole('region', { name: 'Supporting excerpts' })
    for (let n = 1; n <= 21; n += 1) await excerptBox(picker, PRICING_TITLE, n).check()
    await submit(page, page.getByRole('button', { name: 'Add provision' }))

    await expect(page.getByRole('main').getByRole('alert')).toContainText(/check the highlighted fields/i)
    await expect(page.getByRole('main')).toContainText(/20 excerpts/)
    expect(
      (await provisionsOf(userA, dealId)).filter((p) => p.provision_type === 'payment_terms'),
    ).toEqual([])
  })

  test('editing changes the value only; confirmed_at and citations stay as they were', async ({
    page,
  }) => {
    expect(liabilityId, 'a provision must have been added').not.toBe('')
    const { dealId } = fixtures.dealA
    await signIn(page, 'A')

    await page.goto(`/workspace/deals/${dealId}/provisions/${liabilityId}`)
    await page.getByRole('link', { name: 'Edit provision' }).click()
    await expect(page).toHaveURL(
      new RegExp(`/workspace/deals/${dealId}/provisions/${liabilityId}/edit$`),
    )
    await expect(page.getByRole('heading', { level: 1, name: 'Edit provision' })).toBeVisible()
    await expect(page.getByLabel('Value', { exact: true })).toHaveValue('12 months of fees')

    await page.getByLabel('Value', { exact: true }).fill('6 months of fees')
    await page.getByLabel('Numeric value', { exact: true }).fill('6')
    await smuggle(page, {
      confirmed_at: '2000-01-01T00:00:00Z',
      confirmedAt: '2000-01-01T00:00:00Z',
      provision_type: 'discount',
      source: 'ai_confirmed',
    })
    await submit(page, page.getByRole('button', { name: 'Save changes' }))

    await expect(page).toHaveURL(new RegExp(`/workspace/deals/${dealId}/provisions/${liabilityId}$`))
    await expect(
      detailValue(page, page.getByRole('region', { name: 'Provision details' }), 'Value'),
    ).toHaveText('6 months of fees')

    expect(await readProvision(userA, liabilityId)).toMatchObject({
      provision_type: 'liability_cap',
      value_text: '6 months of fees',
      value_numeric: 6,
      value_unit: 'months_of_fees',
      source: 'human_entered',
      confirmed_at: liabilityConfirmedAt,
    })
    expect(await citationsOf(userA, liabilityId)).toHaveLength(2)
  })

  test('citations can be added to a provision and removed again', async ({ page }) => {
    expect(lawId, 'an unsupported provision must have been added').not.toBe('')
    const { dealId } = fixtures.dealA
    const lawExcerpt = evidence.msa.excerpts[2]
    await signIn(page, 'A')

    await page.goto(`/workspace/deals/${dealId}/provisions/${lawId}`)
    const adder = page.getByRole('region', { name: 'Add citations' })
    await excerptBox(adder, MSA_TITLE, 3).check()
    await submit(page, adder.getByRole('button', { name: 'Add citations' }))

    const citations = page.getByRole('region', { name: 'Citations', exact: true }).getByRole('listitem')
    await expect(citations).toHaveCount(1)
    await expect(citations.first()).toContainText(lawExcerpt.content)
    const details = page.getByRole('region', { name: 'Provision details' })
    await expect(detailValue(page, details, 'Support')).toHaveText(/^Supported/)
    expect((await citationsOf(userA, lawId)).map((c) => c.excerpt_id)).toEqual([lawExcerpt.id])

    await submit(page, citations.first().getByRole('button', { name: 'Remove citation' }))
    await expect(citations).toHaveCount(0)
    await expect(detailValue(page, details, 'Support')).toHaveText('Unsupported')
    expect(await citationsOf(userA, lawId)).toEqual([])
  })

  test('tampered source, finding, confirmation time and deal fields are ignored', async ({
    page,
  }) => {
    const { dealId } = fixtures.dealA
    const startedAt = Date.now()
    await signIn(page, 'A')

    await page.goto(`/workspace/deals/${dealId}/provisions/new`)
    await page.getByLabel('Provision type').selectOption('data_residency')
    await page.getByLabel('Value', { exact: true }).fill('EU only')
    await smuggle(page, {
      source: 'ai_confirmed',
      source_finding_id: randomUUID(),
      confirmed_at: '2000-01-01T00:00:00Z',
      deal_id: fixtures.dealB.dealId,
      user_id: userB.userId,
    })
    await submit(page, page.getByRole('button', { name: 'Add provision' }))

    await expect(page).toHaveURL(new RegExp(`/workspace/deals/${dealId}/provisions/[0-9a-f-]{36}$`))
    const stored = await readProvision(userA, provisionIdFrom(page))
    expect(stored).toMatchObject({
      deal_id: dealId,
      provision_type: 'data_residency',
      source: 'human_entered',
      source_finding_id: null,
    })
    expect(new Date(stored!.confirmed_at).getTime()).toBeGreaterThanOrEqual(startedAt - 60_000)
    expect(await provisionsOf(userB, fixtures.dealB.dealId)).toEqual([])
  })

  test("an excerpt of another deal cannot be cited, even by a tampered submission", async ({
    page,
  }) => {
    const { dealId } = fixtures.dealA
    const foreign = evidence.other.excerpts[0].id
    await signIn(page, 'A')

    await page.goto(`/workspace/deals/${dealId}/provisions/new`)
    await page.getByLabel('Provision type').selectOption('termination')
    await page.getByLabel('Value', { exact: true }).fill('90 days notice')
    const picker = page.getByRole('region', { name: 'Supporting excerpts' })
    await excerptBox(picker, ORDER_FORM_TITLE, 1).check()
    // Point every reference to that excerpt at deal A2's excerpt instead.
    const original = evidence.orderForm.excerpts[0].id
    await waitForHydration(page)
    await page.locator('main form').first().evaluate(
      (form, { from, to }) => {
        for (const input of Array.from(form.querySelectorAll('input'))) {
          if (input.value === from) input.value = to
        }
      },
      { from: original, to: foreign },
    )
    await submit(page, page.getByRole('button', { name: 'Add provision' }))

    // Whatever the outcome, no provision of deal A cites deal A2's excerpt.
    const { data, error } = await userA.client
      .from('provision_excerpts')
      .select('provision_id')
      .eq('excerpt_id', foreign)
    if (error) throw new Error(`E2E read failed (${error.code}).`)
    expect(data).toEqual([])
  })

  test('deleting asks for confirmation, then removes the provision but not the evidence', async ({
    page,
  }) => {
    expect(lawId, 'a provision must have been added').not.toBe('')
    const { dealId } = fixtures.dealA
    await signIn(page, 'A')

    await page.goto(`/workspace/deals/${dealId}/provisions/${lawId}`)
    await page.getByRole('link', { name: 'Delete provision' }).click()
    await expect(page).toHaveURL(
      new RegExp(`/workspace/deals/${dealId}/provisions/${lawId}/delete$`),
    )
    await expect(page.getByRole('heading', { level: 1, name: 'Delete provision' })).toBeVisible()
    const main = page.getByRole('main')
    await expect(main).toContainText('Governing law')
    await expect(main).toContainText(/cannot be undone/i)

    await page.getByRole('link', { name: 'Cancel' }).click()
    await expect(page).toHaveURL(new RegExp(`/workspace/deals/${dealId}/provisions/${lawId}$`))
    expect(await readProvision(userA, lawId)).not.toBeNull()

    await page.getByRole('link', { name: 'Delete provision' }).click()
    await submit(page, page.getByRole('button', { name: 'Delete provision' }))
    await expect(page).toHaveURL(new RegExp(`/workspace/deals/${dealId}$`))
    expect(await readProvision(userA, lawId)).toBeNull()

    // The evidence the provision could cite is untouched.
    const { data, error } = await userA.client
      .from('evidence_excerpts')
      .select('id')
      .eq('evidence_item_id', evidence.msa.itemId)
    if (error) throw new Error(`E2E read failed (${error.code}).`)
    expect(data).toHaveLength(evidence.msa.excerpts.length)
  })

  test("user B cannot open, edit, delete or add to user A's provisions", async ({ page }) => {
    expect(liabilityId, 'a provision must have been added').not.toBe('')
    const { dealId, dealName } = fixtures.dealA
    await signIn(page, 'B')

    for (const path of [
      `/workspace/deals/${dealId}/provisions/new`,
      `/workspace/deals/${dealId}/provisions/${liabilityId}`,
      `/workspace/deals/${dealId}/provisions/${liabilityId}/edit`,
      `/workspace/deals/${dealId}/provisions/${liabilityId}/delete`,
      // A's provision id under B's own deal.
      `/workspace/deals/${fixtures.dealB.dealId}/provisions/${liabilityId}`,
    ]) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: /not found/i })).toBeVisible()
      await expect(page.getByText(dealName)).toHaveCount(0)
      await expect(page.getByText('6 months of fees')).toHaveCount(0)
      await expect(page.getByText(evidence.msa.excerpts[0].content)).toHaveCount(0)
    }

    // Nor can B read it directly under RLS.
    expect(await readProvision(userB, liabilityId)).toBeNull()
    expect(await citationsOf(userB, liabilityId)).toEqual([])
  })

  test("user B cannot redirect a submission onto user A's deal", async ({ page }) => {
    const before = await provisionsOf(userA, fixtures.dealA.dealId)
    await signIn(page, 'B')

    await page.goto(`/workspace/deals/${fixtures.dealB.dealId}/provisions/new`)
    await expect(page.getByRole('heading', { level: 1, name: 'Add provision' })).toBeVisible()
    await page.getByLabel('Provision type').selectOption('discount')
    await page.getByLabel('Value', { exact: true }).fill('Attempt on another user deal')
    await waitForHydration(page)
    await page.locator('main form').first().evaluate(
      (form, { from, to }) => {
        for (const input of Array.from(form.querySelectorAll('input'))) {
          if (input.value === from) input.value = to
        }
      },
      { from: fixtures.dealB.dealId, to: fixtures.dealA.dealId },
    )
    await smuggle(page, { deal_id: fixtures.dealA.dealId, dealId: fixtures.dealA.dealId })
    await submit(page, page.getByRole('button', { name: 'Add provision' }))

    // Whatever B sees, nothing reached A's deal.
    expect(await provisionsOf(userA, fixtures.dealA.dealId)).toEqual(before)
  })
})
