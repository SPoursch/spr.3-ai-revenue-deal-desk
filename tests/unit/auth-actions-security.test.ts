import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Security scan findings M1 and M2 in the auth Server Actions.
 *
 * M1: the URLs Supabase redirects back to are built from the fixed canonical
 * origin, never from the request's Origin / Host / X-Forwarded-Proto headers.
 * `next/headers` is mocked to return attacker-chosen values, which must be
 * ignored.
 *
 * M2: a password change needs a recently established session, so a stolen or
 * long-lived session cookie cannot set a new password.
 *
 * The data layer and the auth guard are stubs; the actions are the real ones.
 */

const db = vi.hoisted(() => ({
  hasRecentSignIn: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  signUpWithPassword: vi.fn(),
  startGoogleSignIn: vi.fn(),
  updatePassword: vi.fn(),
}))

const guard = vi.hoisted(() => ({ requireUser: vi.fn() }))

const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`)
  }),
)

vi.mock('../../app/lib/db', () => db)
vi.mock('../../app/lib/actions/require-auth', () => guard)
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({
      origin: 'https://attacker.example',
      host: 'attacker.example',
      'x-forwarded-proto': 'https',
    }),
}))

import {
  requestPasswordResetAction,
  signInWithGoogleAction,
  updatePasswordAction,
} from '../../app/lib/actions/auth'
import { initialNoteActionState } from '../../app/lib/actions/note-action-state'

const APP_URL = 'https://ai-rev-deal-desk.vercel.app'

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

beforeEach(() => {
  guard.requireUser.mockResolvedValue(null)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('redirect URLs (M1)', () => {
  it('sends Google back to the canonical callback, not the request origin', async () => {
    db.startGoogleSignIn.mockResolvedValue({
      url: 'https://accounts.google.com/o/oauth2',
      message: null,
    })

    await expect(signInWithGoogleAction()).rejects.toThrow('NEXT_REDIRECT')

    expect(db.startGoogleSignIn).toHaveBeenCalledWith(`${APP_URL}/auth/callback`)
  })

  it('points the reset email at the canonical confirm route', async () => {
    db.sendPasswordResetEmail.mockResolvedValue({ ok: true, message: null })

    const result = await requestPasswordResetAction(
      initialNoteActionState,
      form({ email: 'someone@example.com' }),
    )

    expect(result.ok).toBe(true)
    expect(db.sendPasswordResetEmail).toHaveBeenCalledWith(
      'someone@example.com',
      `${APP_URL}/auth/confirm`,
    )
  })
})

describe('updatePasswordAction (M2)', () => {
  const newPassword = form({
    password: 'a new password',
    confirmPassword: 'a new password',
  })

  it('refuses a session that was not established recently', async () => {
    db.hasRecentSignIn.mockResolvedValue(false)

    const result = await updatePasswordAction(initialNoteActionState, newPassword)

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/request a new reset link/i)
    expect(db.updatePassword).not.toHaveBeenCalled()
  })

  it('still refuses a request with no verified session, before any other check', async () => {
    guard.requireUser.mockResolvedValue({ ok: false, message: 'x', at: 1 })

    const result = await updatePasswordAction(initialNoteActionState, newPassword)

    expect(result.ok).toBe(false)
    expect(db.hasRecentSignIn).not.toHaveBeenCalled()
    expect(db.updatePassword).not.toHaveBeenCalled()
  })

  it('changes the password for a recent session and goes to the workspace', async () => {
    db.hasRecentSignIn.mockResolvedValue(true)
    db.updatePassword.mockResolvedValue({ ok: true, message: null })

    await expect(
      updatePasswordAction(initialNoteActionState, newPassword),
    ).rejects.toThrow('NEXT_REDIRECT /workspace')

    expect(db.hasRecentSignIn).toHaveBeenCalledWith(600)
    expect(db.updatePassword).toHaveBeenCalledWith('a new password')
  })
})
