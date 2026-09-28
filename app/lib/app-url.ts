/**
 * The canonical origin of the application, used to build every URL Supabase
 * Auth redirects the browser back to (the Google callback and the password
 * reset link). Imported only by server code.
 *
 * It is fixed on the server rather than read from the request's `Origin`,
 * `Host` or `X-Forwarded-Proto` headers, which the client controls: a
 * redirect target derived from them could point an OAuth code or a recovery
 * link at a host the attacker chose, and would depend entirely on the
 * Supabase redirect allow-list to stop it.
 *
 * `APP_URL` is an optional, server-only override for a different fixed
 * deployment, such as `http://localhost:3000` in development. It is set per
 * environment, never per request, and must be a bare http(s) origin; anything
 * else falls back to production. It must still be on the Supabase redirect
 * allow-list.
 */
const PRODUCTION_APP_URL = 'https://ai-rev-deal-desk.vercel.app'

function readAppUrl(): string {
  const override = process.env.APP_URL

  if (!override) {
    return PRODUCTION_APP_URL
  }

  try {
    const url = new URL(override)
    const isBareOrigin =
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.origin === override.replace(/\/$/, '')

    if (isBareOrigin) {
      return url.origin
    }
  } catch {
    // Not a URL at all; reported below.
  }

  console.error('[app-url] APP_URL is not a bare http(s) origin; using production.')

  return PRODUCTION_APP_URL
}

export const APP_URL = readAppUrl()
