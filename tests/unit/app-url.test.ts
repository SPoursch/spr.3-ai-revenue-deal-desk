import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `readAppUrl()` in app/lib/app-url.ts (security scan M1).
 *
 * The function runs once, when the module loads, and its result is exported
 * as `APP_URL`. Each test therefore sets `APP_URL` in the environment, resets
 * the module registry and imports the module afresh.
 */

const PRODUCTION_APP_URL = 'https://ai-rev-deal-desk.vercel.app'

let consoleError: ReturnType<typeof vi.spyOn>

async function appUrlWith(override: string | undefined): Promise<string> {
  vi.stubEnv('APP_URL', override)
  vi.resetModules()

  const { APP_URL } = await import('../../app/lib/app-url')

  return APP_URL
}

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  consoleError.mockRestore()
})

describe('readAppUrl', () => {
  it('falls back to the production URL when no override is set', async () => {
    expect(await appUrlWith(undefined)).toBe(PRODUCTION_APP_URL)
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('accepts a valid http origin', async () => {
    expect(await appUrlWith('http://localhost:3000')).toBe(
      'http://localhost:3000',
    )
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('accepts a valid https origin, with or without a trailing slash', async () => {
    expect(await appUrlWith('https://staging.example.com')).toBe(
      'https://staging.example.com',
    )
    expect(await appUrlWith('https://staging.example.com/')).toBe(
      'https://staging.example.com',
    )
  })

  it.each(['javascript:alert(1)', 'ftp://example.com', 'file:///etc/passwd'])(
    'rejects the non-http scheme %s and uses production',
    async (override) => {
      expect(await appUrlWith(override)).toBe(PRODUCTION_APP_URL)
      expect(consoleError).toHaveBeenCalledOnce()
    },
  )

  it.each([
    ['not a URL', 'not a url'],
    ['a path', 'https://example.com/auth/callback'],
    ['a query string', 'https://example.com?next=https://evil.example'],
    ['credentials', 'https://user:pass@example.com'],
  ])('rejects a malformed override (%s) and uses production', async (_label, override) => {
    expect(await appUrlWith(override)).toBe(PRODUCTION_APP_URL)
    expect(consoleError).toHaveBeenCalledOnce()
  })
})
