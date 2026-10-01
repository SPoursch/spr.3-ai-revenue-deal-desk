import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Feature 6: AI Deal Copilot V1 — askCopilotAction (app/lib/actions/copilot.ts).
 *
 * The one Server Action behind the deal page's question box. Its order is the
 * Index's: sign-in check → input validation → reads as the caller → retrieval
 * → one model call over exactly those sources → validation → one `answer`
 * finding and its excerpt citations, stored together in one atomic call
 * (createCopilotAnswer) so a failure leaves no answer without its evidence. The data layer and the provider are
 * replaced here; the pure core (app/lib/deal-desk/copilot.ts) and the runner
 * (app/lib/ai/copilot.ts) are real.
 *
 * It never reaches the Decision write path or any other mutation, and never
 * logs the question, evidence or model output.
 */

const db = vi.hoisted(() => ({
  getDeal: vi.fn(),
  getAccount: vi.fn(),
  listProvisions: vi.fn(),
  listExceptions: vi.fn(),
  listRulePrecedents: vi.fn(),
  retrieveDealExcerpts: vi.fn(),
  createCopilotAnswer: vi.fn(),
  // Never to be called by the Copilot. The two separate answer writes are
  // here too: the answer and its citations are stored only together.
  createAiFinding: vi.fn(),
  addAiFindingExcerpts: vi.fn(),
  recordDecision: vi.fn(),
  createException: vi.fn(),
  updateExceptionStatus: vi.fn(),
  createProvision: vi.fn(),
  updateProvision: vi.fn(),
  updateAiFindingStatus: vi.fn(),
}))

const guard = vi.hoisted(() => ({ requireUser: vi.fn() }))
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }))
const ai = vi.hoisted(() => ({ getCopilotProvider: vi.fn() }))

vi.mock('../../app/lib/db', async () => ({
  ...(await vi.importActual<object>('../../app/lib/db/errors')),
  ...db,
}))
vi.mock('../../app/lib/actions/require-auth', () => guard)
vi.mock('next/cache', () => cache)
vi.mock('../../app/lib/ai/openrouter', () => ai)

import { initialDealDeskActionState } from '../../app/lib/actions/deal-desk-action-state'
import { askCopilotAction } from '../../app/lib/actions/copilot'
import {
  COPILOT_ERROR_MESSAGE,
  COPILOT_PROMPT_VERSION,
  MAX_COPILOT_EXCERPTS,
  questionTerms,
  type CopilotExcerpt,
} from '../../app/lib/deal-desk/copilot'
import { DealDeskDatabaseError } from '../../app/lib/db/errors'
import { PostgrestError } from '@supabase/supabase-js'

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const DEAL_ID = '33333333-3333-4333-8333-333333333333'
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111'
const FINDING_ID = '22222222-2222-4222-8222-222222222222'
const EXCERPT_ID = '99999999-9999-4999-8999-000000000001'
const QUESTION = 'What did we agree about the liability cap?'
const EVIDENCE_TEXT = 'The liability cap is 12 months of fees.'

const deal = {
  id: DEAL_ID,
  account_id: ACCOUNT_ID,
  predecessor_deal_id: null,
  name: 'Acme 2026',
  deal_type: 'new_business',
  stage: 'negotiation',
  arr_eur: 60000,
  tcv_eur: null,
  list_price_eur: null,
  discount_pct: 25,
  term_months: null,
  start_date: null,
  end_date: null,
  renewal_date: null,
  notice_period_days: null,
  auto_renew: null,
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
}

const retrieved: CopilotExcerpt = {
  id: EXCERPT_ID,
  deal_id: DEAL_ID,
  evidence_item_id: '88888888-8888-4888-8888-888888888888',
  ordinal: 0,
  content: EVIDENCE_TEXT,
  evidence_title: 'Master agreement',
  evidence_type: 'msa',
  document_date: '2026-01-15',
  is_executed: true,
}

/** A fake provider: answers from the aliases in the prompt it was sent. */
const provider = vi.fn(async ({ user }: { system: string; user: string }) => {
  const alias = (pattern: RegExp) => user.match(pattern)?.[1]
  const excerpt = alias(/<source alias="(E\d+)" kind="excerpt"/)
  const arr = alias(/<source alias="(F\d+)" kind="fact" label="ARR"/)
  return {
    model: 'reported/model',
    content: JSON.stringify({
      status: 'answered',
      claims: [
        { text: EVIDENCE_TEXT, refs: [excerpt], quotes: { [excerpt!]: 'liability cap is 12 months' } },
        { text: 'The ARR is €60,000.00.', refs: [arr] },
      ],
    }),
  }
})

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

