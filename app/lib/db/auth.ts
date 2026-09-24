import { getSupabaseClient } from '../supabase'

/**
 * Authentication (Part 6).
 *
 * Supabase Auth is reached through the data-access layer for the same reason
 * every table is: CLAUDE.md allows exactly one module to touch supabase-js, so
 * no component, route handler or Server Action calls `auth` directly either.
 *
 * Nothing here stores or compares a password. Credentials are forwarded to
 * Supabase Auth, which owns hashing, sessions and tokens. There is no
 * passwords table and no custom session handling.
 *
 * Auth failures are returned rather than thrown. A wrong password is an
 * ordinary outcome that the sign-in form has to render, not an exceptional
 * one, which is the opposite of how the table helpers treat a failed query.
 */

/**
 * The signed-in user, reduced to what the interface actually displays.
 *
 * `name` and `avatarUrl` come from `user_metadata`, which the identity
 * provider fills in (Google supplies both) and which the user can edit. They
 * are therefore safe to *show* and unsafe to *trust*: nothing in this codebase
 * may branch on them for access decisions. Ownership and authorisation use
 * `id`, which is the verified `sub` claim.
 *
 * `provider` comes from `app_metadata`, which the user cannot edit. It is still
 * only used for display here.
 */
export type AuthUser = {
  id: string
  email: string | null
  /** Display name from the identity provider, when it supplied one. */
  name: string | null
  /** Avatar URL from the identity provider, when it supplied one. */
  avatarUrl: string | null
  /** How this session was established, e.g. "google" or "email". */
  provider: string | null
}

/** Reads a claim as a non-empty trimmed string, or null. */
function readStringClaim(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  return trimmed.length > 0 ? trimmed : null
}

/** Outcome of a sign-in, sign-up or sign-out attempt. */
export type AuthResult = {
  ok: boolean
  /** A message safe to show the user; null when `ok` is true. */
  message: string | null
}

/**
 * Returns the signed-in user, or null when nobody is signed in.
 *
 * Uses `getClaims()`, which verifies the token's signature, rather than
 * `getSession()`, which only decodes whatever cookie the browser sent. Session
 * cookies are attacker-supplied input, so a page must not trust one without
 * verification. This is the check that protects /workspace.
 */
export async function getAuthenticatedUser(): Promise<AuthUser | null> {
  const { data, error } = await getSupabaseClient().auth.getClaims()

  if (error || !data?.claims) {
    return null
  }

  const claims = data.claims

  // Both are already inside the verified token, so the profile costs no extra
  // request: no `getUser()` round trip and no profile table to read.
  const userMetadata = (claims.user_metadata ?? {}) as Record<string, unknown>
  const appMetadata = (claims.app_metadata ?? {}) as Record<string, unknown>

  return {
    id: claims.sub,
    email: readStringClaim(claims.email),
    // Google sets `full_name`; some providers only set `name`.
    name:
      readStringClaim(userMetadata.full_name) ??
      readStringClaim(userMetadata.name),
    // Google sets `avatar_url` on some flows and `picture` on others.
    avatarUrl:
      readStringClaim(userMetadata.avatar_url) ??
      readStringClaim(userMetadata.picture),
    provider: readStringClaim(appMetadata.provider),
  }
}

/**
 * Returns the signed-in user's id, throwing when there is no session.
 *
 * This is where ownership comes from for every insert in notespace.ts. The id
 * is read from the verified session, never from a caller argument or a form
 * field, so there is no parameter through which a client could claim to be
 * someone else.
 *
 * Throwing rather than returning null is deliberate: a create that cannot
 * establish an owner must fail, not fall back to an unowned row. The Server
 * Action guards in app/lib/actions/require-auth.ts already reject anonymous
 * callers, so reaching this throw means a write path skipped its guard — which
 * should surface, not pass silently.
 *
 * Exported for the other db/ modules only; index.ts does not re-export it.
 */
export async function requireUserId(): Promise<string> {
  const user = await getAuthenticatedUser()

  if (!user) {
    throw new Error('Cannot write without a signed-in user.')
  }

  return user.id
}

/** Registers a new user with an email address and password. */
export async function signUpWithPassword(
  email: string,
  password: string,
): Promise<AuthResult> {
  const { data, error } = await getSupabaseClient().auth.signUp({
    email,
    password,
  })

  if (error) {
    console.error('[auth] sign-up failed:', error)

    return { ok: false, message: error.message }
  }

  // With "Confirm email" enabled a user row comes back with no session: the
  // account exists but cannot sign in until the emailed link is followed.
  // Reporting that is the difference between a working form and one that
  // silently appears to do nothing.
  if (!data.session) {
    return {
      ok: false,
      message:
        'Account created. Check your email for a confirmation link, then sign in.',
    }
  }

  return { ok: true, message: null }
}

