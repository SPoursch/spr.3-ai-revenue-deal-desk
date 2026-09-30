import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { ProvisionForm } from '@/app/components/deal-desk/ProvisionForm'
import { CARD_CLASS, PAGE_CLASS, TEXT_LINK_CLASS } from '@/app/components/deal-desk/styles'
import { isUuid, toProvisionFormValues } from '@/app/lib/deal-desk/forms'
import { getAuthenticatedUser, getProvision } from '@/app/lib/db'

/**
 * Edit a provision's value. Its type, deal and provenance are fixed, and its
 * citations are managed on its page. Someone else's provision, or one under a
 * different deal than the URL's, renders the not-found page.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Edit provision · AI Revenue Deal Desk' }

export default async function EditProvisionPage({
  params,
}: PageProps<'/workspace/deals/[dealId]/provisions/[provisionId]/edit'>) {
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
    <main aria-label="Edit provision" className={PAGE_CLASS}>
      <Link
        href={`/workspace/deals/${provision.deal_id}/provisions/${provision.id}`}
        className={`${TEXT_LINK_CLASS} text-[14px]`}
      >
        ← Back to the provision
      </Link>
      <h1 className="mt-4 text-[28px] font-bold tracking-tight">Edit provision</h1>
      <div className={`${CARD_CLASS} mt-8 p-6`}>
        <ProvisionForm
          edit={{
            provisionId: provision.id,
            provisionType: provision.provision_type,
            initial: toProvisionFormValues(provision),
          }}
        />
      </div>
    </main>
  )
}
