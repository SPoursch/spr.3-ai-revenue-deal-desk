import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { ProvisionForm } from '@/app/components/deal-desk/ProvisionForm'
import { CARD_CLASS, PAGE_CLASS, TEXT_LINK_CLASS } from '@/app/components/deal-desk/styles'
import { PROVISION_TYPES } from '@/app/lib/deal-desk/domain'
import { isUuid } from '@/app/lib/deal-desk/forms'
import {
  getAuthenticatedUser,
  getDeal,
  listDealExcerptsByItem,
  listProvisions,
} from '@/app/lib/db'

/**
 * Add a provision to a deal, citing excerpts of the deal's evidence. The deal
 * is the one in the URL, read as the signed-in user, so a deal that does not
 * exist and one that is not theirs both render the deal not-found page. Only
 * types the deal does not have yet are offered (one per type per deal).
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Add provision · AI Revenue Deal Desk' }

export default async function NewProvisionPage({
  params,
}: PageProps<'/workspace/deals/[dealId]/provisions/new'>) {
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

  const [provisions, groups] = await Promise.all([
    listProvisions(deal.id),
    listDealExcerptsByItem(deal.id),
  ])
  const recorded = new Set(provisions.map((provision) => provision.provision_type))
  const types = PROVISION_TYPES.filter((type) => !recorded.has(type))

  return (
    <main aria-label="Add provision" className={PAGE_CLASS}>
      <Link href={`/workspace/deals/${deal.id}`} className={`${TEXT_LINK_CLASS} text-[14px]`}>
        ← Back to the deal
      </Link>
      <h1 className="mt-4 text-[28px] font-bold tracking-tight">Add provision</h1>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
        A contract term of{' '}
        <Link href={`/workspace/deals/${deal.id}`} className={TEXT_LINK_CLASS}>
          {deal.name}
        </Link>
        , with the excerpts that support it. A provision without citations is shown as
        unsupported.
      </p>
      <div className={`${CARD_CLASS} mt-8 p-6`}>
        {types.length === 0 ? (
          <p className="text-[15px] text-muted">
            This deal already has a provision of every type. Edit one from its page.
          </p>
        ) : (
          <ProvisionForm create={{ dealId: deal.id, types, groups }} />
        )}
      </div>
    </main>
  )
}
