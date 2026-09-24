import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { defineConfig } from 'vitest/config'

/**
 * Vitest configuration for the Sprint 3 test suites.
 *
 * Tests run in Node, not a browser environment: nothing here renders React,
 * and the integration tests talk to the hosted canonical Supabase project
 * directly. UI behaviour is tested end to end with Playwright, not here.
 *
 * Environment: `.env.local` supplies the Supabase URL and publishable key,
 * `.env.test.local` the two test users' credentials. Both are git-ignored and
 * are read with Node's own parser, so no values are ever written into this
 * file. A missing file is tolerated here; `tests/support/env.ts` reports the
 * missing variable by name when a test needs it.
 */
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}

  return Object.fromEntries(
    Object.entries(parseEnv(readFileSync(path, 'utf8'))).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      ...readEnvFile('.env.local'),
      ...readEnvFile('.env.test.local'),
    },
    // The integration tests make real network calls to hosted Supabase.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
