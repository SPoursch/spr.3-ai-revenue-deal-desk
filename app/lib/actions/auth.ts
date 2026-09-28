'use server'

import { redirect } from 'next/navigation'

import { APP_URL } from '../app-url'
import {
  hasRecentSignIn,
  sendPasswordResetEmail,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  startGoogleSignIn,
  updatePassword,
} from '../db'
import { failure, success, type NoteActionState } from './note-action-state'
import { requireUser } from './require-auth'

/**
 * Server Actions for authentication (Part 6).
 *
 * These mirror the other action modules: they own input validation and the
 * mapping from a failure to a user-safe message, and they never touch
 * supabase-js. Every call is delegated to app/lib/db.ts, per CLAUDE.md.
 *
 * A Server Action is a public POST endpoint, so all input is treated as
 * untrusted. Passwords are forwarded to Supabase Auth and never stored,
 * logged or compared here.
 */

/** Where a signed-in user lands, and where a signed-out one is sent. */
const WORKSPACE_PATH = '/workspace'
const LOGIN_PATH = '/login'

/**
 * Where Supabase sends the browser after verifying a reset link.
 *
 * Deliberately bare, with no query string of its own: Supabase appends the
 * result of the verification to this URL, and a URL that already carries
 * parameters is one more thing that has to merge correctly. The confirm route
 * knows its own default destination, so nothing needs passing here. It also
 * means the value matches the Supabase redirect allow-list entry exactly.
 */
const CONFIRM_PATH = '/auth/confirm'

/** Supabase Auth's own minimum. Rejecting shorter input here saves a round trip. */
const MIN_PASSWORD_LENGTH = 6

/**
 * How recently the session must have been established for a password change.
 * Long enough to follow a reset link and type a new password, short enough
 * that an old or stolen session cannot be used.
 */
const RECENT_SIGN_IN_SECONDS = 10 * 60

type Credentials = { email: string; password: string }

/**
 * Reads and validates the two credential fields.
 *
 * The email is only checked for the shape of an address; Supabase Auth is the
 * authority on whether it is deliverable or already registered.
 */
function readCredentials(
  formData: FormData,
): { ok: true; value: Credentials } | { ok: false; message: string } {
  const rawEmail = formData.get('email')
  const rawPassword = formData.get('password')

  if (typeof rawEmail !== 'string' || typeof rawPassword !== 'string') {
    return { ok: false, message: 'Enter an email address and a password.' }
  }

  const email = rawEmail.trim()

  if (email.length === 0) {
    return { ok: false, message: 'Enter your email address.' }
  }

  if (!email.includes('@') || email.length > 320) {
    return { ok: false, message: 'Enter a valid email address.' }
  }

  // Not trimmed: spaces are legitimate password characters, and trimming would
  // silently change what the user typed.
  if (rawPassword.length === 0) {
    return { ok: false, message: 'Enter your password.' }
  }

  return { ok: true, value: { email, password: rawPassword } }
}

/**
 * Signs in with an email address and password, then sends the user to the
 * workspace.
 *
 * `redirect` throws the framework's navigation signal, so it is called after
 * the sign-in has succeeded and outside any try/catch.
 */
export async function signInAction(
  _state: NoteActionState,
  formData: FormData,
): Promise<NoteActionState> {
  const parsed = readCredentials(formData)

  if (!parsed.ok) {
    return failure(parsed.message)
  }

  const result = await signInWithPassword(
    parsed.value.email,
    parsed.value.password,
  )

  if (!result.ok) {
    return failure(result.message ?? 'Could not sign in. Please try again.')
  }

  redirect(WORKSPACE_PATH)
}

/**
 * Registers a new account.
 *
 * When the project has email confirmation switched on, sign-up returns no
 * session; that case arrives here as a failed result carrying an explanatory
 * message, and the user stays on the form rather than being redirected to a
 * workspace they cannot yet reach.
 */