function ask(fields: Record<string, string> = { dealId: DEAL_ID, question: QUESTION }) {
  return askCopilotAction(initialDealDeskActionState, form(fields))
}

function expectNoMutationBeyondTheAnswer() {
  for (const fn of [
    db.createAiFinding,
    db.addAiFindingExcerpts,
    db.recordDecision,
    db.createException,
    db.updateExceptionStatus,
    db.createProvision,
    db.updateProvision,
    db.updateAiFindingStatus,
  ]) {
    expect(fn).not.toHaveBeenCalled()
  }
}

/** A citation insert refused by the database (another deal's excerpt). */
function citationRejected() {
  return new DealDeskDatabaseError(
    'create_copilot_answer',
    'ai_findings',
    new PostgrestError({ message: 'fk', details: '', hint: '', code: '23503' }),
  )
}

let errorLog: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  guard.requireUser.mockResolvedValue(null)
  ai.getCopilotProvider.mockReturnValue({ provider, model: 'pinned/model' })
  db.getDeal.mockResolvedValue(deal)
  db.getAccount.mockResolvedValue(null)
  db.listProvisions.mockResolvedValue([])
  db.listExceptions.mockResolvedValue([])
  db.listRulePrecedents.mockResolvedValue([])
  db.retrieveDealExcerpts.mockResolvedValue({ mode: 'all', excerpts: [retrieved] })
  db.createCopilotAnswer.mockImplementation(async (input: object) => ({
    id: FINDING_ID,
    finding_type: 'answer',
    status: 'proposed',
    created_at: '2026-10-01T10:00:00Z',
    rule_key: null,
    rule_version: null,
    payload: null,
    ...input,
  }))
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  errorLog.mockRestore()
})

describe('askCopilotAction: order and input', () => {
  it('stops a signed-out caller before reading anything or calling the model', async () => {
    guard.requireUser.mockResolvedValue({ ok: false, message: 'You need to be signed in.' })

    const result = await ask()

    expect(result.ok).toBe(false)
    expect(db.getDeal).not.toHaveBeenCalled()
    expect(ai.getCopilotProvider).not.toHaveBeenCalled()
    expect(provider).not.toHaveBeenCalled()
  })

  it('rejects a malformed deal id before any read or model call', async () => {
    const result = await ask({ dealId: 'not-a-uuid', question: QUESTION })

    expect(result.ok).toBe(false)
    expect(db.getDeal).not.toHaveBeenCalled()
    expect(provider).not.toHaveBeenCalled()
  })

  it('rejects an empty or over-long question with a field error and calls nothing', async () => {
    for (const question of ['   ', 'a'.repeat(501)]) {
      const result = await ask({ dealId: DEAL_ID, question })

      expect(result.ok).toBe(false)
      expect(result.fieldErrors.question).toEqual(expect.any(String))
      expect(result.values.question).toBe(question)
    }
    expect(db.getDeal).not.toHaveBeenCalled()
    expect(provider).not.toHaveBeenCalled()
  })

  it("skips the model entirely when the deal cannot be read (missing or another user's)", async () => {
    db.getDeal.mockResolvedValue(null)

    const result = await ask()

    expect(result.ok).toBe(false)
    expect(db.retrieveDealExcerpts).not.toHaveBeenCalled()
    expect(provider).not.toHaveBeenCalled()
    expect(db.createCopilotAnswer).not.toHaveBeenCalled()
  })

  it('fails with the generic message when no provider is configured, storing nothing', async () => {
    ai.getCopilotProvider.mockReturnValue(null)

    const result = await ask()

    expect(result).toMatchObject({ ok: false, message: COPILOT_ERROR_MESSAGE })
    expect(db.createCopilotAnswer).not.toHaveBeenCalled()
  })
})

