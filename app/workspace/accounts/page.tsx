import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import {
  CARD_CLASS,
  EMPTY_STATE_CLASS,
  ERROR_CLASS,
  PRIMARY_LINK_CLASS,
  TABLE_CELL_CLASS,
  TABLE_CLASS,
  TABLE_HEAD_CLASS,
  TABLE_HEADER_CELL_CLASS,
  TABLE_ROW_CLASS,
  TEXT_LINK_CLASS,
  WIDE_PAGE_CLASS,
} from '@/app/components/deal-desk/styles'
import type { Account, Deal } from '@/app/lib/deal-desk/domain'
import { formatNumber, NOT_SET } from '@/app/lib/deal-desk/format'
import { getAuthenticatedUser, listAccounts, listDeals } from '@/app/lib/db'

/**
 * The signed-in user's accounts, with how many deals each holds.
 *
 * Both lists are read as the user, so row level security returns only their
 * own rows. The deal count is worked out here from the deal list rather than
 * by a separate query. As on /workspace, a failed load shows an error, never
 * an empty list.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Accounts · AI Revenue Deal Desk' }

export default async function AccountsPage() {
  if (!(await getAuthenticatedUser())) {
    redirect('/login')
  }

  let accounts: Account[] | null = null
  let deals: Deal[] = []

  try {
    ;[accounts, deals] = await Promise.all([listAccounts(), listDeals()])
  } catch (error) {
    // Logged on the server. `accounts` stays null, so the page shows a failed
    // load, never an empty list.
    console.error('[accounts] loading accounts failed:', error)
  }

  const dealCounts = new Map<string, number>()
  for (const deal of deals) {
    dealCounts.set(deal.account_id, (dealCounts.get(deal.account_id) ?? 0) + 1)
  }

  return (
    <main aria-label="Accounts" className={WIDE_PAGE_CLASS}>
      <Link href="/workspace" className={`${TEXT_LINK_CLASS} text-[14px]`}>
        ← All deals
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[28px] font-bold tracking-tight">Accounts</h1>
        <Link href="/workspace/accounts/new" className={PRIMARY_LINK_CLASS}>
          New account
        </Link>
      </div>

      <div className="mt-8">
        {accounts === null ? (
          <p role="alert" className={ERROR_CLASS}>
            Your accounts could not be loaded. Refresh the page to try again.
          </p>
        ) : accounts.length === 0 ? (
          <section
            aria-label="Accounts"
            className={EMPTY_STATE_CLASS}
          >
            <h2 className="text-[20px] font-bold tracking-tight">No accounts yet</h2>
            <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-muted">
              An account is the company a deal is with.
            </p>
          </section>
        ) : (
          <section aria-label="Accounts" className={`${CARD_CLASS} overflow-x-auto`}>
            <table className={`${TABLE_CLASS} min-w-[560px]`}>
              <thead className={TABLE_HEAD_CLASS}>
                <tr>
                  <th scope="col" className={TABLE_HEADER_CELL_CLASS}>Account</th>
                  <th scope="col" className={TABLE_HEADER_CELL_CLASS}>Region</th>
                  <th scope="col" className={TABLE_HEADER_CELL_CLASS}>Segment</th>
                  <th scope="col" className={TABLE_HEADER_CELL_CLASS}>Deals</th>
                  <th scope="col" className={TABLE_HEADER_CELL_CLASS}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id} className={TABLE_ROW_CLASS}>
                    <td id={`account-${account.id}-name`} className={`${TABLE_CELL_CLASS} font-semibold`}>
                      {account.name}
                    </td>
                    <td className={TABLE_CELL_CLASS}>{account.region ?? NOT_SET}</td>
                    <td className={TABLE_CELL_CLASS}>{account.segment ?? NOT_SET}</td>
                    <td className={TABLE_CELL_CLASS}>
                      {formatNumber(dealCounts.get(account.id) ?? 0, 'deal')}
                    </td>
                    <td className={`${TABLE_CELL_CLASS} text-right`}>
                      {/* The links are named "Edit" and "Delete"; the account
                          they act on is announced as their description. */}
                      <div className="flex justify-end gap-4">
                        <Link
                          href={`/workspace/accounts/${account.id}/edit`}
                          aria-describedby={`account-${account.id}-name`}
                          className={TEXT_LINK_CLASS}
                        >
                          Edit
                        </Link>
                        <Link
                          href={`/workspace/accounts/${account.id}/delete`}
                          aria-describedby={`account-${account.id}-name`}
                          className={TEXT_LINK_CLASS}
                        >
                          Delete
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </main>
  )
}
