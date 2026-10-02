import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AttentionList } from '@/app/components/deal-desk/AttentionList'
import {
  ERROR_CLASS,
  SECONDARY_LINK_CLASS,
  TEXT_LINK_CLASS,
  WIDE_PAGE_CLASS,
} from '@/app/components/deal-desk/styles'
import {
  ARR_FILTER_VALUE,
  NOTICE_WINDOW_DAYS,
  buildAttention,
  parseArrFilter,
  type Attention,
} from '@/app/lib/deal-desk/attention'
import { formatDate } from '@/app/lib/deal-desk/format'
import {
  DealDeskDatabaseError,
  getAuthenticatedUser,
  listAccounts,
  listDeals,
  listLiveExceptions,
} from '@/app/lib/db'

/**
 * Attention / Renewal Intelligence (Feature 7, docs/sprint-3-domain-index.md
 * §10): the caller's renewals and notice deadlines that need attention.
 *
 * A derived, time-dependent read model (A1), rebuilt on every request from
 * the caller's deals, accounts and live exceptions — all read as the caller,
 * so row level security returns only their own — and the current date in
 * Europe/Berlin. Read-only: no form, no Server Action, no AI.
 *
 * A failed read shows an alert, never empty sections (§6).
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Attention · AI Revenue Deal Desk' }

/** What the log records about a failed read: metadata only, never the error's text. */
function safeErrorMetadata(error: unknown) {
  if (error instanceof DealDeskDatabaseError) {
    return { table: error.table, kind: error.kind, code: error.cause.code }
  }
  return { kind: 'unexpected', name: error instanceof Error ? error.name : typeof error }
}

export default async function AttentionPage({
  searchParams,
}: {
  searchParams: Promise<{ arr?: string | string[] }>
}) {
  if (!(await getAuthenticatedUser())) {
    redirect('/login')
  }

  // Only the one known value turns the filter on; anything else is off.
  const overArrThreshold = parseArrFilter((await searchParams).arr)

  let attention: Attention | null = null
  let accountNames = new Map<string, string>()

  try {
    const [deals, accounts, liveExceptions] = await Promise.all([
      listDeals(),
      listAccounts(),
      listLiveExceptions(),
    ])
    attention = buildAttention({ deals, liveExceptions, now: new Date(), overArrThreshold })
    accountNames = new Map(accounts.map((account) => [account.id, account.name]))
  } catch (error) {
    console.error('[attention] loading failed', safeErrorMetadata(error))
  }

  const missed = attention?.sections.noticeDeadlines.filter((i) => i.notice === 'missed') ?? []
  const dueSoon = attention?.sections.noticeDeadlines.filter((i) => i.notice === 'due_soon') ?? []

  return (
    <main aria-label="Attention" className={WIDE_PAGE_CLASS}>
      <Link href="/workspace" className={`${TEXT_LINK_CLASS} text-[14px]`}>
        ← All deals
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">Attention</h1>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
            Renewals and notice deadlines that need you, worked out from your deals&apos; data.
            Nothing here is decided for you: open a deal to act on it.
          </p>
        </div>
        <Link
          href={overArrThreshold ? '/workspace/attention' : `/workspace/attention?arr=${ARR_FILTER_VALUE}`}
          className={SECONDARY_LINK_CLASS}
        >
          {overArrThreshold ? 'Show all deals' : 'Only ARR over €50,000'}
        </Link>
      </div>

      {attention === null ? (
        <p role="alert" className={`${ERROR_CLASS} mt-8`}>
          Your attention items could not be loaded. Refresh the page to try again.
        </p>
      ) : (
        <>
          <p className="mt-4 text-[14px] text-muted">
            As of {formatDate(attention.today)} (Europe/Berlin). Next quarter:{' '}
            {formatDate(attention.nextQuarter.start)} – {formatDate(attention.nextQuarter.end)}.
            {overArrThreshold ? ' Showing only deals with ARR over €50,000.' : null}
          </p>

          <section aria-label="Notice deadlines" className="mt-8">
            <h2 className="text-[20px] font-bold tracking-tight">Notice deadlines</h2>
            <h3 className="mt-4 text-[16px] font-semibold">Missed</h3>
            <AttentionList
              label="Missed notice deadlines"
              items={missed}
              accountNames={accountNames}
              empty="No notice deadline has been missed."
            />
            <h3 className="mt-6 text-[16px] font-semibold">
              Due in the next {NOTICE_WINDOW_DAYS} days
            </h3>
            <AttentionList
              label="Notice deadlines due soon"
              items={dueSoon}
              accountNames={accountNames}
              empty={`No notice deadline is due in the next ${NOTICE_WINDOW_DAYS} days.`}
            />
          </section>

          <section aria-label="Renewing next quarter" className="mt-8">
            <h2 className="text-[20px] font-bold tracking-tight">Renewing next quarter</h2>
            <AttentionList
              label="Deals renewing next quarter"
              items={attention.sections.renewingNextQuarter}
              accountNames={accountNames}
              empty="No deal renews next quarter."
            />
          </section>

          <section aria-label="Cannot compute" className="mt-8">
            <h2 className="text-[20px] font-bold tracking-tight">Cannot compute</h2>
            <p className="mt-1 max-w-2xl text-[14px] text-muted">
              These deals have a renewal date but no notice period, so their notice deadline is
              unknown. They are not safe: add the notice period to the deal.
            </p>
            <AttentionList
              label="Deals whose notice deadline cannot be computed"
              items={attention.sections.cannotCompute}
              accountNames={accountNames}
              empty="No upcoming renewal is missing its notice period."
            />
          </section>
        </>
      )}
    </main>
  )
}
