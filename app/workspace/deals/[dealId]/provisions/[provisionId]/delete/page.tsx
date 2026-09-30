import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { ConfirmDeleteForm } from '@/app/components/deal-desk/ConfirmDeleteForm'
import { CARD_CLASS, PAGE_CLASS } from '@/app/components/deal-desk/styles'
import { PROVISION_TYPE_LABELS } from '@/app/lib/deal-desk/format'
import { isUuid } from '@/app/lib/deal-desk/forms'
import { getAuthenticatedUser, getProvision } from '@/app/lib/db'

/**
 * Confirm deleting a provision. Nothing is deleted until the confirmation
 * form is submitted. Its citations go with it; the evidence they cite stays.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Delete provision · AI Revenue Deal Desk' }

export default async function DeleteProvisionPage({
  params,
}: PageProps<'/workspace/deals/[dealId]/provisions/[provisionId]/delete'>) {
  if (!(await getAuthenticatedUser())) {
    redirect('/login')
  }

  const { dealId, provisionId } = await params

  if (!isUuid(dealId) || !isUuid(provisionId)) {
    notFound()
  }

  const provision = await getProvision(provisionId)

  if (!provision || provision.deal_id !== dealId) {
    notFound()
  }

  return (
    <main aria-label="Delete provision" className={PAGE_CLASS}>
      <h1 className="text-[28px] font-bold tracking-tight">Delete provision</h1>
      <div className={`${CARD_CLASS} mt-8 flex flex-col gap-6 p-6`}>
        <p className="text-[15px] leading-relaxed">
          You are about to delete the{' '}
          <strong>{PROVISION_TYPE_LABELS[provision.provision_type]}</strong> provision (
          {provision.value_text}) and its citations. The evidence it cites stays. This
          cannot be undone.
        </p>
        <ConfirmDeleteForm
          target="provision"
          id={provision.id}
          cancelHref={`/workspace/deals/${provision.deal_id}/provisions/${provision.id}`}
        />
      </div>
    </main>
  )
}
