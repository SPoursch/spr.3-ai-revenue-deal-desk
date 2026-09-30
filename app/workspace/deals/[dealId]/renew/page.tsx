import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { DealForm } from '@/app/components/deal-desk/DealForm'
import { CARD_CLASS, PAGE_CLASS, TEXT_LINK_CLASS } from '@/app/components/deal-desk/styles'
import { isUuid } from '@/app/lib/deal-desk/forms'
import { getAccount, getAuthenticatedUser, getDeal } from '@/app/lib/db'

/**
 * Create a renewal of a deal (U13: a renewal is a new deal linked to its
 * predecessor). The predecessor is the deal in the URL, read as the signed-in
 * user, so a deal that does not exist and one that is not theirs both render
 * the deal not-found page. The renewal's type and account follow from the
 * predecessor, so the form offers neither.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'New renewal · AI Revenue Deal Desk' }

export default async function RenewDealPage({
  params,
}: PageProps<'/workspace/deals/[dealId]/renew'>) {
  if (!(await getAuthenticatedUser())) {
    redirect('/login')
  }

  const { dealId } = await params

  if (!isUuid(dealId)) {
    notFound()
  }

  const predecessor = await getDeal(dealId)

  if (!predecessor) {
    notFound()
  }

  const account = await getAccount(predecessor.account_id)
  const accountName = account?.name ?? 'Unknown account'

  return (
    <main aria-label="New renewal" className={PAGE_CLASS}>
      <Link
        href={`/workspace/deals/${predecessor.id}`}
        className={`${TEXT_LINK_CLASS} text-[14px]`}
      >
        ← Back to the deal
      </Link>
      <h1 className="mt-4 text-[28px] font-bold tracking-tight">New renewal</h1>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
        Renewal of{' '}
        <Link href={`/workspace/deals/${predecessor.id}`} className={TEXT_LINK_CLASS}>
          {predecessor.name}
        </Link>
        , on {accountName}. The renewal is a new deal; the deal it renews stays as
        it is.
      </p>
      <div className={`${CARD_CLASS} mt-8 p-6`}>
        <DealForm renewal={{ predecessorDealId: predecessor.id, accountName }} />
      </div>
    </main>
  )
}
