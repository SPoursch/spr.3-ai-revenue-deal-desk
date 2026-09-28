import type { CookieMethodsServer } from '@supabase/ssr'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * When the proxy refreshes the session, @supabase/ssr hands `setAll` the new
 * auth cookies together with no-cache headers (Cache-Control, Expires,
 * Pragma). Both must reach the response: without the headers a CDN could
 * cache a response carrying one visitor's session cookie and serve it to the
 * next visitor (security audit M4).
 *
 * The Supabase client is replaced by a stub whose `getClaims()` does what a
 * real refresh does — call `setAll(cookies, headers)` — so the proxy itself
 * runs unchanged and no network or credentials are needed.
 */

// What @supabase/ssr 0.12 passes to setAll when it writes auth cookies.
const NO_CACHE_HEADERS = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
  Expires: '0',
  Pragma: 'no-cache',
}

const REFRESHED_COOKIE = {
  name: 'sb-test-auth-token',
  value: 'refreshed-session',
  options: { path: '/', httpOnly: true, sameSite: 'lax' as const },
}

const refresh = vi.hoisted(() => ({ happens: false }))

vi.mock('@/app/lib/supabase', () => ({
  getProxySupabaseClient: (cookies: CookieMethodsServer) => ({
    auth: {
      async getClaims() {
        if (refresh.happens) {
          await cookies.setAll?.([REFRESHED_COOKIE], NO_CACHE_HEADERS)
        }
        return { data: null, error: null }
      },
    },
  }),
}))

// Imported after vi.mock is registered (vi.mock is hoisted above imports).
import { proxy } from '../../proxy'

function workspaceRequest() {
  return new NextRequest('https://deal-desk.example/workspace')
}

beforeEach(() => {
  refresh.happens = false
})

describe('proxy session refresh', () => {
  it('sets the refreshed cookie and the no-cache headers on the response', async () => {
    refresh.happens = true

    const response = await proxy(workspaceRequest())

    expect(response.cookies.get(REFRESHED_COOKIE.name)?.value).toBe(
      REFRESHED_COOKIE.value,
    )
    for (const [key, value] of Object.entries(NO_CACHE_HEADERS)) {
      expect(response.headers.get(key)).toBe(value)
    }
  })

  it('adds no cookie and no cache headers when nothing was refreshed', async () => {
    const response = await proxy(workspaceRequest())

    expect(response.cookies.getAll()).toEqual([])
    for (const key of Object.keys(NO_CACHE_HEADERS)) {
      expect(response.headers.get(key)).toBeNull()
    }
  })
})