export async function signUpAction(
  _state: NoteActionState,
  formData: FormData,
): Promise<NoteActionState> {
  const parsed = readCredentials(formData)

  if (!parsed.ok) {
    return failure(parsed.message)
  }

  if (parsed.value.password.length < MIN_PASSWORD_LENGTH) {
    return failure(
      `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
    )
  }

  const result = await signUpWithPassword(
    parsed.value.email,
    parsed.value.password,
  )

  if (!result.ok) {
    return failure(result.message ?? 'Could not create the account.')
  }

  redirect(WORKSPACE_PATH)
}

/** Ends the session and returns to the login page. */
export async function signOutAction(): Promise<void> {
  await signOut()

  redirect(LOGIN_PATH)
}

/**
 * Begins Google sign-in by redirecting to the provider.
 *
 * The callback URL is built from the fixed canonical origin in
 * app/lib/app-url.ts, never from request headers. It must still be listed in
 * the Supabase redirect allow-list, which is a dashboard setting.
 */
export async function signInWithGoogleAction(): Promise<NoteActionState> {
  const { url, message } = await startGoogleSignIn(`${APP_URL}/auth/callback`)

  if (!url) {
    return failure(message ?? 'Google sign-in is unavailable right now.')
  }

  redirect(url)
}

/**
 * Sends a password-reset email.
 *
 * Reports the same success whether or not the address has an account. Telling
 * the user "no account with that email" would make this form a way of testing
 * which addresses are registered, so the outcome is deliberately identical.
 * A genuine failure to *send* is still reported, since that is about the
 * service rather than about the address.
 *
 * The link Supabase emails points at /auth/confirm, which verifies the token
 * and forwards to the page that collects the new password.
 */
export async function requestPasswordResetAction(
  _state: NoteActionState,
  formData: FormData,
): Promise<NoteActionState> {
  const raw = formData.get('email')

  if (typeof raw !== 'string') {
    return failure('Enter your email address.')
  }

  const email = raw.trim()

  if (email.length === 0) {
    return failure('Enter your email address.')
  }

  if (!email.includes('@') || email.length > 320) {
    return failure('Enter a valid email address.')
  }

  const result = await sendPasswordResetEmail(email, `${APP_URL}${CONFIRM_PATH}`)

  if (!result.ok) {
    // The underlying message is logged in app/lib/db.ts, not shown: a raw
    // Supabase error can name rate limits or delivery internals.
    return failure('Could not send the reset email. Please try again.')
  }

  return success()
}

/**
 * Sets a new password for the user the current session belongs to.
 *
 * Authorisation is the session, checked two ways. `requireUser()` verifies the
 * token's signature before anything else, so an unauthenticated POST to this
 * action is rejected outright rather than reaching Supabase. Beyond that,
 * `updateUser` acts only on the session's own user and takes no user id, so
 * even a valid session cannot change someone else's password.
 *
 * Reaching here normally means /auth/confirm has just verified a recovery
 * token and established the session it carried. A signed-in user changing
 * their own password uses the same path.
 *
 * The underlying enforcement against a stolen session changing the password
 * is Supabase Auth's "Secure password change" setting, enabled on the hosted
 * gtm-stack-fit project: Supabase itself refuses the update unless the user
 * signed in recently or reauthenticated.
 *
 * The recent-sign-in check here (`hasRecentSignIn`) is an additional defence
 * layer, not a replacement for that setting. It rejects old sessions before
 * the request reaches Supabase, with a stricter window, and keeps the action
 * safe if the dashboard setting is ever switched off. It does not on its own
 * rule out account takeover: a session stolen within the window still passes.
 */
export async function updatePasswordAction(
  _state: NoteActionState,
  formData: FormData,
): Promise<NoteActionState> {
  const denied = await requireUser()

  if (denied) {
    return failure(
      'That reset link is no longer valid. Request a new one and try again.',
    )
  }

  if (!(await hasRecentSignIn(RECENT_SIGN_IN_SECONDS))) {
    return failure(
      'For your security, request a new reset link and set your password from it.',
    )
  }

  const raw = formData.get('password')

  if (typeof raw !== 'string' || raw.length === 0) {
    return failure('Enter a new password.')
  }

  // Not trimmed: spaces are legitimate password characters, and trimming would
  // silently change what the user typed.
  if (raw.length < MIN_PASSWORD_LENGTH) {
    return failure(
      `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
    )
  }

  const confirmation = formData.get('confirmPassword')

  if (typeof confirmation === 'string' && confirmation !== raw) {
    return failure('Those passwords do not match.')
  }

  const result = await updatePassword(raw)

  if (!result.ok) {
    // The underlying message is logged server-side in app/lib/db.ts rather
    // than shown: Supabase's text here can describe rate limits and password
    // policy internals.
    return failure('Could not update the password. Please try again.')
  }

  redirect(WORKSPACE_PATH)
}
