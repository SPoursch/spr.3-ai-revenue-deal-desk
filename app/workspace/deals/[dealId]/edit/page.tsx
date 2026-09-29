import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { DealForm } from '@/app/components/deal-desk/DealForm'
import { CARD_CLASS, PAGE_CLASS, TEXT_LINK_CLASS } from '@/app/components/deal-desk/styles'
import { isUuid, toDealFormValues } from '@/app/lib/deal-desk/forms'
import { getAccount, getAuthenticatedUser, getDeal } from '@/app/lib/db'

/**
 * Edit a deal. Read as the signed-in user, so a deal that does not exist and
 * one that is not theirs both render the deal not-found page.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Edit deal · AI Revenue Deal Desk' }

export default async function EditDealPage({
  params,
}: PageProps<'/workspace/deals/[dealId]/edit'>) {
  if (!(await getAuthenticatedUser())) {
    redirect('/login')
  }

  const { dealId } = await params

  if (!isUuid(dealId)) {
    notFound()
  }

  const deal = await getDeal(dealId)

  if (!deal) {
    notFound()
  }

  const account = await getAccount(deal.account_id)

  return (
    <main aria-label="Edit deal" className={PAGE_CLASS}>
      <Link href={`/workspace/deals/${deal.id}`} className={`${TEXT_LINK_CLASS} text-[14px]`}>
        ← Back to the deal
      </Link>
      <h1 className="mt-4 text-[28px] font-bold tracking-tight">Edit deal</h1>
      <div className={`${CARD_CLASS} mt-8 p-6`}>
        <DealForm
          edit={{
            dealId: deal.id,
            accountName: account?.name ?? 'Unknown account',
            hasPredecessor: deal.predecessor_deal_id !== null,
            initial: toDealFormValues(deal),
          }}
        />
      </div>
    </main>
  )
}
