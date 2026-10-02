import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { UserMenu } from '@/app/components/UserMenu'
import { WorkspaceNav } from '@/app/components/deal-desk/WorkspaceNav'
import { getAuthenticatedUser } from '@/app/lib/db'

/**
 * Server-side guard for everything under /workspace (Part 6, requirement 5),
 * and the application shell every workspace page shares: the top bar (brand,
 * search slot, user menu), the navigation rail and the content frame. Each
 * page renders its own <main> inside the frame; the shell adds none.
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
      <a
        href="#workspace-content"
        className="sr-only z-50 rounded-[var(--radius-control)] bg-primary px-3 py-2 text-[14px] font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-4 border-b border-border bg-pane px-4 md:px-6">
        {/* The brand column lines up with the navigation rail below it. */}
        <Link href="/workspace" className="flex min-w-0 items-center gap-2.5 lg:w-[13.25rem]">
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
            <p className="hidden truncate text-[12px] leading-tight text-muted sm:block">
              AI Revenue Deal Desk
            </p>
          </div>
        </Link>

        <div className="flex min-w-0 flex-1 justify-center">
          <SearchSlot />
        </div>

        <UserMenu
          email={user.email}
          name={user.name}
          avatarUrl={user.avatarUrl}
          provider={user.provider}
        />
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <WorkspaceNav />
        <div id="workspace-content" tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * Where workspace search will sit. Search is not built yet, so the field is
 * shown disabled and says so, rather than accepting input it cannot act on.
 * It is not a <form>, so it never counts among a page's forms.
 */
function SearchSlot() {
  return (
    <div role="search" className="hidden w-full max-w-md md:block">
      <div
        title="Search is not available yet"
        className="flex h-9 w-full cursor-not-allowed items-center gap-2 rounded-[var(--radius-control)] border border-border bg-workspace px-3 text-muted"
      >
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className="size-4 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        >
          <circle cx="9" cy="9" r="5.25" />
          <path d="m13 13 3.5 3.5" />
        </svg>
        <input
          type="search"
          disabled
          aria-label="Search"
          aria-describedby="workspace-search-hint"
          placeholder="Search deals and accounts"
          className="min-w-0 flex-1 cursor-not-allowed bg-transparent text-[14px] outline-none placeholder:text-muted"
        />
        <span id="workspace-search-hint" className="shrink-0 text-[12px] font-medium">
          Coming soon
        </span>
      </div>
    </div>
  )
}
