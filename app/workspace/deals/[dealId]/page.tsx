import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { CARD_CLASS, PAGE_CLASS, TEXT_LINK_CLASS } from '@/app/components/deal-desk/styles'
import {
  DEAL_STAGE_LABELS,
  DEAL_TYPE_LABELS,
  formatBoolean,
  formatDate,
  formatEur,
  formatNumber,
  formatPercent,
} from '@/app/lib/deal-desk/format'
import { getAccount, getAuthenticatedUser, getDeal } from '@/app/lib/db'

/**
 * One deal, read-only.
 *
 * The deal is read as the signed-in user, so row level security decides
 * whether it is visible: someone else's deal and a deal that does not exist
 * are the same `null`, and both render the not-found page. Nothing on it
 * reveals whether the id exists.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Deal · AI Revenue Deal Desk' }

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function DealPage({ params }: PageProps<'/workspace/deals/[dealId]'>) {
  if (!(await getAuthenticatedUser())) {
    redirect('/login')
  }

  const { dealId } = await params

  // Not a uuid: Postgres would reject it as invalid input, so answer
  // "not found" without asking.
  if (!UUID_PATTERN.test(dealId)) {
    notFound()
  }

  const deal = await getDeal(dealId)

  if (!deal) {
    notFound()
  }

  const account = await getAccount(deal.account_id)

  const details: [string, string][] = [
    ['Account', account?.name ?? 'Unknown account'],
    ['Deal type', DEAL_TYPE_LABELS[deal.deal_type]],
    ['Stage', DEAL_STAGE_LABELS[deal.stage]],
    ['ARR', formatEur(deal.arr_eur)],
    ['TCV', formatEur(deal.tcv_eur)],
    ['List price', formatEur(deal.list_price_eur)],
    ['Discount', formatPercent(deal.discount_pct)],
    ['Term', formatNumber(deal.term_months, 'month')],
    ['Start date', formatDate(deal.start_date)],
    ['End date', formatDate(deal.end_date)],
    ['Renewal date', formatDate(deal.renewal_date)],
    ['Notice period', formatNumber(deal.notice_period_days, 'day')],
    ['Auto-renews', formatBoolean(deal.auto_renew)],
  ]

  return (
    <main aria-label="Deal" className={PAGE_CLASS}>
      <Link href="/workspace" className={`${TEXT_LINK_CLASS} text-[14px]`}>
        ← All deals
      </Link>
      <h1 className="mt-4 text-[28px] font-bold tracking-tight">{deal.name}</h1>

      <section aria-label="Deal details" className={`${CARD_CLASS} mt-8`}>
        <dl className="grid gap-x-6 sm:grid-cols-2">
          {details.map(([term, value]) => (
            <div key={term} className="flex flex-col gap-1 border-b border-border px-6 py-4">
              <dt className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
                {term}
              </dt>
              <dd className="text-[15px]">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  )
}
