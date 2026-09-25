import {
  createServerClient,
  type CookieMethodsServer,
} from '@supabase/ssr'
import { type SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

import type { Database } from './database.types'

/**
 * Supabase client wiring.
 *
 * This module owns client construction only. All application reads and writes
 * go through the centralised data-access layer (app/lib/db.ts), which is the
 * only module that should import from here.
 *
 * Credentials come from environment variables (see .env.local.example).
 * Never hard-code a project URL or key.
 *
 * Part 6 note: clients are built with `@supabase/ssr` rather than plain
 * `createClient`, because the auth session lives in cookies and has to be read
 * and written per request. The publishable key is the only key used, so
 * nothing here is privileged — row level security is what restricts access.
 */

const SUPABASE_URL_VAR = 'NEXT_PUBLIC_SUPABASE_URL'
const SUPABASE_KEY_VAR = 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'

function readRequiredEnv(name: string, value: string | undefined): string {
  const trimmed = value?.trim()

  if (!trimmed) {
    throw new Error(
      `Missing environment variable ${name}. ` +
        `Add it to .env.local as "${name}=<value>" (see .env.local.example), ` +
        `then restart the dev server so Next.js reloads the file.`,
    )
  }

  return trimmed
}

/** The two credentials, read and validated together. */
function readCredentials(): { url: string; key: string } {
  return {
    url: readRequiredEnv(
      SUPABASE_URL_VAR,
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    key: readRequiredEnv(
      SUPABASE_KEY_VAR,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
  }
}

/**
 * Builds a Supabase client bound to whichever cookie store is supplied.
 *
 * Shared by the request-scoped client below and by the proxy, so that the
 * credential reading and the client options exist in exactly one place.
 */
function createClientWithCookies(
  cookieMethods: CookieMethodsServer,
): SupabaseClient<Database> {
  const { url, key } = readCredentials()

  return createServerClient<Database>(url, key, { cookies: cookieMethods })
}

/**
 * Returns a Supabase client for the current server request.
 *
 * A new client is built per call rather than cached in a module variable. A
 * cached client would be shared by every concurrent request on the server and
 * would therefore carry one visitor's session into another visitor's request.
 * `@supabase/ssr` states the same rule: never share a client across requests.
 *
 * The cookie accessors are async because `next/headers` `cookies()` is async
 * from Next.js 15 on. `@supabase/ssr` awaits them, so this function itself
 * stays synchronous and every existing call site in app/lib/db.ts is unchanged.
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  return createClientWithCookies({
    async getAll() {
      return (await cookies()).getAll()
    },
    async setAll(cookiesToSet) {
      try {
        const store = await cookies()

        for (const { name, value, options } of cookiesToSet) {
          store.set(name, value, options)
        }
      } catch {
        // Server Components may not set cookies. This is expected and safe:
        // the proxy (proxy.ts) refreshes the session on every matched request,
        // so a refreshed token is still written back to the browser there.
      }
    },
  })
}

/**
 * Returns a Supabase client for use inside the proxy, wired to that request's
 * cookies and its outgoing response.
 *
 * Exported so proxy.ts does not have to import `@supabase/ssr` itself, keeping
 * client construction in this module as CLAUDE.md requires.
 */
export function getProxySupabaseClient(
  cookieMethods: CookieMethodsServer,
): SupabaseClient<Database> {
  return createClientWithCookies(cookieMethods)
}

/**
 * Reports whether both Supabase environment variables are present, without
 * constructing a client or exposing their values. Useful for diagnostics.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim(),
  )
}
