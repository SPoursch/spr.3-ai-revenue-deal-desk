import { PostgrestError } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DealDeskDatabaseError } from '../../app/lib/db/errors'

/**
 * The Deal Records Server Actions (slice 1).
 *
 * A Server Action is a public POST endpoint, so each one must authorise the
 * request before it validates input or touches the database, validate on the
 * server, pass only the parsed input to the existing data layer, and never
 * show a raw database error.
 *
 * The auth guard, the data layer and Next's navigation are stubs; the actions
 * and the form parsing are the real ones.
 */

const db = vi.hoisted(() => ({
  createAccount: vi.fn(),
  createDeal: vi.fn(),
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

import { createAccountAction } from '../../app/lib/actions/accounts'
import { createDealAction } from '../../app/lib/actions/deals'
import { initialDealDeskActionState } from '../../app/lib/actions/deal-desk-action-state'

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111'
const DEAL_ID = '33333333-3333-4333-8333-333333333333'
const RAW_DB_TEXT = 'duplicate key value violates unique constraint "accounts_user_id_lower_name_key"'

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

function dbError(table: 'accounts' | 'deals', code: string, message = RAW_DB_TEXT) {
  return new DealDeskDatabaseError(
    'insert',
    table,
    new PostgrestError({ message, details: 'internal detail', hint: '', code }),
  )
}

const ACCOUNT_FK_TEXT =
  'insert or update on table "deals" violates foreign key constraint "deals_account_fkey"'

const VALID_DEAL = {
  accountId: ACCOUNT_ID,
  name: 'Acme 2027',
  dealType: 'new_business',
  stage: 'negotiation',
  arrEur: '60000',
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  guard.requireUser.mockResolvedValue(null)
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.clearAllMocks()
  consoleError.mockRestore()
})

describe('createAccountAction', () => {
  it('refuses a signed-out caller before validating or writing', async () => {
    guard.requireUser.mockResolvedValue({ ok: false, message: 'x', at: 1 })

    const result = await createAccountAction(initialDealDeskActionState, form({ name: '' }))

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/signed in/i)
    expect(result.fieldErrors).toEqual({})
    expect(db.createAccount).not.toHaveBeenCalled()
  })

  it('returns field errors and the typed values without writing', async () => {
    const result = await createAccountAction(
      initialDealDeskActionState,
      form({ name: '', countryCode: 'Germany' }),
    )

    expect(result.ok).toBe(false)
    expect(result.fieldErrors).toHaveProperty('name')
    expect(result.fieldErrors).toHaveProperty('countryCode')
    expect(result.values.countryCode).toBe('Germany')
    expect(db.createAccount).not.toHaveBeenCalled()
  })

  it('creates the account from the parsed input only, then continues to a new deal', async () => {
    db.createAccount.mockResolvedValue({ id: ACCOUNT_ID, name: 'Acme GmbH' })

    await expect(
      createAccountAction(
        initialDealDeskActionState,
        form({ name: ' Acme GmbH ', countryCode: 'de', user_id: 'someone-else' }),
      ),
    ).rejects.toThrow(`NEXT_REDIRECT /workspace/deals/new?accountId=${ACCOUNT_ID}`)

    expect(db.createAccount).toHaveBeenCalledWith({
      name: 'Acme GmbH',
      region: null,
      country_code: 'DE',
      segment: null,
      industry: null,
    })
    expect(cache.revalidatePath).toHaveBeenCalledWith('/workspace')
  })

  it('names a duplicate account without showing the database text', async () => {
    db.createAccount.mockRejectedValue(dbError('accounts', '23505'))

    const result = await createAccountAction(
      initialDealDeskActionState,
      form({ name: 'Acme GmbH' }),
    )

    expect(result.ok).toBe(false)
    expect(result.fieldErrors.name).toMatch(/already have an account/i)
    expect(JSON.stringify(result)).not.toContain(RAW_DB_TEXT)
    expect(JSON.stringify(result)).not.toContain('internal detail')
    expect(consoleError).toHaveBeenCalled()
  })

  it('asks the user to check the details for other rejected input', async () => {
    db.createAccount.mockRejectedValue(dbError('accounts', '23514'))

    const result = await createAccountAction(
      initialDealDeskActionState,
      form({ name: 'Acme GmbH' }),
    )

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/could not be saved with these details/i)
    expect(result.fieldErrors).toEqual({})
    expect(result.values).toMatchObject({ name: 'Acme GmbH' })
    expect(JSON.stringify(result)).not.toContain(RAW_DB_TEXT)
    expect(consoleError).toHaveBeenCalled()
  })

  it('shows a generic message for an unexpected failure and logs it', async () => {
    db.createAccount.mockRejectedValue(new Error('connection reset'))

    const result = await createAccountAction(
      initialDealDeskActionState,
      form({ name: 'Acme GmbH' }),
    )

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/could not create the account/i)
    expect(JSON.stringify(result)).not.toContain('connection reset')
    expect(consoleError).toHaveBeenCalled()
  })
})

