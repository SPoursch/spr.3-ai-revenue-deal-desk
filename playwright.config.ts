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

/**
 * Feature 6: the Copilot never reaches the real model provider in these
 * tests. A local fake (tests/support/fake-openrouter.mjs) runs on
 * 127.0.0.1, and the dev server is pointed at it with a fake key and model.
 * These values are set here, for the dev server only, so they win over any
 * real key in `.env.local`. The app honours the base-URL override only
 * outside production and never on Vercel (app/lib/ai/provider-config.ts).
 */
const FAKE_PROVIDER_PORT = 4010
const FAKE_PROVIDER_URL = `http://127.0.0.1:${FAKE_PROVIDER_PORT}`
const COPILOT_TEST_ENV = {
  COPILOT_PROVIDER_BASE_URL: `${FAKE_PROVIDER_URL}/api/v1`,
  OPENROUTER_API_KEY: 'e2e-fake-key',
  OPENROUTER_MODEL: 'fake/copilot-model',
}

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
  webServer: [
    {
      command: 'node tests/support/fake-openrouter.mjs',
      url: `${FAKE_PROVIDER_URL}/__health`,
      env: { FAKE_OPENROUTER_PORT: String(FAKE_PROVIDER_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `npm run dev -- --port ${PORT}`,
      url: `${BASE_URL}/login`,
      env: COPILOT_TEST_ENV,
      // Never reuse a dev server already on this port: it would lack the fake
      // provider settings above and could reach the real one. A busy port
      // fails the run instead.
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
