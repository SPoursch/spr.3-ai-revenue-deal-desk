import type { Metadata } from 'next'
import Image from 'next/image'
import { redirect } from 'next/navigation'

import { UserMenu } from '@/app/components/UserMenu'
import { getAuthenticatedUser } from '@/app/lib/db'

/**
 * The AI Revenue Deal Desk workspace: a landing state until the Deal Desk
 * interface is built.
 *
 * It replaces the inherited Sprint 2 notes workspace, which CLAUDE.md keeps
 * out of the Sprint 3 UI and whose tables do not exist in the canonical
 * database.
 * It reads no table: the only call is the session check, which verifies the
 * token and needs no query.
 *
 * `force-dynamic` keeps the session check running per request rather than
 * once at build time.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'AI Revenue Deal Desk',
  description:
    'Consolidates the commercial context of a deal, surfaces exceptions and risks, and records human decisions.',
}

export default async function Page() {
  // The signed-in user, checked here as well as in app/workspace/layout.tsx.
  // A layout and its page can render concurrently, so the layout's redirect
  // alone does not guarantee this page never renders for a signed-out request.
  const user = await getAuthenticatedUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="flex min-h-dvh w-full flex-col bg-workspace">
      <header className="sticky top-0 z-40 flex shrink-0 items-center justify-between gap-4 border-b border-border bg-pane/95 px-4 py-2.5 backdrop-blur md:px-6">
        <div className="flex min-w-0 items-center gap-3">
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
        </div>

        <UserMenu
          email={user.email}
          name={user.name}
          avatarUrl={user.avatarUrl}
          provider={user.provider}
        />
      </header>

      <main
        aria-label="Deal Desk"
        className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-8 md:px-8 md:py-12"
      >
        <h1 className="text-[28px] font-bold tracking-tight">
          AI Revenue Deal Desk
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
          One place to understand a deal: its commercial context, the exceptions
          and risks that need attention and why, and the decisions your team
          records on them. The AI explains and prepares; people decide.
        </p>

        <section
          aria-label="Workspace status"
          className="mt-8 rounded-[var(--radius-card)] border border-dashed border-border-strong bg-pane px-6 py-10 text-center"
        >
          <h2 className="text-[20px] font-bold tracking-tight">
            Your deal workspace is being set up
          </h2>
          <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-muted">
            You are signed in. Deals, their evidence, exceptions and decisions
            will appear here as the Deal Desk is built.
          </p>
        </section>
      </main>
    </div>
  )
}
