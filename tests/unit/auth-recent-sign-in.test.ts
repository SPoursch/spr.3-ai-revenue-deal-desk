import { AuthApiError } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `hasRecentSignIn` (security scan M2) and the generic auth failure messages
 * (security scan L4).
 *
 * Supabase Auth is replaced by a stub; the functions under test are the real
 * ones in app/lib/db/auth.ts.
 */

const auth = vi.hoisted(() => ({
  getClaims: vi.fn(),
  signOut: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
}))

vi.mock('../../app/lib/supabase', () => ({
  getSupabaseClient: () => ({ auth }),
}))

import {
  exchangeAuthCode,
  hasRecentSignIn,
  sendPasswordResetEmail,
  signOut,
  updatePassword,
  verifyEmailToken,
} from '../../app/lib/db/auth'

const NOW_SECONDS = 1_800_000_000

function claimsWithAmr(amr: unknown) {
  return { data: { claims: { sub: 'user-1', amr } }, error: null }
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW_SECONDS * 1000)
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
  consoleError.mockRestore()
})

describe('hasRecentSignIn', () => {
  it('accepts a session authenticated within the window', async () => {
    auth.getClaims.mockResolvedValue(
      claimsWithAmr([{ method: 'otp', timestamp: NOW_SECONDS - 120 }]),
    )

    expect(await hasRecentSignIn(600)).toBe(true)
  })

  it('uses the newest authentication when there are several', async () => {
    auth.getClaims.mockResolvedValue(
      claimsWithAmr([
        { method: 'password', timestamp: NOW_SECONDS - 86_400 },
        { method: 'otp', timestamp: NOW_SECONDS - 60 },
      ]),
    )

    expect(await hasRecentSignIn(600)).toBe(true)
  })

  it('rejects an old session, however recently its token was refreshed', async () => {
    auth.getClaims.mockResolvedValue(
      claimsWithAmr([{ method: 'password', timestamp: NOW_SECONDS - 3_600 }]),
    )

    expect(await hasRecentSignIn(600)).toBe(false)
  })

  it.each([
    ['no amr claim', claimsWithAmr(undefined)],
    ['string-only amr entries', claimsWithAmr(['password'])],
    ['no session', { data: null, error: null }],
    ['a verification error', { data: null, error: new AuthApiError('bad', 401, 'bad_jwt') }],
  ])('fails closed on %s', async (_label, response) => {
    auth.getClaims.mockResolvedValue(response)

    expect(await hasRecentSignIn(600)).toBe(false)
  })
})

describe('auth failures never return Supabase error text (L4)', () => {
  const raw = new AuthApiError(
    'Internal detail: rate limit bucket 42 exhausted',
    429,
    'over_request_rate_limit',
  )

  it.each([
    ['signOut', () => signOut(), auth.signOut],
    ['exchangeAuthCode', () => exchangeAuthCode('code'), auth.exchangeCodeForSession],
    [
      'sendPasswordResetEmail',
      () => sendPasswordResetEmail('a@example.com', 'https://x/auth/confirm'),
      auth.resetPasswordForEmail,
    ],
    ['verifyEmailToken', () => verifyEmailToken('hash', 'recovery'), auth.verifyOtp],
    ['updatePassword', () => updatePassword('new password'), auth.updateUser],
  ] as const)('%s returns a generic message and logs the real error', async (_name, call, stub) => {
    stub.mockResolvedValue({ data: {}, error: raw })

    const result = await call()

    expect(result).toEqual({
      ok: false,
      message: 'Something went wrong. Please try again.',
    })
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), raw)
  })
})