/** Signs an existing user in with an email address and password. */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<AuthResult> {
  const { error } = await getSupabaseClient().auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    console.error('[auth] sign-in failed:', error)

    return { ok: false, message: error.message }
  }

  return { ok: true, message: null }
}

/** Ends the current session and clears its cookies. */
export async function signOut(): Promise<AuthResult> {
  const { error } = await getSupabaseClient().auth.signOut()

  if (error) {
    console.error('[auth] sign-out failed:', error)

    return { ok: false, message: error.message }
  }

  return { ok: true, message: null }
}

/**
 * Starts the Google sign-in flow and returns the URL to send the browser to.
 *
 * Called on the server, `signInWithOAuth` performs no redirect of its own: it
 * builds the provider URL, stores the PKCE verifier in a cookie and hands the
 * URL back. The caller is what redirects. No OAuth request is constructed by
 * hand and no Google credential is ever handled here.
 */
export async function startGoogleSignIn(
  redirectTo: string,
): Promise<{ url: string | null; message: string | null }> {
  const { data, error } = await getSupabaseClient().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  })

  if (error || !data.url) {
    console.error('[auth] Google sign-in could not be started:', error)

    return {
      url: null,
      message: 'Google sign-in is unavailable right now. Please try again.',
    }
  }

  return { url: data.url, message: null }
}

/**
 * Exchanges a PKCE authorization code for a session, which `@supabase/ssr`
 * then writes to cookies.
 *
 * Used by both email-link flows that end in a `?code=` redirect: Google
 * sign-in, and password recovery. The exchange needs the code verifier stored
 * when the flow began, so it only succeeds in the browser that started it.
 */
export async function exchangeAuthCode(code: string): Promise<AuthResult> {
  const { error } = await getSupabaseClient().auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth] code exchange failed:', error)

    return { ok: false, message: error.message }
  }

  return { ok: true, message: null }
}

/**
 * Sends a password-reset email.
 *
 * `redirectTo` is where the emailed link lands once Supabase has verified the
 * token. It is built by the caller from the current request's origin — see
 * `requestOrigin()` in app/lib/actions/auth.ts — so nothing here hardcodes a
 * host, and the flow works unchanged on localhost and anywhere else. The URL
 * must still appear in the Supabase redirect allow-list, which is a dashboard
 * setting.
 *
 * Success is reported the same way whether or not the address has an account.
 * Supabase deliberately does not distinguish the two, and neither does this
 * function: saying "no account with that email" would turn the form into a way
 * of testing which addresses are registered.
 */
export async function sendPasswordResetEmail(
  email: string,
  redirectTo: string,
): Promise<AuthResult> {
  const { error } = await getSupabaseClient().auth.resetPasswordForEmail(
    email,
    { redirectTo },
  )

  if (error) {
    console.error('[auth] password reset email failed:', error)

    return { ok: false, message: error.message }
  }

  return { ok: true, message: null }
}

/**
 * The one-time email token types this application accepts.
 *
 * Supabase supports several (`signup`, `invite`, `magiclink`, `email_change`
 * and more), but only password recovery is implemented here. Narrowing the
 * type means /auth/confirm cannot be turned into a general-purpose token
 * endpoint by putting a different `type` in the query string.
 */
export type EmailTokenType = 'recovery'

/**
 * Verifies a one-time email token and, on success, establishes the session it
 * carries.
 *
 * This is the server-side half of a recovery link. The link carries a
 * `token_hash` rather than a session, so the token is exchanged here and
 * `@supabase/ssr` writes the resulting session to cookies — which is why the
 * caller must be a route handler, the only place cookies can be set.
 */
export async function verifyEmailToken(
  tokenHash: string,
  type: EmailTokenType,
): Promise<AuthResult> {
  const { error } = await getSupabaseClient().auth.verifyOtp({
    token_hash: tokenHash,
    type,
  })

  if (error) {
    console.error('[auth] email token verification failed:', error)

    return { ok: false, message: error.message }
  }

  return { ok: true, message: null }
}

/**
 * Sets a new password for the signed-in user.
 *
 * Authorisation is the session itself: `updateUser` acts on whoever the
 * request's session belongs to, and there is no parameter naming a user, so
 * one account cannot set another's password. The recovery session created by
 * `verifyEmailToken` is what makes this reachable after a reset link, and the
 * calling action additionally verifies the session before getting here.
 *
 * The password is forwarded to Supabase Auth, which owns hashing. Nothing here
 * stores, compares or logs it.
 */
export async function updatePassword(password: string): Promise<AuthResult> {
  const { error } = await getSupabaseClient().auth.updateUser({ password })

  if (error) {
    console.error('[auth] password update failed:', error)

    return { ok: false, message: error.message }
  }

  return { ok: true, message: null }
}
