import { NextResponse } from 'next/server'

import { exchangeAuthCode } from '@/app/lib/db'

/**
 * OAuth callback (Part 6).
 *
 * Google sends the browser back here with a one-time authorization code. The
 * code is exchanged for a session server-side, and `@supabase/ssr` writes that
 * session to cookies on this response — which is why the exchange has to
 * happen in a route handler rather than in a Server Component, where cookies
 * cannot be set.
 *
 * No OAuth logic is implemented here: building the provider URL, the PKCE
 * verifier and the token exchange all belong to Supabase Auth. This handler
 * only passes the code along and decides where to send the browser next.
 *
 * The matching dashboard setting is the redirect allow-list, which must
 * contain this route's URL.
 */

/** Where a completed sign-in lands, and where a failed one reports back. */
const WORKSPACE_PATH = '/workspace'
const LOGIN_PATH = '/login'

/** Longest provider-supplied error text that is written to the log. */
const MAX_LOGGED_ERROR_LENGTH = 200

/**
 * Makes a provider-supplied error string safe to log.
 *
 * The value arrives in the query string, so anyone can put anything in it.
 * Control characters (including newlines, which could forge extra log lines)
 * are replaced, and the text is truncated so a crafted URL cannot flood the
 * log. What remains is still enough to tell a cancelled consent screen from a
 * misconfigured provider.
 */
function sanitizeProviderError(value: string): string {
  const printable = value.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim()

  return printable.length > MAX_LOGGED_ERROR_LENGTH
    ? `${printable.slice(0, MAX_LOGGED_ERROR_LENGTH)}… (truncated)`
    : printable
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)

  // Google reports a refusal — a cancelled consent screen, or an account that
  // is not on the test-user list — as an `error` parameter rather than a code.
  const providerError =
    searchParams.get('error_description') ?? searchParams.get('error')

  if (providerError) {
    console.error(
      '[auth] Google returned an error:',
      sanitizeProviderError(providerError),
    )

    return NextResponse.redirect(`${origin}${LOGIN_PATH}?error=google`)
  }

  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(`${origin}${LOGIN_PATH}?error=google`)
  }

  const result = await exchangeAuthCode(code)

  if (!result.ok) {
    return NextResponse.redirect(`${origin}${LOGIN_PATH}?error=google`)
  }

  return NextResponse.redirect(`${origin}${WORKSPACE_PATH}`)
}
