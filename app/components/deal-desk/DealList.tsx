import Link from 'next/link'

import type { Account, Deal } from '@/app/lib/deal-desk/domain'
import {
  DEAL_STAGE_LABELS,
  DEAL_TYPE_LABELS,
  formatDate,
  formatEur,
} from '@/app/lib/deal-desk/format'

import { CARD_CLASS, ERROR_CLASS, PRIMARY_LINK_CLASS, TEXT_LINK_CLASS } from './styles'

/**
 * The deal list on /workspace.
 *
 * CLAUDE.md: an empty list must never look like a failed load. `deals` is
 * null when loading failed, which renders an error panel; an empty array is
 * the genuine "no deals yet" state.
 */
export function DealList({
  deals,
  accounts,
}: {
  deals: Deal[] | null
  accounts: Account[]
}) {
  if (deals === null) {
    return (
      <p role="alert" className={ERROR_CLASS}>
        Your deals could not be loaded. Refresh the page to try again.
      </p>
    )
  }

  if (deals.length === 0) {
    return (
      <section
        aria-label="Deals"
        className="rounded-[var(--radius-card)] border border-dashed border-border-strong bg-pane px-6 py-10 text-center"
      >
        <h2 className="text-[20px] font-bold tracking-tight">No deals yet</h2>
        <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-muted">
          {accounts.length === 0
            ? 'Start by creating the account a deal belongs to, then add the deal.'
            : 'Add your first deal to see it here.'}
        </p>
        <div className="mt-6">
          <Link
            href={accounts.length === 0 ? '/workspace/accounts/new' : '/workspace/deals/new'}
            className={PRIMARY_LINK_CLASS}
          >
            {accounts.length === 0 ? 'Create an account' : 'Add a deal'}
          </Link>
        </div>
      </section>
    )
  }

  const accountNames = new Map(accounts.map((account) => [account.id, account.name]))

  return (
    <section aria-label="Deals" className={`${CARD_CLASS} overflow-x-auto`}>
      <table className="w-full min-w-[640px] text-left text-[14px]">
        <thead className="border-b border-border text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
          <tr>
            <th scope="col" className="px-4 py-3">Deal</th>
            <th scope="col" className="px-4 py-3">Account</th>
            <th scope="col" className="px-4 py-3">Type</th>
            <th scope="col" className="px-4 py-3">Stage</th>
            <th scope="col" className="px-4 py-3 text-right">ARR</th>
            <th scope="col" className="px-4 py-3">Renewal date</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => (
            <tr key={deal.id} className="border-b border-border last:border-b-0">
              <td className="px-4 py-3">
                <Link href={`/workspace/deals/${deal.id}`} className={TEXT_LINK_CLASS}>
                  {deal.name}
                </Link>
              </td>
              <td className="px-4 py-3">{accountNames.get(deal.account_id) ?? 'Unknown account'}</td>
              <td className="px-4 py-3">{DEAL_TYPE_LABELS[deal.deal_type]}</td>
              <td className="px-4 py-3">{DEAL_STAGE_LABELS[deal.stage]}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatEur(deal.arr_eur)}</td>
              <td className="px-4 py-3">{formatDate(deal.renewal_date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
