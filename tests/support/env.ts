/**
 * Reads a variable the test run needs, loaded by vitest.config.ts from
 * `.env.local` and `.env.test.local`.
 *
 * The error names the variable and never its value, so a misconfigured run
 * fails loudly without leaking a credential into test output.
 */
export function requireTestEnv(name: string): string {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(
      `Missing test environment variable ${name}. ` +
        `Add it to .env.local (Supabase URL and key) or .env.test.local ` +
        `(test users); both are git-ignored.`,
    )
  }

  return value
}
