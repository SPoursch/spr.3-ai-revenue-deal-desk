import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for the Deal Desk end-to-end tests.
 *
 * The tests drive the real app in a browser, signed in as the two dedicated
 * test users on the hosted canonical database, exactly as a person would:
 * through the login form, with the publishable key, under row level security.
 * No service-role key and no stored session file are involved.
 *
 * Environment: `.env.local` (Supabase URL and publishable key) and
 * `.env.test.local` (the test users' credentials) are read with Node's own
 * parser, as in vitest.config.mts, and never printed. Values already in the
 * environment win.
 *
 * Traces are off: a trace records typed values, including the test password.
 */
for (const file of ['.env.local', '.env.test.local']) {
  if (!existsSync(file)) continue

  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (value !== undefined && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

const PORT = 3100
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  // The specs share two test users on one database; run them one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
