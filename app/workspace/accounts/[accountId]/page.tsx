import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { AccountMark } from '@/app/components/deal-desk/AccountMark'
import { DashboardSummary } from '@/app/components/deal-desk/DashboardSummary'
import { DealList } from '@/app/components/deal-desk/DealList'
import {
  BADGE_CLASS,
  BADGE_TONE,
  CARD_CLASS,
  EMPTY_STATE_CLASS,
  PRIMARY_LINK_CLASS,
  SECONDARY_LINK_CLASS,
  TEXT_LINK_CLASS,
  WIDE_PAGE_CLASS,
} from '@/app/components/deal-desk/styles'
import { buildAttention, todayInBerlin } from '@/app/lib/deal-desk/attention'
import {
  attentionByDeal,
  buildDashboardSummary,
  countExceptionsByDeal,
} from '@/app/lib/deal-desk/dashboard'
import { formatDate, NOT_SET } from '@/app/lib/deal-desk/format'
import { isUuid } from '@/app/lib/deal-desk/forms'
import {
  getAccount,
  getAuthenticatedUser,
  listDeals,
  listLiveExceptions,
} from '@/app/lib/db'

/**
 * One account, read-only: who it is, what is recorded about it, and its
 * deals with the figures and notice status worked out from them.
 *
 * Everything is read as the signed-in user, so row level security decides
 * visibility: someone else's account and one that does not exist are the
 * same `null`, and both render the account not-found page. The figures and
 * columns reuse the dashboard's derivation (app/lib/deal-desk/dashboard.ts,
 * attention.ts) over this account's deals only. Only what the domain holds is
 * shown: the account's own fields and its deals.
 *
 * A failed read goes to the workspace error page, as on the deal page, so a
 * deal list that could not be loaded never looks like "No deals yet".
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Account · AI Revenue Deal Desk' }

/**
 * A stored timestamp as its calendar date in Europe/Berlin, the app's time
 * zone (U12), formatted like every other date. Slicing the UTC string would
 * show the previous day for anything saved between midnight and 01:00 or
 * 02:00 Berlin time.
 */
function formatTimestamp(timestamp: string): string {
  return formatDate(todayInBerlin(new Date(timestamp)))
}

export default async function AccountPage({
  params,
}: PageProps<'/workspace/accounts/[accountId]'>) {
  if (!(await getAuthenticatedUser())) {
    redirect('/login')
  }

  const { accountId } = await params

  // Not a uuid: Postgres would reject it as invalid input, so answer
  // "not found" without asking.
  if (!isUuid(accountId)) {
    notFound()
  }

  const [account, allDeals, allLiveExceptions] = await Promise.all([
    getAccount(accountId),
    listDeals(),
    listLiveExceptions(),
  ])

  if (!account) {
    notFound()
  }

  const deals = allDeals.filter((deal) => deal.account_id === account.id)
  const dealIds = new Set(deals.map((deal) => deal.id))
  const liveExceptions = allLiveExceptions.filter((exception) => dealIds.has(exception.deal_id))
  const attention = buildAttention({ deals, liveExceptions, now: new Date(), overArrThreshold: false })
  const newDealHref = `/workspace/deals/new?accountId=${account.id}`

  const facts: [string, string][] = [
    ['Industry', account.industry ?? NOT_SET],
    ['Segment', account.segment ?? NOT_SET],
    ['Region', account.region ?? NOT_SET],
    ['Country code', account.country_code ?? NOT_SET],
    ['Created', formatTimestamp(account.created_at)],
    ['Last updated', formatTimestamp(account.updated_at)],
  ]
  // Keyed by field: the values are free text, so two of them may be equal.
  const badges = (
    [
      ['industry', account.industry],
      ['segment', account.segment],
      ['region', account.region],
    ] as const
  ).filter((entry): entry is readonly [typeof entry[0], string] => entry[1] !== null)

  return (
    <main aria-label="Account" className={WIDE_PAGE_CLASS}>
      <Link href="/workspace/accounts" className={`${TEXT_LINK_CLASS} text-[14px]`}>
        ← All accounts
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <AccountMark name={account.name} size="lg" />
          <div className="min-w-0">
            <h1 className="text-[28px] leading-tight font-bold tracking-tight break-words">
              {account.name}
            </h1>
            {badges.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {badges.map(([field, value]) => (
                  <span key={field} className={`${BADGE_CLASS} ${BADGE_TONE.neutral}`}>
                    {value}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href={`/workspace/accounts/${account.id}/edit`} className={SECONDARY_LINK_CLASS}>
            Edit account
          </Link>
          <Link href={`/workspace/accounts/${account.id}/delete`} className={SECONDARY_LINK_CLASS}>
            Delete account
          </Link>
          <Link href={newDealHref} className={PRIMARY_LINK_CLASS}>
            New deal
          </Link>
        </div>
      </div>

      <div className="mt-8 flex flex-col gap-6">
        <section aria-labelledby="about-heading" className={`${CARD_CLASS} overflow-hidden`}>
          <h2
            id="about-heading"
            className="border-b border-border px-5 py-4 text-[17px] font-semibold tracking-tight"
          >
            About
          </h2>
          <dl className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
            {facts.map(([term, value]) => (
              <div key={term} className="flex flex-col gap-1 bg-pane px-5 py-4">
                <dt className="text-[13px] font-medium text-muted">{term}</dt>
                <dd className="text-[15px]">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {deals.length > 0 ? (
          <>
            <DashboardSummary
              summary={buildDashboardSummary({ deals, liveExceptions, attention })}
              nextQuarter={attention.nextQuarter}
            />
            <DealList
              deals={deals}
              accountNames={new Map([[account.id, account.name]])}
              attentionByDeal={attentionByDeal(attention)}
              exceptionsByDeal={countExceptionsByDeal(liveExceptions)}
              heading="Deals"
              showAccount={false}
            />
          </>
        ) : (
          <section aria-label="Deals" className={EMPTY_STATE_CLASS}>
            <h2 className="text-[20px] font-bold tracking-tight">No deals for this account yet</h2>
            <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-muted">
              Add the first deal with {account.name} to see its terms, renewal and exceptions here.
            </p>
            <div className="mt-6">
              <Link href={newDealHref} className={PRIMARY_LINK_CLASS}>
                Add a deal
              </Link>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
