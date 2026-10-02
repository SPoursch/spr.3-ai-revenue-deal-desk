import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AttentionOverview } from '@/app/components/deal-desk/AttentionOverview'
import { DashboardSummary } from '@/app/components/deal-desk/DashboardSummary'
import { DealList } from '@/app/components/deal-desk/DealList'
import {
  PRIMARY_LINK_CLASS,
  SECONDARY_LINK_CLASS,
  WIDE_PAGE_CLASS,
} from '@/app/components/deal-desk/styles'
import { buildAttention, type Attention } from '@/app/lib/deal-desk/attention'
import {
  attentionByDeal,
  buildDashboardSummary,
  countExceptionsByDeal,
} from '@/app/lib/deal-desk/dashboard'
import type { Account, Deal } from '@/app/lib/deal-desk/domain'
import {
  DealDeskDatabaseError,
  getAuthenticatedUser,
  listAccounts,
  listDeals,
  listLiveExceptions,
  type LiveException,
} from '@/app/lib/db'

/**
 * The Revenue Deal Desk home: the signed-in user's figures, the deals that
 * need attention, and every deal.
 *
 * Everything is read as the user, so row level security returns only their
 * own accounts, deals and exceptions, and everything shown is derived from
 * those rows (app/lib/deal-desk/dashboard.ts, attention.ts). Read-only: no
 * form, no Server Action, no AI.
 *
 * The deals and the exceptions load separately. A failed deal read shows an
 * alert in place of the whole dashboard; a failed exceptions read leaves the
 * deals visible and shows the attention figures as unavailable, never as
 * zero.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'AI Revenue Deal Desk',
  description:
    'Consolidates the commercial context of a deal, surfaces exceptions and risks, and records human decisions.',
}

/** What the log records about a failed read: metadata only, never the error's text. */
function safeErrorMetadata(error: unknown) {
  if (error instanceof DealDeskDatabaseError) {
    return { table: error.table, kind: error.kind, code: error.cause.code }
  }
  return { kind: 'unexpected', name: error instanceof Error ? error.name : typeof error }
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="mr-1.5 size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  )
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

  let liveExceptions: LiveException[] | null = null
  if (deals !== null && deals.length > 0) {
    try {
      liveExceptions = await listLiveExceptions()
    } catch (error) {
      console.error('[workspace] loading live exceptions failed', safeErrorMetadata(error))
    }
  }

  const attention: Attention | null =
    deals !== null && liveExceptions !== null
      ? buildAttention({ deals, liveExceptions, now: new Date(), overArrThreshold: false })
      : null
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]))

  return (
    <main aria-label="Deal Desk" className={WIDE_PAGE_CLASS}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[14px] font-semibold text-primary">Revenue Deal Desk</p>
          <h1 className="mt-1 text-[28px] font-bold tracking-tight">Deals</h1>
          <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-muted">
            What needs you across your deals: notice deadlines, renewals and open exceptions,
            worked out from your own deal data. You decide; nothing here is decided for you.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {/* Attention and Accounts are reached from the workspace navigation. */}
          <Link href="/workspace/accounts/new" className={SECONDARY_LINK_CLASS}>
            New account
          </Link>
          <Link href="/workspace/deals/new" className={PRIMARY_LINK_CLASS}>
            <PlusIcon />
            New deal
          </Link>
        </div>
      </div>

      <div className="mt-8 flex flex-col gap-6">
        {deals !== null && deals.length > 0 ? (
          <>
            <DashboardSummary
              summary={buildDashboardSummary({ deals, liveExceptions, attention })}
              nextQuarter={attention?.nextQuarter ?? null}
            />
            <AttentionOverview attention={attention} accountNames={accountNames} />
          </>
        ) : null}
        <DealList
          deals={deals}
          accountNames={accountNames}
          attentionByDeal={attentionByDeal(attention)}
          exceptionsByDeal={liveExceptions === null ? null : countExceptionsByDeal(liveExceptions)}
        />
      </div>
    </main>
  )
}
