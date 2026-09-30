import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { EvidenceForm } from '@/app/components/deal-desk/EvidenceForm'
import { CARD_CLASS, PAGE_CLASS, TEXT_LINK_CLASS } from '@/app/components/deal-desk/styles'
import { isUuid } from '@/app/lib/deal-desk/forms'
import { getAuthenticatedUser, getDeal } from '@/app/lib/db'

/**
 * Add pasted evidence to a deal. The deal is the one in the URL, read as the
 * signed-in user, so a deal that does not exist and one that is not theirs
 * both render the deal not-found page.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Add evidence · AI Revenue Deal Desk' }

export default async function NewEvidencePage({
  params,
}: PageProps<'/workspace/deals/[dealId]/evidence/new'>) {
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

  return (
    <main aria-label="Add evidence" className={PAGE_CLASS}>
      <Link href={`/workspace/deals/${deal.id}`} className={`${TEXT_LINK_CLASS} text-[14px]`}>
        ← Back to the deal
      </Link>
      <h1 className="mt-4 text-[28px] font-bold tracking-tight">Add evidence</h1>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
        Evidence for{' '}
        <Link href={`/workspace/deals/${deal.id}`} className={TEXT_LINK_CLASS}>
          {deal.name}
        </Link>
        . Evidence is a permanent record: once added, it cannot be edited or deleted.
      </p>
      <div className={`${CARD_CLASS} mt-8 p-6`}>
        <EvidenceForm dealId={deal.id} />
      </div>
    </main>
  )
}
