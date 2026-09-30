import { randomUUID } from 'node:crypto'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { requireTestEnv } from '../support/env'
import {
  signInTestUser,
  signOutTestUser,
  type SignedInTestUser,
} from '../support/supabase-clients'

/**
 * Slice 4: evidence and excerpts, V1.
 *
 * Evidence is pasted text attached to a deal, with its provenance (type,
 * title, author, version, document date, executed). It is immutable and not
 * independently deletable (E3). When it is added, the application splits the
 * text into excerpts, one per paragraph: paragraphs are separated by one or
 * more blank (or whitespace-only) lines, each excerpt's content is its
 * paragraph without surrounding whitespace, and `body_text.slice(start_offset,
 * end_offset)` is exactly that content. Ordinals run 0..n-1 and no excerpt is
 * empty. A single line break does not split a paragraph.
 *
 * A browser submits a textarea's line breaks as CRLF, so every body stored
 * through the form has CRLF line endings; the offset checks below run against
 * the stored `body_text`, never against the literal typed here.
 *
 * Routes: /workspace/deals/[dealId]/evidence/new adds evidence to that deal;
 * /workspace/deals/[dealId]/evidence/[evidenceId] shows one item. The deal
 * comes from the URL and is read as the signed-in user, so another user's
 * deal or evidence renders a not-found page, as do evidence ids under the
 * wrong deal.
 *
 * Accounts and deals are set up directly as each test user (publishable key,
 * the user's own session, under RLS), as in deal-records-manage.spec.ts;
 * evidence is added through the UI. `afterAll` deletes every E2E account of
 * both users, which cascades to their deals and evidence, and signs out.
 */

const E2E_PREFIX = 'E2E '
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const RUN_PREFIX = `${E2E_PREFIX}${RUN_ID}`

const MSA_TITLE = `${RUN_PREFIX} Order form 2027`
const NOTE_TITLE = `${RUN_PREFIX} Call note residency`
const TAMPER_A_TITLE = `${RUN_PREFIX} Tampered by A`
const TAMPER_B_TITLE = `${RUN_PREFIX} Tampered by B`
const ORPHAN_TITLE = `${RUN_PREFIX} Excerpts failed`

/**
 * Three paragraphs, with every case the splitter must handle: leading and
 * trailing whitespace on the body and on lines, a line break inside a
 * paragraph, several blank lines in a row and a whitespace-only line between
 * paragraphs.
 */
const MULTI_PARAGRAPH_BODY = [
  '  ',
  '1. Term. The subscription term is 12 months.',
  '',
  '2. Fees. Fees are EUR 60,000 per year,',
  'payable annually in advance.',
  '',
  '',
  '   ',
  '3. Renewal. The order form renews automatically.  ',
  '',
  '',
].join('\r\n')

/** The paragraphs expected from MULTI_PARAGRAPH_BODY, line breaks as `\n`. */
const EXPECTED_PARAGRAPHS = [
  '1. Term. The subscription term is 12 months.',
  '2. Fees. Fees are EUR 60,000 per year,\npayable annually in advance.',
  '3. Renewal. The order form renews automatically.',
]

/** One paragraph over two lines: a single line break does not split it. */
const SINGLE_PARAGRAPH_BODY =
  'Customer asked for EU data residency.\nWe agreed to confirm by Friday.'

type Fixture = { accountId: string; dealId: string; dealName: string }

let userA: SignedInTestUser
let userB: SignedInTestUser
/** A's deal that receives evidence, A's second deal, and B's own deal. */
const fixtures = {} as Record<'dealA' | 'otherDealA' | 'dealB', Fixture>

