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
 * Environment: `.env.local` (Supabase URL and publishable key) is read with
 * Node's own parser, as in vitest.config.mts, and never printed; values
 * already in the environment win. The test users' credentials in
 * `.env.test.local` are deliberately NOT loaded here: this process starts the
 * dev server (`webServer`), which inherits its environment, and the app has
 * no business holding test passwords. The tests read them on demand through
 * tests/support/env.ts, inside the test workers only.
 *
 * Traces are off: a trace records typed values, including the test password.
 */
if (existsSync('.env.local')) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync('.env.local', 'utf8')))) {
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
