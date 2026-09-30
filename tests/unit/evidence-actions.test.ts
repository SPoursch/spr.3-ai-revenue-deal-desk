import { inspect } from 'node:util'

import { PostgrestError } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DealDeskDatabaseError } from '../../app/lib/db/errors'

/**
 * The add-evidence Server Action (Slice 4).
 *
 * It must authorise first, validate on the server, take the deal from a read
 * as the caller (never from the form), store the item as pasted, then store
 * one excerpt per paragraph of the stored body, all in one batched insert.
 * If the excerpts fail after the item was stored, it says so rather than
 * claiming success: evidence cannot be deleted (E3), so there is nothing to
 * roll back.
 *
 * The auth guard, the data layer and Next's navigation are stubs; the action,
 * the form parsing and the paragraph splitter are the real ones.
 */

const db = vi.hoisted(() => ({
  createEvidenceExcerpts: vi.fn(),
  createEvidenceItem: vi.fn(),
  getDeal: vi.fn(),
  getEvidenceItem: vi.fn(),
  listEvidenceExcerpts: vi.fn(),
}))

const guard = vi.hoisted(() => ({ requireUser: vi.fn() }))

const navigation = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`)
  }),
}))

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }))

vi.mock('../../app/lib/db', async () => ({
  ...(await vi.importActual<object>('../../app/lib/db/errors')),
  ...db,
}))
vi.mock('../../app/lib/actions/require-auth', () => guard)
vi.mock('next/navigation', () => navigation)
vi.mock('next/cache', () => cache)

import {
  createEvidenceAction,
  recreateEvidenceExcerptsAction,
} from '../../app/lib/actions/evidence'
import { initialDealDeskActionState } from '../../app/lib/actions/deal-desk-action-state'

const DEAL_ID = '33333333-3333-4333-8333-333333333333'
const ITEM_ID = '55555555-5555-4555-8555-555555555555'
const OTHER_DEAL_ID = '66666666-6666-4666-8666-666666666666'
const RAW_DB_TEXT = 'new row violates check constraint "evidence_items_title_check"'
const NOT_YOURS = /no longer exists, or it is not one of yours/i

const BODY = 'Term: 12 months.\r\n\r\nFees: EUR 60,000.'

const VALID_EVIDENCE = {
  dealId: DEAL_ID,
  evidenceType: 'order_form',
  title: 'Order form 2027',
  bodyText: BODY,
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

function dbError(table: 'evidence_items' | 'evidence_excerpts', code: string) {
  return new DealDeskDatabaseError(
    'insert',
    table,
    new PostgrestError({ message: RAW_DB_TEXT, details: 'internal detail', hint: '', code }),
  )
}

/**
 * Asserts the server log carries only metadata: the SQLSTATE code, never the
 * Postgres message or details, which can quote the submitted evidence.
 */
function expectSafeLog() {
  expect(consoleError).toHaveBeenCalled()
  // inspect, not JSON.stringify: it shows an Error's message and nested
  // cause as a real log line would.
  const logged = consoleError.mock.calls
    .flat()
    .map((arg: unknown) => inspect(arg, { depth: 5 }))
    .join('\n')
  expect(logged).toContain('23514')
  expect(logged).not.toContain(RAW_DB_TEXT)
  expect(logged).not.toContain('internal detail')
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  guard.requireUser.mockResolvedValue(null)
  db.getDeal.mockResolvedValue({ id: DEAL_ID })
  db.createEvidenceItem.mockImplementation(async (input) => ({
    ...input,
    id: ITEM_ID,
    source_kind: 'pasted',
  }))
  db.createEvidenceExcerpts.mockImplementation(async (inputs: object[]) =>
    inputs.map((input) => ({ ...input, id: 'x' })),
  )
  db.getEvidenceItem.mockResolvedValue({ id: ITEM_ID, deal_id: DEAL_ID, body_text: BODY })
  db.listEvidenceExcerpts.mockResolvedValue([])
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.clearAllMocks()
  consoleError.mockRestore()
})

describe('createEvidenceAction', () => {
  it('refuses a signed-out caller before reading or writing', async () => {
    guard.requireUser.mockResolvedValue({ ok: false, message: 'x', at: 1 })

    const result = await createEvidenceAction(initialDealDeskActionState, form(VALID_EVIDENCE))

    expect(result.message).toMatch(/signed in/i)
    expect(db.getDeal).not.toHaveBeenCalled()
    expect(db.createEvidenceItem).not.toHaveBeenCalled()
  })

  it('refuses a deal id that is not a uuid without touching the database', async () => {
    const result = await createEvidenceAction(
      initialDealDeskActionState,
      form({ ...VALID_EVIDENCE, dealId: 'x' }),
    )

    expect(result.message).toMatch(NOT_YOURS)
    expect(db.getDeal).not.toHaveBeenCalled()
  })

  it('returns field errors and the typed values without writing', async () => {
    const result = await createEvidenceAction(
      initialDealDeskActionState,
      form({ ...VALID_EVIDENCE, title: '', bodyText: 'Kept text' }),
    )

    expect(result.fieldErrors).toHaveProperty('title')
    expect(result.values).toMatchObject({ bodyText: 'Kept text' })
    expect(db.createEvidenceItem).not.toHaveBeenCalled()
  })

  it('answers "not found" for a deal that is missing or not yours', async () => {
    db.getDeal.mockResolvedValue(null)

    const result = await createEvidenceAction(initialDealDeskActionState, form(VALID_EVIDENCE))

    expect(db.getDeal).toHaveBeenCalledWith(DEAL_ID)
    expect(result.message).toMatch(NOT_YOURS)
    expect(db.createEvidenceItem).not.toHaveBeenCalled()
  })

  it('stores the item on the verified deal and one excerpt per paragraph in a single insert, then opens it', async () => {
    await expect(
      createEvidenceAction(
        initialDealDeskActionState,
        form({
          ...VALID_EVIDENCE,
          deal_id: OTHER_DEAL_ID,
          user_id: 'someone-else',
          source_kind: 'uploaded',
        }),
      ),
    ).rejects.toThrow(`NEXT_REDIRECT /workspace/deals/${DEAL_ID}/evidence/${ITEM_ID}`)

    const item = db.createEvidenceItem.mock.calls[0][0]
    expect(item).toMatchObject({
      deal_id: DEAL_ID,
      evidence_type: 'order_form',
      title: 'Order form 2027',
      body_text: BODY,
    })
    for (const key of ['user_id', 'source_kind']) expect(item).not.toHaveProperty(key)

    expect(db.createEvidenceExcerpts).toHaveBeenCalledTimes(1)
    expect(db.createEvidenceExcerpts.mock.calls[0][0]).toEqual([
      {
        evidence_item_id: ITEM_ID,
        deal_id: DEAL_ID,
        ordinal: 0,
        start_offset: 0,
        end_offset: 16,
        content: 'Term: 12 months.',
      },
      {
        evidence_item_id: ITEM_ID,
        deal_id: DEAL_ID,
        ordinal: 1,
        start_offset: 20,
        end_offset: 37,
        content: 'Fees: EUR 60,000.',
      },
    ])
    expect(cache.revalidatePath).toHaveBeenCalledWith(`/workspace/deals/${DEAL_ID}`)
  })

  it('asks the user to check the details when the database rejects the item', async () => {
    db.createEvidenceItem.mockRejectedValue(dbError('evidence_items', '23514'))

    const result = await createEvidenceAction(initialDealDeskActionState, form(VALID_EVIDENCE))

    expect(result.message).toMatch(/could not be saved with these details/i)
    expect(result.values).toMatchObject({ title: 'Order form 2027' })
    expect(JSON.stringify(result)).not.toContain(RAW_DB_TEXT)
    expect(db.createEvidenceExcerpts).not.toHaveBeenCalled()
    expectSafeLog()
  })

  it('answers "not found" when the deal became unavailable before the insert', async () => {
    db.createEvidenceItem.mockRejectedValue(dbError('evidence_items', '42501'))

    const result = await createEvidenceAction(initialDealDeskActionState, form(VALID_EVIDENCE))

    expect(result.message).toMatch(NOT_YOURS)
    expect(db.createEvidenceExcerpts).not.toHaveBeenCalled()
  })

  it('shows a generic message for an unexpected item failure and logs it', async () => {
    db.createEvidenceItem.mockRejectedValue(new Error('connection reset'))

    const result = await createEvidenceAction(initialDealDeskActionState, form(VALID_EVIDENCE))

    expect(result.message).toMatch(/could not add the evidence/i)
    expect(JSON.stringify(result)).not.toContain('connection reset')
    expect(consoleError).toHaveBeenCalled()
  })

  it('does not claim success when the excerpts fail after the item was saved', async () => {
    db.createEvidenceExcerpts.mockRejectedValue(dbError('evidence_excerpts', '23514'))

    const result = await createEvidenceAction(initialDealDeskActionState, form(VALID_EVIDENCE))

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/saved, but its excerpts could not all be created/i)
    // Not re-filled: submitting again would add the evidence a second time.
    expect(result.values).toEqual({})
    expect(JSON.stringify(result)).not.toContain(RAW_DB_TEXT)
    expect(navigation.redirect).not.toHaveBeenCalled()
    expectSafeLog()
    // The deal page now lists the item, so it is refreshed.
    expect(cache.revalidatePath).toHaveBeenCalledWith(`/workspace/deals/${DEAL_ID}`)
  })
})

describe('recreateEvidenceExcerptsAction', () => {
  const ITEM_PATH = `/workspace/deals/${DEAL_ID}/evidence/${ITEM_ID}`

  it('refuses a signed-out caller before reading or writing', async () => {
    guard.requireUser.mockResolvedValue({ ok: false, message: 'x', at: 1 })

    const result = await recreateEvidenceExcerptsAction(
      initialDealDeskActionState,
      form({ evidenceId: ITEM_ID }),
    )

    expect(result.message).toMatch(/signed in/i)
    expect(db.getEvidenceItem).not.toHaveBeenCalled()
    expect(db.createEvidenceExcerpts).not.toHaveBeenCalled()
  })

  it("re-creates the excerpts of an owned item with none, from the stored body, in one insert", async () => {
    await expect(
      recreateEvidenceExcerptsAction(
        initialDealDeskActionState,
        form({
          evidenceId: ITEM_ID,
          // Client-supplied content and ownership are ignored.
          bodyText: 'Injected paragraph.',
          deal_id: OTHER_DEAL_ID,
          user_id: 'someone-else',
        }),
      ),
    ).rejects.toThrow(`NEXT_REDIRECT ${ITEM_PATH}`)

    expect(db.getEvidenceItem).toHaveBeenCalledWith(ITEM_ID)
    expect(db.listEvidenceExcerpts).toHaveBeenCalledWith(ITEM_ID)
    expect(db.createEvidenceExcerpts).toHaveBeenCalledTimes(1)
    const excerpts = db.createEvidenceExcerpts.mock.calls[0][0]
    expect(excerpts.map((excerpt: { content: string }) => excerpt.content)).toEqual([
      'Term: 12 months.',
      'Fees: EUR 60,000.',
    ])
    for (const excerpt of excerpts) {
      expect(excerpt).toMatchObject({ evidence_item_id: ITEM_ID, deal_id: DEAL_ID })
      expect(excerpt).not.toHaveProperty('user_id')
    }
    expect(cache.revalidatePath).toHaveBeenCalledWith(ITEM_PATH)
  })

  it('refuses an item that already has excerpts, without writing', async () => {
    db.listEvidenceExcerpts.mockResolvedValue([{ id: 'x', ordinal: 0 }])

    const result = await recreateEvidenceExcerptsAction(
      initialDealDeskActionState,
      form({ evidenceId: ITEM_ID }),
    )

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/already has its excerpts/i)
    expect(db.createEvidenceExcerpts).not.toHaveBeenCalled()
  })

  it("answers \"not found\" for an item on another user's deal, without writing", async () => {
    // Row level security hides another user's evidence: the read is null.
    db.getEvidenceItem.mockResolvedValue(null)

    const result = await recreateEvidenceExcerptsAction(
      initialDealDeskActionState,
      form({ evidenceId: ITEM_ID }),
    )

    expect(result.message).toMatch(/no longer exists, or it is not one of yours/i)
    expect(db.listEvidenceExcerpts).not.toHaveBeenCalled()
    expect(db.createEvidenceExcerpts).not.toHaveBeenCalled()
  })

  it('refuses an id that is not a uuid without touching the database', async () => {
    const result = await recreateEvidenceExcerptsAction(
      initialDealDeskActionState,
      form({ evidenceId: 'x' }),
    )

    expect(result.message).toMatch(/no longer exists, or it is not one of yours/i)
    expect(db.getEvidenceItem).not.toHaveBeenCalled()
  })

  it('refuses a stored body over the paragraph cap, without writing', async () => {
    db.getEvidenceItem.mockResolvedValue({
      id: ITEM_ID,
      deal_id: DEAL_ID,
      body_text: Array.from({ length: 501 }, () => 'x').join('\n\n'),
    })

    const result = await recreateEvidenceExcerptsAction(
      initialDealDeskActionState,
      form({ evidenceId: ITEM_ID }),
    )

    expect(result.message).toMatch(/cannot be split into excerpts/i)
    expect(db.createEvidenceExcerpts).not.toHaveBeenCalled()
  })

  it('logs only metadata and shows a generic message when the insert fails again', async () => {
    db.createEvidenceExcerpts.mockRejectedValue(dbError('evidence_excerpts', '23514'))

    const result = await recreateEvidenceExcerptsAction(
      initialDealDeskActionState,
      form({ evidenceId: ITEM_ID }),
    )

    expect(result.message).toMatch(/could not be created/i)
    expect(JSON.stringify(result)).not.toContain(RAW_DB_TEXT)
    expect(navigation.redirect).not.toHaveBeenCalled()
    expectSafeLog()
  })
})