describe('createDealAction', () => {
  it('refuses a signed-out caller before validating or writing', async () => {
    guard.requireUser.mockResolvedValue({ ok: false, message: 'x', at: 1 })

    const result = await createDealAction(initialDealDeskActionState, form(VALID_DEAL))

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/signed in/i)
    expect(db.createDeal).not.toHaveBeenCalled()
  })

  it('returns field errors and the typed values without writing', async () => {
    const result = await createDealAction(
      initialDealDeskActionState,
      form({ ...VALID_DEAL, arrEur: '-5', name: 'Kept' }),
    )

    expect(result.ok).toBe(false)
    expect(result.fieldErrors).toHaveProperty('arrEur')
    expect(result.values).toMatchObject({ arrEur: '-5', name: 'Kept' })
    expect(db.createDeal).not.toHaveBeenCalled()
  })

  it('creates the deal from the parsed input only, then opens it', async () => {
    db.createDeal.mockResolvedValue({ id: DEAL_ID })

    await expect(
      createDealAction(
        initialDealDeskActionState,
        form({ ...VALID_DEAL, renewalDate: '2027-03-31', user_id: 'someone-else' }),
      ),
    ).rejects.toThrow(`NEXT_REDIRECT /workspace/deals/${DEAL_ID}`)

    const input = db.createDeal.mock.calls[0][0]
    expect(input).toMatchObject({
      account_id: ACCOUNT_ID,
      name: 'Acme 2027',
      deal_type: 'new_business',
      stage: 'negotiation',
      arr_eur: 60000,
      renewal_date: '2027-03-31',
    })
    expect(input).not.toHaveProperty('user_id')
    expect(cache.revalidatePath).toHaveBeenCalledWith('/workspace')
  })

  it('points at the account field when the account is missing or not yours', async () => {
    db.createDeal.mockRejectedValue(dbError('deals', '23503', ACCOUNT_FK_TEXT))

    const result = await createDealAction(initialDealDeskActionState, form(VALID_DEAL))

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/check the highlighted fields/i)
    expect(result.fieldErrors.accountId).toMatch(/choose one of your accounts/i)
    expect(result.values).toMatchObject({ name: 'Acme 2027' })
    expect(JSON.stringify(result)).not.toContain('deals_account_fkey')
    expect(JSON.stringify(result)).not.toContain('internal detail')
    expect(consoleError).toHaveBeenCalled()
  })

  it('asks the user to check the details for other rejected input', async () => {
    db.createDeal.mockRejectedValue(dbError('deals', '23514'))

    const result = await createDealAction(initialDealDeskActionState, form(VALID_DEAL))

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/could not be saved with these details/i)
    expect(result.fieldErrors).toEqual({})
    expect(JSON.stringify(result)).not.toContain(RAW_DB_TEXT)
    expect(consoleError).toHaveBeenCalled()
  })

  it('shows a generic message for an unexpected failure and logs it', async () => {
    db.createDeal.mockRejectedValue(new Error('connection reset'))

    const result = await createDealAction(initialDealDeskActionState, form(VALID_DEAL))

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/could not create the deal/i)
    expect(JSON.stringify(result)).not.toContain('connection reset')
    expect(consoleError).toHaveBeenCalled()
  })
})
