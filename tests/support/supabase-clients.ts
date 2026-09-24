import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '../../app/lib/database.types'
import { requireTestEnv } from './env'

/**
 * Supabase clients for the integration tests, against the hosted canonical
 * database.
 *
 * These deliberately bypass app/lib/supabase.ts: that module is bound to
 * Next.js request cookies (`next/headers`), which do not exist in a test
 * process. Each client here is a plain supabase-js client using the same
 * publishable key as the app, so every query runs as `anon` or as a real
 * signed-in test user and is subject to the same row level security. No
 * service-role key is used, here or anywhere.
 *
 * Sessions are held in memory only for the life of the client; nothing is
 * persisted and no token is refreshed in the background.
 */

export type TestClient = SupabaseClient<Database>

export type TestUserLabel = 'A' | 'B'

export type SignedInTestUser = {
  label: TestUserLabel
  userId: string
  client: TestClient
}

function createTestClient(): TestClient {
  return createClient<Database>(
    requireTestEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireTestEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  )
}

/** A client with no session: every request runs as the `anon` role. */
export function createAnonymousClient(): TestClient {
  return createTestClient()
}

/**
 * Signs in one of the two dedicated test users and returns a client carrying
 * that user's session. The failure message names the user label and the auth
 * error code, never the email or password.
 */
export async function signInTestUser(
  label: TestUserLabel,
): Promise<SignedInTestUser> {
  const client = createTestClient()

  const { data, error } = await client.auth.signInWithPassword({
    email: requireTestEnv(`DEAL_DESK_TEST_USER_${label}_EMAIL`),
    password: requireTestEnv(`DEAL_DESK_TEST_USER_${label}_PASSWORD`),
  })

  if (error || !data.user) {
    throw new Error(
      `Test user ${label} could not sign in ` +
        `(${error?.code ?? error?.status ?? 'no user returned'}).`,
    )
  }

  return { label, userId: data.user.id, client }
}

/**
 * Ends the test user's session on the server. `local` scope revokes only this
 * client's session, not any other session the same user may have open.
 */
export async function signOutTestUser(user: SignedInTestUser): Promise<void> {
  const { error } = await user.client.auth.signOut({ scope: 'local' })

  if (error) {
    throw new Error(
      `Test user ${user.label} could not sign out (${error.code ?? error.status}).`,
    )
  }
}