async function createAccountWithDeal(
  user: SignedInTestUser,
  label: string,
): Promise<Fixture> {
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

/** Fills the add-evidence form; the optional provenance only when given. */
async function fillEvidenceForm(
  page: Page,
  fields: {
    type: string
    title: string
    body: string
    author?: string
    version?: string
    documentDate?: string
    executed?: boolean
  },
) {
  await page.getByLabel('Evidence type').selectOption(fields.type)
  await page.getByLabel('Title').fill(fields.title)
  await page.getByLabel('Evidence text').fill(fields.body)
  if (fields.author) await page.getByLabel('Author').fill(fields.author)
  // Exact: "Version" is also part of the "Executed version" label.
  if (fields.version) await page.getByLabel('Version', { exact: true }).fill(fields.version)
  if (fields.documentDate) await page.getByLabel('Document date').fill(fields.documentDate)
  if (fields.executed) await page.getByLabel('Executed version').check()
}

/** Submits the add-evidence form and waits for the Server Action to answer. */
async function submitEvidenceForm(page: Page) {
  const answered = page.waitForResponse((response) => response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Add evidence' }).click()
  await answered
}

const EVIDENCE_ITEM_COLUMNS =
  'id, deal_id, evidence_type, title, source_kind, body_text, author, version_label, document_date, is_executed, supersedes_evidence_id'

async function readItem(user: SignedInTestUser, id: string) {
  const { data, error } = await user.client
    .from('evidence_items')
    .select(EVIDENCE_ITEM_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`E2E read of evidence item failed (${error.code}).`)
  return data
}

async function readExcerpts(user: SignedInTestUser, itemId: string) {
  const { data, error } = await user.client
    .from('evidence_excerpts')
    .select('id, evidence_item_id, deal_id, ordinal, start_offset, end_offset, content')
    .eq('evidence_item_id', itemId)
    .order('ordinal', { ascending: true })
  if (error) throw new Error(`E2E read of evidence excerpts failed (${error.code}).`)
  return data
}

async function evidenceTitlesOn(user: SignedInTestUser, dealId: string) {
  const { data, error } = await user.client
    .from('evidence_items')
    .select('title')
    .eq('deal_id', dealId)
  if (error) throw new Error(`E2E read of deal evidence failed (${error.code}).`)
  return data.map((row) => row.title)
}

/**
 * Checks the stored excerpts of an item against the paragraph rule: ordinals
 * 0..n-1, each content the exact slice of the stored body at its offsets, no
 * surrounding whitespace, never empty, and the paragraphs as expected.
 */
function expectFaithfulExcerpts(
  body: string,
  excerpts: Awaited<ReturnType<typeof readExcerpts>>,
  expectedParagraphs: string[],
) {
  expect(excerpts.map((excerpt) => excerpt.ordinal)).toEqual(
    expectedParagraphs.map((_, index) => index),
  )

  let previousEnd = 0
  for (const excerpt of excerpts) {
    expect(excerpt.content.length).toBeGreaterThan(0)
    expect(excerpt.content).toBe(excerpt.content.trim())
    expect(body.slice(excerpt.start_offset, excerpt.end_offset)).toBe(excerpt.content)
    // In body order, not overlapping.
    expect(excerpt.start_offset).toBeGreaterThanOrEqual(previousEnd)
    previousEnd = excerpt.end_offset
  }

  expect(excerpts.map((excerpt) => excerpt.content.replace(/\r\n/g, '\n'))).toEqual(
    expectedParagraphs,
  )
}

test.beforeAll(async () => {
  userA = await signInTestUser('A')
  userB = await signInTestUser('B')
  fixtures.dealA = await createAccountWithDeal(userA, 'Evidence')
  fixtures.otherDealA = await createAccountWithDeal(userA, 'Other')
  fixtures.dealB = await createAccountWithDeal(userB, 'Evidence B')
})

test.afterAll(async () => {
  const errors: string[] = []

  for (const user of [userA, userB]) {
    if (!user) continue
    try {
      // Deleting the accounts cascades to their deals and all their evidence.
      const { error } = await user.client
        .from('accounts')
        .delete()
        .like('name', `${E2E_PREFIX}%`)
      if (error) errors.push(`user ${user.label} (${error.code})`)
    } finally {
      await signOutTestUser(user)
    }
  }

  if (errors.length > 0) throw new Error(`E2E cleanup failed: ${errors.join(', ')}.`)
})

test.describe('signed-out visitor', () => {
  const dealId = randomUUID()
  const evidenceId = randomUUID()

  for (const path of [
    `/workspace/deals/${dealId}/evidence/new`,
    `/workspace/deals/${dealId}/evidence/${evidenceId}`,
  ]) {
    test(`is sent to /login from ${path.replace(dealId, '[id]').replace(evidenceId, '[id]')}`, async ({
      page,
    }) => {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login$/)
    })
  }
})

test.describe.serial('evidence and excerpts', () => {
  let msaId = ''
  let noteId = ''

  test('a deal with no evidence shows the empty state', async ({ page }) => {
    const { dealId } = fixtures.dealA
    await signIn(page, 'A')

    await page.goto(`/workspace/deals/${dealId}`)
    const evidence = page.getByRole('region', { name: 'Evidence' })
    await expect(evidence).toContainText('No evidence yet')
    await expect(evidence.getByRole('link', { name: 'Add evidence' })).toBeVisible()
  })

  test('user A adds pasted evidence with provenance, split into faithful excerpts', async ({
    page,
  }) => {
    const { dealId, dealName } = fixtures.dealA
    await signIn(page, 'A')

    await page.goto(`/workspace/deals/${dealId}`)
    await page
      .getByRole('region', { name: 'Evidence' })
      .getByRole('link', { name: 'Add evidence' })
      .click()
    await expect(page).toHaveURL(new RegExp(`/workspace/deals/${dealId}/evidence/new$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Add evidence' })).toBeVisible()
    // The form is tied to the deal in the URL, and says evidence is permanent.
    const main = page.getByRole('main')
    await expect(main).toContainText(dealName)
    await expect(main).toContainText(/cannot be edited or deleted/i)

    await fillEvidenceForm(page, {
      type: 'order_form',
      title: MSA_TITLE,
      body: MULTI_PARAGRAPH_BODY,
      author: 'Jane Buyer',
      version: 'v2',
      documentDate: '2027-01-15',
      executed: true,
    })
    await submitEvidenceForm(page)

    await expect(page).toHaveURL(
      new RegExp(`/workspace/deals/${dealId}/evidence/[0-9a-f-]{36}$`),
    )
    msaId = new URL(page.url()).pathname.split('/').pop() ?? ''

    // Stored against the right deal, as pasted evidence, with its provenance.
    const item = await readItem(userA, msaId)
    expect(item).toMatchObject({
      deal_id: dealId,
      evidence_type: 'order_form',
      title: MSA_TITLE,
      source_kind: 'pasted',
      author: 'Jane Buyer',
      version_label: 'v2',
      document_date: '2027-01-15',
      is_executed: true,
      supersedes_evidence_id: null,
    })

    // Excerpts were generated automatically, one per paragraph.
    const excerpts = await readExcerpts(userA, msaId)
    expect(excerpts.every((excerpt) => excerpt.deal_id === dealId)).toBe(true)
    expectFaithfulExcerpts(item!.body_text, excerpts, EXPECTED_PARAGRAPHS)
  })

  test('the evidence page shows its metadata and numbered excerpts, and no edit or delete', async ({
    page,
  }) => {
    expect(msaId, 'the previous test must have added evidence').not.toBe('')
    const { dealId } = fixtures.dealA
    await signIn(page, 'A')

    await page.goto(`/workspace/deals/${dealId}/evidence/${msaId}`)
    await expect(page.getByRole('heading', { level: 1, name: MSA_TITLE })).toBeVisible()

    const details = page.getByRole('region', { name: 'Evidence details' })
    await expect(detailValue(page, details, 'Type')).toHaveText('Order form')
    await expect(detailValue(page, details, 'Author')).toHaveText('Jane Buyer')
    await expect(detailValue(page, details, 'Version')).toHaveText('v2')
    await expect(detailValue(page, details, 'Document date')).toHaveText('15 Jan 2027')
    await expect(detailValue(page, details, 'Executed')).toHaveText('Yes')

    const excerpts = page.getByRole('region', { name: 'Excerpts' }).getByRole('listitem')
    await expect(excerpts).toHaveCount(EXPECTED_PARAGRAPHS.length)
    for (const [index, paragraph] of EXPECTED_PARAGRAPHS.entries()) {
      const excerpt = excerpts.nth(index)
      await expect(excerpt).toContainText(`Excerpt ${index + 1}`)
      await expect(excerpt).toContainText(paragraph.replace(/\s+/g, ' '))
    }

    // Evidence is immutable and not independently deletable (E3).
    const main = page.getByRole('main')
    await expect(main.getByRole('link', { name: /edit|delete/i })).toHaveCount(0)
    await expect(main.getByRole('button', { name: /edit|delete/i })).toHaveCount(0)
  })

  test('a single-paragraph body becomes exactly one excerpt', async ({ page }) => {
    const { dealId } = fixtures.dealA
    await signIn(page, 'A')

    await page.goto(`/workspace/deals/${dealId}/evidence/new`)
    await fillEvidenceForm(page, {
      type: 'call_note',
      title: NOTE_TITLE,
      body: SINGLE_PARAGRAPH_BODY,
    })
    await submitEvidenceForm(page)

    await expect(page).toHaveURL(
      new RegExp(`/workspace/deals/${dealId}/evidence/[0-9a-f-]{36}$`),
    )
    noteId = new URL(page.url()).pathname.split('/').pop() ?? ''

    // Optional provenance left out is stored as not set.
    const item = await readItem(userA, noteId)
    expect(item).toMatchObject({
      deal_id: dealId,
      evidence_type: 'call_note',
      author: null,
      version_label: null,
      document_date: null,
      is_executed: false,
    })

    expectFaithfulExcerpts(item!.body_text, await readExcerpts(userA, noteId), [
      SINGLE_PARAGRAPH_BODY,
    ])
    await expect(
      page.getByRole('region', { name: 'Excerpts' }).getByRole('listitem'),
    ).toHaveCount(1)
  })

  test('the deal page lists its evidence and links to it; other deals stay empty', async ({
    page,
  }) => {
    expect(noteId, 'the previous tests must have added evidence').not.toBe('')
    const { dealId } = fixtures.dealA
    await signIn(page, 'A')

    await page.goto(`/workspace/deals/${dealId}`)
    const evidence = page.getByRole('region', { name: 'Evidence' })
    await expect(evidence).not.toContainText('No evidence yet')
    await expect(evidence.getByRole('link', { name: NOTE_TITLE })).toBeVisible()

    await evidence.getByRole('link', { name: MSA_TITLE }).click()
    await expect(page).toHaveURL(new RegExp(`/workspace/deals/${dealId}/evidence/${msaId}$`))
    await expect(page.getByRole('heading', { level: 1, name: MSA_TITLE })).toBeVisible()

    // Evidence belongs to its deal only.
    await page.goto(`/workspace/deals/${fixtures.otherDealA.dealId}`)
    await expect(page.getByRole('region', { name: 'Evidence' })).toContainText('No evidence yet')
    await expect(page.getByText(MSA_TITLE)).toHaveCount(0)

    // An evidence id under a deal it does not belong to is not found.
    await page.goto(`/workspace/deals/${fixtures.otherDealA.dealId}/evidence/${msaId}`)
    await expect(page.getByRole('heading', { name: /not found/i })).toBeVisible()
    await expect(page.getByText(MSA_TITLE)).toHaveCount(0)
  })

  test('tampered deal_id and user_id fields cannot move user A\'s evidence', async ({
    page,
  }) => {
    const { dealId } = fixtures.dealA
    await signIn(page, 'A')

    await page.goto(`/workspace/deals/${dealId}/evidence/new`)
    await fillEvidenceForm(page, {
      type: 'email',
      title: TAMPER_A_TITLE,
      body: 'Please confirm the payment terms.',
    })
    // Smuggle ownership fields pointing at user B into the submission.
    await page.locator('form').evaluate(
      (form, { dealB, userIdB }) => {
        for (const [name, value] of [
          ['deal_id', dealB],
          ['user_id', userIdB],
        ]) {
          const input = document.createElement('input')
          input.type = 'hidden'
          input.name = name
          input.value = value
          form.appendChild(input)
        }
      },
      { dealB: fixtures.dealB.dealId, userIdB: userB.userId },
    )
    await submitEvidenceForm(page)

    // Stored on the deal in the URL, visible to A only.
    await expect(page).toHaveURL(
      new RegExp(`/workspace/deals/${dealId}/evidence/[0-9a-f-]{36}$`),
    )
    const item = await readItem(userA, new URL(page.url()).pathname.split('/').pop() ?? '')
    expect(item?.deal_id).toBe(dealId)
    expect(await evidenceTitlesOn(userB, fixtures.dealB.dealId)).not.toContain(TAMPER_A_TITLE)
  })

  test("user B cannot add to, open or see user A's evidence", async ({ page }) => {
    expect(msaId, 'evidence must have been added').not.toBe('')
    const { dealId, dealName } = fixtures.dealA
    await signIn(page, 'B')

    for (const path of [
      `/workspace/deals/${dealId}/evidence/new`,
      `/workspace/deals/${dealId}/evidence/${msaId}`,
      // A's evidence id under B's own deal.
      `/workspace/deals/${fixtures.dealB.dealId}/evidence/${msaId}`,
    ]) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: /not found/i })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Add evidence' })).toHaveCount(0)
      await expect(page.getByText(MSA_TITLE)).toHaveCount(0)
      await expect(page.getByText(dealName)).toHaveCount(0)
      await expect(page.getByText(EXPECTED_PARAGRAPHS[0])).toHaveCount(0)
    }

    // Nor can B read it directly under RLS.
    expect(await readItem(userB, msaId)).toBeNull()
    expect(await readExcerpts(userB, msaId)).toEqual([])
  })

  test('evidence whose excerpts failed says so and can have them created once', async ({
    page,
  }) => {
    const { dealId } = fixtures.dealA
    // The state a failed excerpt insert leaves: the item stored, no excerpts.
    const inserted = await userA.client
      .from('evidence_items')
      .insert({
        deal_id: dealId,
        evidence_type: 'order_form',
        title: ORPHAN_TITLE,
        source_kind: 'pasted',
        body_text: MULTI_PARAGRAPH_BODY,
      })
      .select('id')
      .single()
    if (inserted.error) throw new Error(`E2E setup: evidence insert failed (${inserted.error.code}).`)
    const itemId = inserted.data.id
    await signIn(page, 'A')

    await page.goto(`/workspace/deals/${dealId}/evidence/${itemId}`)
    const region = page.getByRole('region', { name: 'Excerpts' })
    await expect(region).toContainText(/creating the excerpts of this evidence failed/i)
    await expect(region).not.toContainText('This evidence has no excerpts.')

    const answered = page.waitForResponse((response) => response.request().method() === 'POST')
    await region.getByRole('button', { name: 'Create excerpts' }).click()
    await answered

    await expect(region.getByRole('listitem')).toHaveCount(EXPECTED_PARAGRAPHS.length)
    await expect(region).not.toContainText(/failed/i)
    await expect(region.getByRole('button', { name: 'Create excerpts' })).toHaveCount(0)

    // Created from the stored body, faithfully, on the item's deal.
    const item = await readItem(userA, itemId)
    const excerpts = await readExcerpts(userA, itemId)
    expect(excerpts.every((excerpt) => excerpt.deal_id === dealId)).toBe(true)
    expectFaithfulExcerpts(item!.body_text, excerpts, EXPECTED_PARAGRAPHS)
  })

  test("user B cannot redirect a submission onto user A's deal", async ({ page }) => {
    const before = await evidenceTitlesOn(userA, fixtures.dealA.dealId)
    await signIn(page, 'B')

    await page.goto(`/workspace/deals/${fixtures.dealB.dealId}/evidence/new`)
    await expect(page.getByRole('heading', { level: 1, name: 'Add evidence' })).toBeVisible()
    await fillEvidenceForm(page, {
      type: 'email',
      title: TAMPER_B_TITLE,
      body: 'Attempt to attach evidence to another user deal.',
    })
    // Point every deal reference in the submission at user A's deal, and add
    // explicit ownership fields for good measure.
    await page.locator('form').evaluate(
      (form, { dealB, dealA, userIdA }) => {
        for (const input of Array.from(form.querySelectorAll('input'))) {
          if (input.value === dealB) input.value = dealA
        }
        for (const [name, value] of [
          ['deal_id', dealA],
          ['dealId', dealA],
          ['user_id', userIdA],
        ]) {
          const input = document.createElement('input')
          input.type = 'hidden'
          input.name = name
          input.value = value
          form.appendChild(input)
        }
      },
      { dealB: fixtures.dealB.dealId, dealA: fixtures.dealA.dealId, userIdA: userA.userId },
    )
    await submitEvidenceForm(page)

    // Whatever the outcome for B, nothing reached A's deal.
    expect(await evidenceTitlesOn(userA, fixtures.dealA.dealId)).toEqual(before)
  })
})
