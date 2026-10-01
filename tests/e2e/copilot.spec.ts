import { expect, test, type Locator, type Page } from '@playwright/test'

import { requireTestEnv } from '../support/env'
import {
  signInTestUser,
  signOutTestUser,
  type SignedInTestUser,
} from '../support/supabase-clients'

/**
 * Feature 6: AI Deal Copilot V1 on the deal page.
 *
 * One question box ("Copilot"), single turn. Each answer is stored as an
 * immutable AI finding and listed under "Copilot answers", newest first, at
 * most 10. An answer is labelled "AI answer — not a decision"; each claim
 * shows its cited facts and excerpts, and a claim without valid support —
 * no reference, an unknown reference, or a number not in its sources — is
 * marked "Unsupported". Evidence that does not address the question, and a
 * request to decide or act, get fixed messages. No Decision is ever created.
 *
 * The model is the local fake of tests/support/fake-openrouter.mjs, started
 * by playwright.config.ts, which also points the dev server at it. The spec
 * reads the fake's request log to prove that every request went there, with
 * the fake key and pinned model, no fallbacks, and no UUID in the prompt.
 * (That the production default cannot be redirected is proven in
 * tests/unit/copilot-provider.test.ts: these tests run a dev server.)
 *
 * Fixtures are set up directly as user A under RLS: one account, one deal
 * (ARR €60,000, discount 25%) with two pieces of evidence that disagree on
 * payment terms. The discount exception is raised through the UI. `afterAll`
 * deletes every E2E account of user A, which cascades, and signs out.
 */

const E2E_PREFIX = 'E2E '
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const RUN_PREFIX = `${E2E_PREFIX}${RUN_ID}`
const FAKE_PROVIDER = 'http://127.0.0.1:4010'
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

const AI_LABEL = 'AI answer — not a decision'
const INSUFFICIENT = 'The evidence on this deal does not address this.'
const OUT_OF_SCOPE = "I can only answer questions about this deal's facts, evidence and exceptions. I can't decide, approve or change anything."
const COPILOT_ERROR = 'The Copilot could not answer right now. Please try again.'

const LIABILITY_TEXT = 'The liability cap is 12 months of fees.'
const NET_30_TEXT = 'Payment terms are Net 30.'
const NET_60_TEXT = 'Payment terms are Net 60 as agreed by email.'

let userA: SignedInTestUser
let dealId: string
let dealPath: string

async function evidence(title: string, evidenceType: string, paragraphs: string[]) {
  const body = paragraphs.join('\n\n')
  const item = await userA.client
    .from('evidence_items')
    .insert({
      deal_id: dealId,
      title: `${RUN_PREFIX} ${title}`,
      evidence_type: evidenceType,
      source_kind: 'pasted',
      body_text: body,
      document_date: '2026-01-15',
      is_executed: true,
    })
    .select('id')
    .single()
  if (item.error) throw new Error(`E2E setup: evidence insert failed (${item.error.code}).`)

  let offset = 0
  const excerpts = await userA.client.from('evidence_excerpts').insert(
    paragraphs.map((content, ordinal) => {
      const start = body.indexOf(content, offset)
      offset = start + content.length
      return {
        evidence_item_id: item.data.id,
        deal_id: dealId,
        ordinal,
        start_offset: start,
        end_offset: start + content.length,
        content,
      }
    }),
  )
  if (excerpts.error) throw new Error(`E2E setup: excerpt insert failed (${excerpts.error.code}).`)
}

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(requireTestEnv('DEAL_DESK_TEST_USER_A_EMAIL'))
  await page.getByLabel('Password').fill(requireTestEnv('DEAL_DESK_TEST_USER_A_PASSWORD'))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/workspace$/, { timeout: 30_000 })
}

async function submit(page: Page, button: Locator) {
  const answered = page.waitForResponse((response) => response.request().method() === 'POST')
  await button.click()
  await answered
}

function answers(page: Page) {
  return page.getByRole('region', { name: 'Copilot answers' }).getByRole('article', { name: 'Copilot answer' })
}

/** Asks one question on the deal page and waits for the action's response. */
async function ask(page: Page, question: string) {
  const copilot = page.getByRole('region', { name: 'Copilot', exact: true })
  await copilot.getByLabel('Question').fill(question)
  await submit(page, copilot.getByRole('button', { name: 'Ask' }))
}

