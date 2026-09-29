import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { UserMenu } from '@/app/components/UserMenu'
import { getAuthenticatedUser } from '@/app/lib/db'

/**
 * Server-side guard for everything under /workspace (Part 6, requirement 5),
 * and the header every workspace page shares.
 *
 * A layout is the right place for the guard because it renders on the server
 * before any page beneath it, and it keeps covering new routes added under
 * /workspace later without each one having to remember its own check.
 *
 * The check is `getAuthenticatedUser`, which verifies the token's signature
 * rather than trusting the session cookie as sent. Nothing here relies on a
 * browser-side check: the redirect happens on the server, so an unauthenticated
 * request never renders the protected page at all, and disabling JavaScript
 * cannot get past it. Each page repeats the check on purpose: a layout and
 * its page can render concurrently, so this redirect alone does not guarantee
 * a page never renders for a signed-out request.
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

  return (
    <div className="flex min-h-dvh w-full flex-col bg-workspace">
      <header className="sticky top-0 z-40 flex shrink-0 items-center justify-between gap-4 border-b border-border bg-pane/95 px-4 py-2.5 backdrop-blur md:px-6">
        <Link href="/workspace" className="flex min-w-0 items-center gap-3">
          <Image
            src="/salesbound-logo.png"
            alt="SalesBound"
            width={64}
            height={64}
            priority
            className="size-8 shrink-0 rounded-lg object-contain"
          />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold leading-tight tracking-tight">
              SalesBound
            </p>
            <p className="truncate text-[13px] leading-tight text-muted">
              AI Revenue Deal Desk
            </p>
          </div>
        </Link>
        <UserMenu
          email={user.email}
          name={user.name}
          avatarUrl={user.avatarUrl}
          provider={user.provider}
        />
      </header>
      {children}
    </div>
  )
}
