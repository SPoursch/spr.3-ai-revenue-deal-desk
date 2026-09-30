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
  deleteAccount: vi.fn(),
  deleteDeal: vi.fn(),
  getDeal: vi.fn(),
  updateAccount: vi.fn(),
  updateDeal: vi.fn(),
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
  createAccountAction,
  deleteAccountAction,
  updateAccountAction,
} from '../../app/lib/actions/accounts'
import {
  createDealAction,
  createRenewalAction,
  deleteDealAction,
  updateDealAction,
} from '../../app/lib/actions/deals'
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

  it('refuses to create a renewal, which only the renewal flow may do', async () => {
    const result = await createDealAction(
      initialDealDeskActionState,
      form({
        ...VALID_DEAL,
        dealType: 'renewal',
        predecessorDealId: '22222222-2222-4222-8222-222222222222',
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.fieldErrors.dealType).toMatch(/from the deal it renews/i)
    expect(db.createDeal).not.toHaveBeenCalled()
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

const SIGNED_OUT = { ok: false, message: 'x', at: 1 }
const NOT_YOURS = /no longer exists, or it is not one of yours/i

describe('updateDealAction', () => {
  const EDIT = {
    dealId: DEAL_ID,
    name: 'Acme 2027',
    dealType: 'new_business',
    stage: 'contracting',
    arrEur: '75000.50',
  }

  it('refuses a signed-out caller before reading or writing', async () => {
    guard.requireUser.mockResolvedValue(SIGNED_OUT)

    const result = await updateDealAction(initialDealDeskActionState, form(EDIT))

    expect(result.message).toMatch(/signed in/i)
    expect(db.getDeal).not.toHaveBeenCalled()
    expect(db.updateDeal).not.toHaveBeenCalled()
  })

  it('refuses a deal id that is not a uuid without touching the database', async () => {
    const result = await updateDealAction(
      initialDealDeskActionState,
      form({ ...EDIT, dealId: 'x' }),
    )

    expect(result.message).toMatch(NOT_YOURS)
    expect(db.getDeal).not.toHaveBeenCalled()
  })

  it('answers "not found" for a deal that is missing or not yours', async () => {
    db.getDeal.mockResolvedValue(null)

    const result = await updateDealAction(initialDealDeskActionState, form(EDIT))

    expect(result.message).toMatch(NOT_YOURS)
    expect(db.updateDeal).not.toHaveBeenCalled()
  })

  it('returns field errors and the typed values without writing', async () => {
    db.getDeal.mockResolvedValue({ id: DEAL_ID, predecessor_deal_id: null })

    const result = await updateDealAction(
      initialDealDeskActionState,
      form({ ...EDIT, dealType: 'renewal', arrEur: '-1' }),
    )

    expect(result.fieldErrors).toHaveProperty('dealType')
    expect(result.fieldErrors).toHaveProperty('arrEur')
    expect(result.values).toMatchObject({ arrEur: '-1' })
    expect(db.updateDeal).not.toHaveBeenCalled()
  })

  it('updates only the editable fields, then opens the deal', async () => {
    db.getDeal.mockResolvedValue({ id: DEAL_ID, predecessor_deal_id: null })
    db.updateDeal.mockResolvedValue({ id: DEAL_ID })

    await expect(
      updateDealAction(
        initialDealDeskActionState,
        form({ ...EDIT, accountId: ACCOUNT_ID, user_id: 'someone-else' }),
      ),
    ).rejects.toThrow(`NEXT_REDIRECT /workspace/deals/${DEAL_ID}`)

    const [id, patch] = db.updateDeal.mock.calls[0]
    expect(id).toBe(DEAL_ID)
    expect(patch).toMatchObject({ stage: 'contracting', arr_eur: 75000.5 })
    for (const key of ['account_id', 'predecessor_deal_id', 'user_id']) {
      expect(patch).not.toHaveProperty(key)
    }
    expect(cache.revalidatePath).toHaveBeenCalledWith('/workspace', 'layout')
  })

  it('shows a safe message when the update fails, and logs it', async () => {
    db.getDeal.mockResolvedValue({ id: DEAL_ID, predecessor_deal_id: null })
    db.updateDeal.mockRejectedValue(new Error('connection reset'))

    const result = await updateDealAction(initialDealDeskActionState, form(EDIT))

    expect(result.message).toMatch(/could not save the deal/i)
    expect(JSON.stringify(result)).not.toContain('connection reset')
    expect(consoleError).toHaveBeenCalled()
  })
})

describe('createRenewalAction', () => {
  const PREDECESSOR_ID = '22222222-2222-4222-8222-222222222222'
  const PREDECESSOR = {
    id: PREDECESSOR_ID,
    account_id: ACCOUNT_ID,
    deal_type: 'new_business',
    predecessor_deal_id: null,
  }
  const RENEWAL = {
    predecessorDealId: PREDECESSOR_ID,
    name: 'Acme 2028',
    stage: 'discovery',
    arrEur: '66000',
  }

  it('refuses a signed-out caller before reading or writing', async () => {
    guard.requireUser.mockResolvedValue(SIGNED_OUT)

    const result = await createRenewalAction(initialDealDeskActionState, form(RENEWAL))

    expect(result.message).toMatch(/signed in/i)
    expect(db.getDeal).not.toHaveBeenCalled()
    expect(db.createDeal).not.toHaveBeenCalled()
  })

  it('refuses a predecessor id that is not a uuid without touching the database', async () => {
    const result = await createRenewalAction(
      initialDealDeskActionState,
      form({ ...RENEWAL, predecessorDealId: 'x' }),
    )

    expect(result.message).toMatch(NOT_YOURS)
    expect(db.getDeal).not.toHaveBeenCalled()
    expect(db.createDeal).not.toHaveBeenCalled()
  })

  it('returns field errors and the typed values without writing', async () => {
    const result = await createRenewalAction(
      initialDealDeskActionState,
      form({ ...RENEWAL, arrEur: '-1', name: 'Kept' }),
    )

    expect(result.fieldErrors).toHaveProperty('arrEur')
    expect(result.values).toMatchObject({ arrEur: '-1', name: 'Kept' })
    expect(db.createDeal).not.toHaveBeenCalled()
  })

  it('answers "not found" for a predecessor that is missing or not yours', async () => {
    db.getDeal.mockResolvedValue(null)

    const result = await createRenewalAction(initialDealDeskActionState, form(RENEWAL))

    expect(db.getDeal).toHaveBeenCalledWith(PREDECESSOR_ID)
    expect(result.message).toMatch(NOT_YOURS)
    expect(db.createDeal).not.toHaveBeenCalled()
  })

  it("creates a renewal on the predecessor's account, whatever the form says, then opens it", async () => {
    const OTHER_ACCOUNT_ID = '44444444-4444-4444-8444-444444444444'
    db.getDeal.mockResolvedValue(PREDECESSOR)
    db.createDeal.mockResolvedValue({ id: DEAL_ID })

    await expect(
      createRenewalAction(
        initialDealDeskActionState,
        form({
          ...RENEWAL,
          dealType: 'new_business',
          accountId: OTHER_ACCOUNT_ID,
          user_id: 'someone-else',
        }),
      ),
    ).rejects.toThrow(`NEXT_REDIRECT /workspace/deals/${DEAL_ID}`)

    const input = db.createDeal.mock.calls[0][0]
    expect(input).toMatchObject({
      account_id: ACCOUNT_ID,
      predecessor_deal_id: PREDECESSOR_ID,
      deal_type: 'renewal',
      name: 'Acme 2028',
      stage: 'discovery',
      arr_eur: 66000,
    })
    expect(input).not.toHaveProperty('user_id')
    expect(cache.revalidatePath).toHaveBeenCalledWith('/workspace', 'layout')
  })

  it('asks the user to check the details for rejected input', async () => {
    db.getDeal.mockResolvedValue(PREDECESSOR)
    db.createDeal.mockRejectedValue(dbError('deals', '23514'))

    const result = await createRenewalAction(initialDealDeskActionState, form(RENEWAL))

    expect(result.message).toMatch(/could not be saved with these details/i)
    expect(result.values).toMatchObject({ name: 'Acme 2028' })
    expect(JSON.stringify(result)).not.toContain(RAW_DB_TEXT)
    expect(consoleError).toHaveBeenCalled()
  })

  it('shows a generic message for an unexpected failure and logs it', async () => {
    db.getDeal.mockResolvedValue(PREDECESSOR)
    db.createDeal.mockRejectedValue(new Error('connection reset'))

    const result = await createRenewalAction(initialDealDeskActionState, form(RENEWAL))

    expect(result.message).toMatch(/could not create the renewal/i)
    expect(JSON.stringify(result)).not.toContain('connection reset')
    expect(consoleError).toHaveBeenCalled()
  })
})

describe('deleteDealAction', () => {
  it('refuses a signed-out caller before deleting', async () => {
    guard.requireUser.mockResolvedValue(SIGNED_OUT)

    const result = await deleteDealAction(initialDealDeskActionState, form({ dealId: DEAL_ID }))

    expect(result.message).toMatch(/signed in/i)
    expect(db.deleteDeal).not.toHaveBeenCalled()
  })

  it('refuses a deal id that is not a uuid', async () => {
    const result = await deleteDealAction(initialDealDeskActionState, form({ dealId: 'x' }))

    expect(result.message).toMatch(NOT_YOURS)
    expect(db.deleteDeal).not.toHaveBeenCalled()
  })

  it('answers "not found" when nothing was deleted', async () => {
    db.deleteDeal.mockResolvedValue(null)

    const result = await deleteDealAction(initialDealDeskActionState, form({ dealId: DEAL_ID }))

    expect(result.message).toMatch(NOT_YOURS)
  })

  it('explains that a linked renewal blocks the delete', async () => {
    db.deleteDeal.mockRejectedValue(dbError('deals', '23514'))

    const result = await deleteDealAction(initialDealDeskActionState, form({ dealId: DEAL_ID }))

    expect(result.message).toMatch(/renewal is linked/i)
    expect(JSON.stringify(result)).not.toContain(RAW_DB_TEXT)
    expect(consoleError).toHaveBeenCalled()
  })

  it('deletes the deal, then returns to the list', async () => {
    db.deleteDeal.mockResolvedValue({ id: DEAL_ID })

    await expect(
      deleteDealAction(initialDealDeskActionState, form({ dealId: DEAL_ID })),
    ).rejects.toThrow('NEXT_REDIRECT /workspace')

    expect(db.deleteDeal).toHaveBeenCalledWith(DEAL_ID)
    expect(cache.revalidatePath).toHaveBeenCalledWith('/workspace', 'layout')
  })
})

describe('updateAccountAction', () => {
  it('refuses a signed-out caller before writing', async () => {
    guard.requireUser.mockResolvedValue(SIGNED_OUT)

    const result = await updateAccountAction(
      initialDealDeskActionState,
      form({ accountId: ACCOUNT_ID, name: 'Acme' }),
    )

    expect(result.message).toMatch(/signed in/i)
    expect(db.updateAccount).not.toHaveBeenCalled()
  })

  it('refuses a bad account id and invalid input without writing', async () => {
    const badId = await updateAccountAction(
      initialDealDeskActionState,
      form({ accountId: 'x', name: 'Acme' }),
    )
    const invalid = await updateAccountAction(
      initialDealDeskActionState,
      form({ accountId: ACCOUNT_ID, name: '' }),
    )

    expect(badId.message).toMatch(NOT_YOURS)
    expect(invalid.fieldErrors).toHaveProperty('name')
    expect(db.updateAccount).not.toHaveBeenCalled()
  })

  it('answers "not found" for an account that is missing or not yours', async () => {
    db.updateAccount.mockResolvedValue(null)

    const result = await updateAccountAction(
      initialDealDeskActionState,
      form({ accountId: ACCOUNT_ID, name: 'Acme' }),
    )

    expect(result.message).toMatch(NOT_YOURS)
  })

  it('names a duplicate account without showing the database text', async () => {
    db.updateAccount.mockRejectedValue(dbError('accounts', '23505'))

    const result = await updateAccountAction(
      initialDealDeskActionState,
      form({ accountId: ACCOUNT_ID, name: 'Acme' }),
    )

    expect(result.fieldErrors.name).toMatch(/already have an account/i)
    expect(JSON.stringify(result)).not.toContain(RAW_DB_TEXT)
  })

  it('updates from the parsed input only, then returns to the accounts', async () => {
    db.updateAccount.mockResolvedValue({ id: ACCOUNT_ID })

    await expect(
      updateAccountAction(
        initialDealDeskActionState,
        form({ accountId: ACCOUNT_ID, name: ' Acme AG ', user_id: 'someone-else' }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT /workspace/accounts')

    expect(db.updateAccount).toHaveBeenCalledWith(ACCOUNT_ID, {
      name: 'Acme AG',
      region: null,
      country_code: null,
      segment: null,
      industry: null,
    })
  })
})

describe('deleteAccountAction', () => {
  it('refuses a signed-out caller before deleting', async () => {
    guard.requireUser.mockResolvedValue(SIGNED_OUT)

    const result = await deleteAccountAction(
      initialDealDeskActionState,
      form({ accountId: ACCOUNT_ID }),
    )

    expect(result.message).toMatch(/signed in/i)
    expect(db.deleteAccount).not.toHaveBeenCalled()
  })

  it('refuses an account id that is not a uuid', async () => {
    const result = await deleteAccountAction(
      initialDealDeskActionState,
      form({ accountId: 'x' }),
    )

    expect(result.message).toMatch(NOT_YOURS)
    expect(db.deleteAccount).not.toHaveBeenCalled()
  })

  it('answers "not found" when nothing was deleted', async () => {
    db.deleteAccount.mockResolvedValue(null)

    const result = await deleteAccountAction(
      initialDealDeskActionState,
      form({ accountId: ACCOUNT_ID }),
    )

    expect(result.message).toMatch(NOT_YOURS)
  })

  it('explains that a renewal on another account blocks the delete', async () => {
    db.deleteAccount.mockRejectedValue(dbError('accounts', '23514'))

    const result = await deleteAccountAction(
      initialDealDeskActionState,
      form({ accountId: ACCOUNT_ID }),
    )

    expect(result.message).toMatch(/renewal on another account/i)
    expect(JSON.stringify(result)).not.toContain(RAW_DB_TEXT)
  })

  it('deletes the account, then returns to the accounts', async () => {
    db.deleteAccount.mockResolvedValue({ id: ACCOUNT_ID })

    await expect(
      deleteAccountAction(initialDealDeskActionState, form({ accountId: ACCOUNT_ID })),
    ).rejects.toThrow('NEXT_REDIRECT /workspace/accounts')

    expect(db.deleteAccount).toHaveBeenCalledWith(ACCOUNT_ID)
  })
})
