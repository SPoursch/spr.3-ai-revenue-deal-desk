import { AuthApiError } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Sign-in and sign-up must never show Supabase Auth's own error text: it can
 * say "User already registered" or "Email not confirmed", which tells anyone
 * which addresses have accounts (security audit W1). The raw error is still
 * logged on the server.
 *
 * Supabase Auth is replaced by a stub, so these tests need no network and can
 * produce each error on demand. Only the client is replaced; the functions
 * under test are the real ones in app/lib/db/auth.ts.
 */

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
}))

vi.mock('../../app/lib/supabase', () => ({
  getSupabaseClient: () => ({ auth }),
}))

// Imported from the module file after vi.mock is registered.
import { signInWithPassword, signUpWithPassword } from '../../app/lib/db/auth'

const EMAIL = 'someone@example.com'
const PASSWORD = 'correct horse battery staple'

function authError(message: string, status: number, code: string) {
  return new AuthApiError(message, status, code)
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.resetAllMocks()
  consoleError.mockRestore()
})

describe('signInWithPassword', () => {
  it.each([
    ['wrong credentials', authError('Invalid login credentials', 400, 'invalid_credentials')],
    ['an unconfirmed address', authError('Email not confirmed', 400, 'email_not_confirmed')],
    ['a rate limit', authError('Request rate limit reached', 429, 'over_request_rate_limit')],
    ['an error without a code', new AuthApiError('Something unexpected', 500, undefined)],
  ])('shows one generic message for %s, and logs the real error', async (_label, error) => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error })

    const result = await signInWithPassword(EMAIL, PASSWORD)

    expect(result).toEqual({
      ok: false,
      message:
        'Could not sign in. Check your email address and password and try again.',
    })
    expect(result.message).not.toContain(error.message)
    expect(consoleError).toHaveBeenCalledWith('[auth] sign-in failed:', error)
  })

  it('succeeds without a message when Supabase accepts the credentials', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { session: {} }, error: null })

    expect(await signInWithPassword(EMAIL, PASSWORD)).toEqual({
      ok: true,
      message: null,
    })
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: EMAIL,
      password: PASSWORD,
    })
  })
})

describe('signUpWithPassword', () => {
  it.each([
    ['an existing account', authError('User already registered', 422, 'user_already_exists')],
    ['an existing email', authError('A user with this email address has already been registered', 422, 'email_exists')],
    ['disabled sign-ups', authError('Signups not allowed for this instance', 422, 'signup_disabled')],
    ['an error without a code', new AuthApiError('Something unexpected', 500, undefined)],
  ])('shows one generic message for %s, and logs the real error', async (_label, error) => {
    auth.signUp.mockResolvedValue({ data: {}, error })

    const result = await signUpWithPassword(EMAIL, PASSWORD)

    expect(result).toEqual({
      ok: false,
      message: 'Could not create the account. Please try again.',
    })
    expect(result.message).not.toContain(error.message)
    expect(consoleError).toHaveBeenCalledWith('[auth] sign-up failed:', error)
  })

  it('names a weak password, which says nothing about the address', async () => {
    auth.signUp.mockResolvedValue({
      data: {},
      error: authError('Password should contain at least one character of each', 422, 'weak_password'),
    })

    expect(await signUpWithPassword(EMAIL, 'password')).toEqual({
      ok: false,
      message: 'That password is too weak. Choose a longer or less common one.',
    })
  })

  it('keeps the confirmation notice when the account needs email confirmation', async () => {
    auth.signUp.mockResolvedValue({ data: { user: {}, session: null }, error: null })

    expect(await signUpWithPassword(EMAIL, PASSWORD)).toEqual({
      ok: false,
      message:
        'Account created. Check your email for a confirmation link, then sign in.',
    })
  })

  it('succeeds without a message when a session is returned', async () => {
    auth.signUp.mockResolvedValue({
      data: { user: {}, session: {} },
      error: null,
    })

    expect(await signUpWithPassword(EMAIL, PASSWORD)).toEqual({
      ok: true,
      message: null,
    })
  })
})