describe('askCopilotAction: one answer', () => {
  it('retrieves for this deal by the question terms, bounded by the excerpt cap', async () => {
    await ask()

    expect(db.retrieveDealExcerpts).toHaveBeenCalledWith({
      dealId: DEAL_ID,
      terms: questionTerms(QUESTION),
      cap: MAX_COPILOT_EXCERPTS,
    })
  })

  it('calls the model once, with no UUID in the prompt', async () => {
    await ask()

    expect(provider).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(provider.mock.calls[0])).not.toMatch(UUID_PATTERN)
  })

  it('stores one answer finding with the reported model, prompt version, question and no rule', async () => {
    const result = await ask()

    expect(result.ok).toBe(true)
    expect(db.createCopilotAnswer).toHaveBeenCalledTimes(1)
    // The finding type is fixed to 'answer' by the database function
    // (tests/integration/copilot.test.ts checks the stored row).
    const [input] = db.createCopilotAnswer.mock.calls[0]
    expect(input).toMatchObject({
      deal_id: DEAL_ID,
      content: expect.stringMatching(/\S/),
      model: 'reported/model',
      prompt_version: COPILOT_PROMPT_VERSION,
      payload: expect.objectContaining({ question: QUESTION, status: 'answered' }),
    })
    expect(input.rule_key ?? null).toBeNull()
    expect(input.rule_version ?? null).toBeNull()
    expect(input).not.toHaveProperty('status')
  })

  it('stores the excerpt citations with the answer in one call, only for retrieved excerpts, with the verbatim quote', async () => {
    await ask()

    expect(db.createCopilotAnswer).toHaveBeenCalledTimes(1)
    expect(db.createCopilotAnswer.mock.calls[0][1]).toEqual([
      { excerpt_id: EXCERPT_ID, quote: 'liability cap is 12 months' },
    ])
    expect(db.addAiFindingExcerpts).not.toHaveBeenCalled()
  })

  it('stores no citation rows when the answer cites no excerpt', async () => {
    db.retrieveDealExcerpts.mockResolvedValue({ mode: 'all', excerpts: [] })

    await ask()

    expect(db.createCopilotAnswer).toHaveBeenCalledTimes(1)
    expect(db.createCopilotAnswer.mock.calls[0][1]).toEqual([])
  })

  it('refreshes the deal page and reaches no other mutation', async () => {
    await ask()

    expect(cache.revalidatePath).toHaveBeenCalledWith(`/workspace/deals/${DEAL_ID}`)
    expectNoMutationBeyondTheAnswer()
  })
})

describe('askCopilotAction: failures', () => {
  it('stores nothing for malformed model output and shows the generic message', async () => {
    provider.mockResolvedValueOnce({ model: 'reported/model', content: 'not json' })

    const result = await ask()

    expect(result).toMatchObject({ ok: false, message: COPILOT_ERROR_MESSAGE })
    expect(db.createCopilotAnswer).not.toHaveBeenCalled()
  })

  it('stores nothing when the provider fails', async () => {
    provider.mockRejectedValueOnce(new Error('network down'))

    const result = await ask()

    expect(result).toMatchObject({ ok: false, message: COPILOT_ERROR_MESSAGE })
    expect(db.createCopilotAnswer).not.toHaveBeenCalled()
  })

  it('fails safe when the citations cannot be stored: generic message, no repair, no status change', async () => {
    // The atomic store rejects the whole answer, so no finding is left behind.
    db.createCopilotAnswer.mockRejectedValue(citationRejected())

    const result = await ask()

    expect(result).toMatchObject({ ok: false, message: COPILOT_ERROR_MESSAGE })
    expect(db.updateAiFindingStatus).not.toHaveBeenCalled()
    expect(cache.revalidatePath).not.toHaveBeenCalled()
    expectNoMutationBeyondTheAnswer()
  })

  it('a retry after a failed store makes one new atomic store and nothing else', async () => {
    db.createCopilotAnswer.mockRejectedValueOnce(citationRejected())

    const failed = await ask()
    const retried = await ask()

    expect(failed.ok).toBe(false)
    expect(retried.ok).toBe(true)
    expect(db.createCopilotAnswer).toHaveBeenCalledTimes(2)
    expectNoMutationBeyondTheAnswer()
  })

  it('never logs the question, the evidence or the model output', async () => {
    provider.mockResolvedValueOnce({ model: 'reported/model', content: `not json ${EVIDENCE_TEXT}` })
    await ask()
    db.retrieveDealExcerpts.mockRejectedValueOnce(new Error(`boom ${EVIDENCE_TEXT}`))
    await ask()

    expect(errorLog).toHaveBeenCalled()
    const logged = JSON.stringify(errorLog.mock.calls)
    expect(logged).not.toContain(QUESTION)
    expect(logged).not.toContain(EVIDENCE_TEXT)
  })
})