/** Asks and waits for the new answer at the top of the list. */
async function askAndWait(page: Page, question: string): Promise<Locator> {
  await ask(page, question)
  const newest = answers(page).first()
  await expect(newest).toContainText(question)
  return newest
}

function claims(answer: Locator) {
  return answer.getByRole('list', { name: 'Claims' }).getByRole('listitem')
}

async function fakeRequests(): Promise<
  {
    authorization: string | null
    model: string | null
    provider: { allow_fallbacks?: boolean; data_collection?: string } | null
    response_format: { type: string } | null
    has_uuid: boolean
    question: string
    source_count: number
  }[]
> {
  const response = await fetch(`${FAKE_PROVIDER}/__requests`)
  return response.json()
}

async function rowsOf(table: 'decisions' | 'ai_findings' | 'exceptions', columns: string) {
  const { data, error } = await userA.client.from(table).select(columns).eq('deal_id', dealId)
  if (error) throw new Error(`E2E read of ${table} failed (${error.code}).`)
  return data as unknown as Record<string, unknown>[]
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userA = await signInTestUser('A')
  await fetch(`${FAKE_PROVIDER}/__reset`, { method: 'POST' })

  const account = await userA.client
    .from('accounts')
    .insert({ name: `${RUN_PREFIX} Copilot Account` })
    .select('id')
    .single()
  if (account.error) throw new Error(`E2E setup: account insert failed (${account.error.code}).`)

  const deal = await userA.client
    .from('deals')
    .insert({
      account_id: account.data.id,
      name: `${RUN_PREFIX} Copilot Deal`,
      deal_type: 'new_business',
      stage: 'negotiation',
      arr_eur: 60000,
      discount_pct: 25,
    })
    .select('id')
    .single()
  if (deal.error) throw new Error(`E2E setup: deal insert failed (${deal.error.code}).`)
  dealId = deal.data.id
  dealPath = `/workspace/deals/${dealId}`

  await evidence('Master agreement', 'msa', [LIABILITY_TEXT, NET_30_TEXT])
  await evidence('Negotiation email', 'email', [NET_60_TEXT])
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

test.describe('AI Deal Copilot', () => {
  test('the deal page offers a single question box and has no answers yet', async ({ page }) => {
    await signIn(page)
    // Raise the discount exception (25% > 20%) through the UI, for later checks.
    await page.goto(dealPath)
    const exceptions = page.getByRole('region', { name: 'Exceptions' })
    await submit(page, exceptions.getByRole('button', { name: 'Check deal' }))
    await expect(exceptions.getByRole('status')).toContainText('raised')

    const copilot = page.getByRole('region', { name: 'Copilot', exact: true })
    await expect(copilot.getByLabel('Question')).toBeVisible()
    await expect(copilot.getByRole('button', { name: 'Ask' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Copilot answers' })).toContainText('No Copilot answers yet.')
  })

  test('a question gets a cited answer, labelled as AI output', async ({ page }) => {
    await signIn(page)
    await page.goto(dealPath)

    const answer = await askAndWait(page, 'What did we agree about liability?')

    await expect(answer).toContainText(AI_LABEL)
    await expect(claims(answer)).toHaveCount(2)
    const [liability, arr] = [claims(answer).nth(0), claims(answer).nth(1)]
    await expect(liability).toContainText(LIABILITY_TEXT)
    await expect(liability).toContainText('Master agreement')
    await expect(liability).not.toContainText('Unsupported')
    // A cited fact is shown as "label: value", from the stored snapshot.
    await expect(arr).toContainText('ARR: €60,000.00')
    await expect(arr).not.toContainText('Unsupported')
  })

  test('the request went to the local fake: fake key, pinned model, no fallbacks, no UUID', async () => {
    const requests = await fakeRequests()

    expect(requests.length).toBeGreaterThanOrEqual(1)
    for (const request of requests) {
      expect(request.authorization).toBe('Bearer e2e-fake-key')
      expect(request.model).toBe('fake/copilot-model')
      expect(request.provider).toMatchObject({ allow_fallbacks: false, data_collection: 'deny' })
      expect(request.response_format).toEqual({ type: 'json_object' })
      expect(request.has_uuid).toBe(false)
    }
    // Single turn: the prompt carries this question only, never an earlier one.
    expect(requests.at(-1)!.question).toBe('What did we agree about liability?')
  })

  test('claims without valid support are marked Unsupported', async ({ page }) => {
    await signIn(page)
    await page.goto(dealPath)

    const answer = await askAndWait(page, 'Show me unsupported claims, please.')

    await expect(claims(answer)).toHaveCount(4)
    await expect(claims(answer).nth(0)).not.toContainText('Unsupported')
    // No reference; a number (45%) not in its cited source; an unknown reference.
    for (const n of [1, 2, 3]) {
      await expect(claims(answer).nth(n)).toContainText('Unsupported')
    }
    await expect(answer).not.toContainText('E99')
  })

  test('evidence that does not address the question says so', async ({ page }) => {
    await signIn(page)
    await page.goto(dealPath)

    const answer = await askAndWait(page, 'Where is customer data residency?')

    await expect(answer).toContainText(INSUFFICIENT)
    await expect(claims(answer)).toHaveCount(0)
  })

  test('conflicting evidence is cited on both sides, not reconciled', async ({ page }) => {
    await signIn(page)
    await page.goto(dealPath)

    const answer = await askAndWait(page, 'What are the payment terms?')

    await expect(claims(answer)).toHaveCount(1)
    const claim = claims(answer).first()
    await expect(claim).toContainText(NET_30_TEXT)
    await expect(claim).toContainText(NET_60_TEXT)
    await expect(claim).toContainText('Negotiation email')
    await expect(claim).not.toContainText('Unsupported')
  })

  test('a request to decide or act is refused, and nothing changes', async ({ page }) => {
    await signIn(page)
    await page.goto(dealPath)

    const answer = await askAndWait(page, 'Should I approve the discount exception?')

    await expect(answer).toContainText(OUT_OF_SCOPE)
    await expect(claims(answer)).toHaveCount(0)
    expect(await rowsOf('decisions', 'id')).toEqual([])
    expect(await rowsOf('exceptions', 'status')).toEqual([{ status: 'open' }])
  })

  test('malformed model output shows the generic error and stores nothing', async ({ page }) => {
    await signIn(page)
    await page.goto(dealPath)
    const before = (await rowsOf('ai_findings', 'id')).length

    await ask(page, 'Return something malformed.')

    await expect(page.getByRole('region', { name: 'Copilot', exact: true }).getByRole('alert')).toContainText(COPILOT_ERROR)
    expect((await rowsOf('ai_findings', 'id')).length).toBe(before)
    await expect(answers(page).first()).not.toContainText('Return something malformed.')
  })

  test('earlier answers are listed newest first, at most 10', async ({ page }) => {
    await signIn(page)
    await page.goto(dealPath)

    // Five answers so far; six more make eleven.
    for (let n = 1; n <= 6; n += 1) {
      await askAndWait(page, `History question ${n}: what is the ARR?`)
    }

    await page.reload()
    await expect(answers(page)).toHaveCount(10)
    await expect(answers(page).first()).toContainText('History question 6')
    await expect(answers(page).nth(1)).toContainText('History question 5')
    await expect(answers(page).last()).toContainText('Show me unsupported claims')
    await expect(page.getByRole('region', { name: 'Copilot answers' })).not.toContainText(
      'What did we agree about liability?',
    )
  })

  test('the Copilot created no Decision: only proposed answer findings, the exception still open', async ({ page }) => {
    expect(await rowsOf('decisions', 'id')).toEqual([])
    expect(await rowsOf('exceptions', 'status')).toEqual([{ status: 'open' }])

    const findings = await rowsOf('ai_findings', 'finding_type, status, rule_key, model')
    expect(findings).toHaveLength(11)
    for (const finding of findings) {
      expect(finding).toEqual({
        finding_type: 'answer',
        status: 'proposed',
        rule_key: null,
        // The model the provider reported using.
        model: 'fake/copilot-model',
      })
    }

    // The exception page shows no Decision either.
    await signIn(page)
    const [exception] = (await rowsOf('exceptions', 'id')) as { id: string }[]
    await page.goto(`${dealPath}/exceptions/${exception.id}`)
    await expect(page.getByRole('region', { name: 'Record decision' })).toBeVisible()
  })

  test('no request ever carried a UUID or an earlier question', async () => {
    const requests = await fakeRequests()
    const asked = requests.map((r) => r.question)

    expect(requests.every((r) => !r.has_uuid)).toBe(true)
    expect(new Set(asked).size).toBe(asked.length)
    expect(asked.every((q) => !UUID_PATTERN.test(q))).toBe(true)
  })
})
