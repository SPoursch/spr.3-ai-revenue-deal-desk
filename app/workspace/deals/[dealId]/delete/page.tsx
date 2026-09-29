import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { ConfirmDeleteForm } from '@/app/components/deal-desk/ConfirmDeleteForm'
import { CARD_CLASS, PAGE_CLASS } from '@/app/components/deal-desk/styles'
import { isUuid } from '@/app/lib/deal-desk/forms'
import { getAuthenticatedUser, getDeal } from '@/app/lib/db'

/**
 * Confirm deleting a deal. Rendered on the server; nothing is deleted until
 * the confirmation form is submitted. A deal that does not exist and one that
 * is not the user's both render the deal not-found page.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Delete deal · AI Revenue Deal Desk' }

export default async function DeleteDealPage({
  params,
}: PageProps<'/workspace/deals/[dealId]/delete'>) {
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
    <main aria-label="Delete deal" className={PAGE_CLASS}>
      <h1 className="text-[28px] font-bold tracking-tight">Delete deal</h1>
      <div className={`${CARD_CLASS} mt-8 flex flex-col gap-6 p-6`}>
        <p className="text-[15px] leading-relaxed">
          You are about to delete <strong>{deal.name}</strong>. Everything attached to
          it goes with it. This cannot be undone.
        </p>
        <ConfirmDeleteForm
          target="deal"
          id={deal.id}
          cancelHref={`/workspace/deals/${deal.id}`}
        />
      </div>
    </main>
  )
}
