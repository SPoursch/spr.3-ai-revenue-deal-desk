import { describe, expect, it, vi } from 'vitest'

/**
 * Security scan findings L2 (security headers) and L8 (logging the Google
 * callback's provider error).
 */

vi.mock('@/app/lib/db', () => ({ exchangeAuthCode: vi.fn() }))

import nextConfig from '../../next.config'
import { GET as googleCallback } from '../../app/auth/callback/route'
import { buildContentSecurityPolicy } from '../../app/lib/content-security-policy'

describe('buildContentSecurityPolicy', () => {
  it('allows scripts and styles only by nonce in production', () => {
    const policy = buildContentSecurityPolicy('abc123', false)

    expect(policy).toContain(`script-src 'self' 'nonce-abc123' 'strict-dynamic'`)
    expect(policy).toContain(`style-src 'self' 'nonce-abc123'`)
    expect(policy).not.toContain('unsafe-inline')
    expect(policy).not.toContain('unsafe-eval')
    expect(policy).toContain(`frame-ancestors 'none'`)
    expect(policy).toContain(`object-src 'none'`)
    expect(policy).toContain(`connect-src 'self'`)
    expect(policy).toMatch(/form-action 'self'.* https:\/\/accounts\.google\.com/)
  })

  it('adds the development-only relaxations only in development', () => {
    const policy = buildContentSecurityPolicy('abc123', true)

    expect(policy).toContain(`'unsafe-eval'`)
    expect(policy).not.toContain('upgrade-insecure-requests')
  })
})

describe('next.config.ts', () => {
  it('does not send X-Powered-By', () => {
    expect(nextConfig.poweredByHeader).toBe(false)
  })

  it('sends the static security headers on every path', async () => {
    const rules = (await nextConfig.headers?.()) ?? []
    const everyPath = rules.find((rule) => rule.source === '/:path*')

    expect(everyPath?.headers).toEqual(
      expect.arrayContaining([
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ]),
    )
  })
})

describe('Google callback error logging (L8)', () => {
  it('logs the provider error without control characters and truncated', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const forged = `access_denied\n[auth] forged log line\r\n${'x'.repeat(500)}`

    const response = await googleCallback(
      new Request(
        `https://ai-rev-deal-desk.vercel.app/auth/callback?error_description=${encodeURIComponent(forged)}`,
      ),
    )

    expect(response.headers.get('location')).toBe(
      'https://ai-rev-deal-desk.vercel.app/login?error=google',
    )
    const logged = consoleError.mock.calls[0]?.[1] as string
    expect(logged).not.toMatch(/[\r\n]/)
    expect(logged.startsWith('access_denied [auth] forged log line')).toBe(true)
    expect(logged.length).toBeLessThanOrEqual(200 + ' (truncated)'.length + 1)

    consoleError.mockRestore()
  })
})
