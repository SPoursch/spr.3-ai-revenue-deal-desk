/**
 * The Content-Security-Policy sent with every page, built per request by
 * proxy.ts around a fresh nonce.
 *
 * Nonce-based, following the Next.js CSP guide
 * (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md):
 * Next.js reads the nonce from the request's CSP header and attaches it to
 * its own scripts and inline styles, so no `'unsafe-inline'` is needed for
 * either in production. `'strict-dynamic'` lets those trusted scripts load the
 * page's chunks.
 *
 * Origins beyond 'self':
 * - img-src: Google profile pictures, shown by UserMenu. Google is the only
 *   identity provider.
 * - form-action: without JavaScript, the Google sign-in form posts to this
 *   app and is redirected on to Supabase Auth and then Google. Browsers apply
 *   form-action to those redirects, so both origins are listed.
 *
 * The browser never calls Supabase directly (every query runs on the server,
 * through app/lib/db), so connect-src stays 'self'.
 *
 * Development only: React needs `'unsafe-eval'` for its debugging features,
 * and the dev overlay injects styles without a nonce. Neither is sent in
 * production.
 */
export function buildContentSecurityPolicy(
  nonce: string,
  isDev = process.env.NODE_ENV === 'development',
): string {
  const supabaseOrigin = readOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL)

  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self' ${isDev ? `'unsafe-inline'` : `'nonce-${nonce}'`}`,
    `img-src 'self' blob: data: https://*.googleusercontent.com`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ''} https://accounts.google.com`,
    `frame-ancestors 'none'`,
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ]

  return directives.join('; ')
}

/** The origin of a configured URL, or null when it is missing or malformed. */
function readOrigin(value: string | undefined): string | null {
  if (!value) return null

  try {
    return new URL(value).origin
  } catch {
    return null
  }
}
