import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

/**
 * `.env.test.local`, parsed once and kept in this module only.
 *
 * Vitest already puts these variables into the environment
 * (vitest.config.mts). Playwright deliberately does not, because its runner
 * process also starts the dev server, which would inherit them
 * (playwright.config.ts). So the Playwright tests read the file here, and the
 * values never enter `process.env`.
 */
let testEnvFile: Record<string, string | undefined> | undefined

function readTestEnvFile(name: string): string | undefined {
  testEnvFile ??= existsSync('.env.test.local')
    ? parseEnv(readFileSync('.env.test.local', 'utf8'))
    : {}

  return testEnvFile[name]
}

/**
 * Reads a variable the test run needs: from the environment (vitest.config.mts
 * loads `.env.local` and `.env.test.local`; playwright.config.ts loads
 * `.env.local`), or else from `.env.test.local` directly.
 *
 * The error names the variable and never its value, so a misconfigured run
 * fails loudly without leaking a credential into test output.
 */
export function requireTestEnv(name: string): string {
  const value = (process.env[name] ?? readTestEnvFile(name))?.trim()

  if (!value) {
    throw new Error(
      `Missing test environment variable ${name}. ` +
        `Add it to .env.local (Supabase URL and key) or .env.test.local ` +
        `(test users); both are git-ignored.`,
    )
  }

  return value
}
