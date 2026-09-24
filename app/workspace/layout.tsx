import { redirect } from 'next/navigation'

import { getAuthenticatedUser } from '@/app/lib/db'

/**
 * Server-side guard for everything under /workspace (Part 6, requirement 5).
 *
 * A layout is the right place for this because it renders on the server before
 * any page beneath it, and it keeps covering new routes added under
 * /workspace later without each one having to remember its own check.
 *
 * The check is `getAuthenticatedUser`, which verifies the token's signature
 * rather than trusting the session cookie as sent. Nothing here relies on a
 * browser-side check: the redirect happens on the server, so an unauthenticated
 * request never renders the protected page at all, and disabling JavaScript
 * cannot get past it.
 *
 * `force-dynamic` keeps the guard running per request. Without it this subtree
 * could be prerendered at build time, when there is no session to check.
 */
export const dynamic = 'force-dynamic'

export default async function WorkspaceLayout({
  children,
}: LayoutProps<'/workspace'>) {
  const user = await getAuthenticatedUser()

  if (!user) {
    redirect('/login')
  }

  return children
}
