import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { DealList } from '@/app/components/deal-desk/DealList'
import {
  PAGE_CLASS,
  PRIMARY_LINK_CLASS,
  SECONDARY_LINK_CLASS,
} from '@/app/components/deal-desk/styles'
import type { Account, Deal } from '@/app/lib/deal-desk/domain'
import { getAuthenticatedUser, listAccounts, listDeals } from '@/app/lib/db'

/**
 * The AI Revenue Deal Desk workspace: the signed-in user's deals.
 *
 * Both lists are read as the user, so row level security returns only their
 * own accounts and deals.
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

  let deals: Deal[] | null = null
  let accounts: Account[] = []

  try {
    ;[deals, accounts] = await Promise.all([listDeals(), listAccounts()])
  } catch (error) {
    // Logged on the server. `deals` stays null, so the page shows a failed
    // load, never an empty list.
    console.error('[workspace] loading deals failed:', error)
  }

  return (
    <main aria-label="Deal Desk" className={PAGE_CLASS}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">Deals</h1>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
            Every deal you are working on, with the commercial terms that matter.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/workspace/attention" className={SECONDARY_LINK_CLASS}>
            Attention
          </Link>
          <Link href="/workspace/accounts" className={SECONDARY_LINK_CLASS}>
            Accounts
          </Link>
          <Link href="/workspace/accounts/new" className={SECONDARY_LINK_CLASS}>
            New account
          </Link>
          <Link href="/workspace/deals/new" className={PRIMARY_LINK_CLASS}>
            New deal
          </Link>
        </div>
      </div>

      <div className="mt-8">
        <DealList deals={deals} accounts={accounts} />
      </div>
    </main>
  )
}
