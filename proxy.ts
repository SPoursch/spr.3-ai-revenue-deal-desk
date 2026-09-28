import { NextResponse, type NextRequest } from 'next/server'

import { buildContentSecurityPolicy } from '@/app/lib/content-security-policy'
import { getProxySupabaseClient } from '@/app/lib/supabase'

/**
 * Session refresh (Part 6).
 *
 * `proxy.ts` is the Next.js 16 name for what earlier versions called
 * `middleware.ts`; it runs before a route is rendered.
 *
 * Its single job here is to keep the auth session alive. Access tokens expire
 * after about an hour, and a Server Component cannot write cookies, so without
 * this the refreshed token would have nowhere to go and the user would be
 * signed out mid-session. Calling `getClaims()` performs the refresh when one
 * is due, and `setAll` writes the new cookies onto the outgoing response.
 *
 * This is deliberately *not* where /workspace is protected. A proxy matcher is
 * a routing rule, and Next.js's own guidance is to verify authentication in
 * the page or layout that renders protected data rather than relying on a
 * matcher that a later refactor could quietly stop covering. That check lives
 * in app/workspace/layout.tsx.
 *
 * It also sets the Content-Security-Policy. The policy carries a fresh nonce
 * per request, so it cannot be a static header in next.config.ts: it is set
 * on the request, where Next.js reads the nonce to stamp its own scripts, and
 * on the response, where the browser enforces it.
 */
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce)

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', contentSecurityPolicy)

  const forward = () => NextResponse.next({ request: { headers: requestHeaders } })

  let response = forward()

  const supabase = getProxySupabaseClient({
    getAll() {
      return request.cookies.getAll()
    },
    setAll(cookiesToSet, headers) {
      // Rebuild the response so the refreshed cookies are attached to both the
      // request passed onward and the response sent back to the browser.
      response = forward()

      for (const { name, value, options } of cookiesToSet) {
        response.cookies.set(name, value, options)
      }

      // The no-cache headers @supabase/ssr sends with refreshed auth cookies
      // (Cache-Control, Expires, Pragma), so a CDN never caches a response
      // that carries one visitor's session and serves it to another.
      for (const [key, value] of Object.entries(headers)) {
        response.headers.set(key, value)
      }
    },
  })

  // Verifies the token signature and refreshes it when it has expired. The
  // result is intentionally unused: this call exists for its cookie writes.
  await supabase.auth.getClaims()

  response.headers.set('Content-Security-Policy', contentSecurityPolicy)

  return response
}

export const config = {
  /*
    Everything except static assets and image files. Those never carry a
    session worth refreshing, and running on them would add a Supabase call to
    each one.
  */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)',
  ],
}
