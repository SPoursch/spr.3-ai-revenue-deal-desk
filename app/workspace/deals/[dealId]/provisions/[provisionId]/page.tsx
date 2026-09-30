import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { AddCitationsForm, RemoveCitationForm } from '@/app/components/deal-desk/CitationForms'
import {
  CARD_CLASS,
  ERROR_CLASS,
  PAGE_CLASS,
  PRIMARY_LINK_CLASS,
  SECONDARY_LINK_CLASS,
  TEXT_LINK_CLASS,
} from '@/app/components/deal-desk/styles'
import { PROVISION_TYPE_LABELS, formatProvisionAmount } from '@/app/lib/deal-desk/format'
import { isUuid } from '@/app/lib/deal-desk/forms'
import {
  getAuthenticatedUser,
  getProvision,
  listDealExcerptsByItem,
  listProvisionCitations,
} from '@/app/lib/db'

/**
 * One provision with the excerpts that support it. Read as the signed-in
 * user, so someone else's provision is the same `null` as a missing one; a
 * provision under a deal other than the URL's is not found either.
 *
 * "Supported" is worked out from the citations each time, never stored: a
 * provision with none is shown as unsupported, not as an established fact.
 * Excerpt text is untrusted evidence and is rendered as text only.
 *
 * `?citations=failed` is set when creating the provision stored it but not
 * its citations; the page then says so. It only changes the notice shown:
 * support is still worked out from the stored citations.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Provision · AI Revenue Deal Desk' }

export default async function ProvisionPage({
  params,
  searchParams,
}: PageProps<'/workspace/deals/[dealId]/provisions/[provisionId]'>) {
  if (!(await getAuthenticatedUser())) {
    redirect('/login')
  }

  const { dealId, provisionId } = await params
  const { citations: citationsParam } = await searchParams

  if (!isUuid(dealId) || !isUuid(provisionId)) {
    notFound()
  }

  const provision = await getProvision(provisionId)

  if (!provision || provision.deal_id !== dealId) {
    notFound()
  }

  const [citations, groups] = await Promise.all([
    listProvisionCitations(provision.id),
    listDealExcerptsByItem(provision.deal_id),
  ])

  // The picker offers only excerpts not cited yet.
  const cited = new Set(citations.map((citation) => citation.excerpt_id))
  const uncited = groups.map((group) => ({
    ...group,
    excerpts: group.excerpts.filter((excerpt) => !cited.has(excerpt.id)),
  }))

  const support =
    citations.length === 0
      ? 'Unsupported'
      : `Supported (${citations.length} ${citations.length === 1 ? 'excerpt' : 'excerpts'})`

  const details: [string, string][] = [
    ['Value', provision.value_text],
    ['Amount', formatProvisionAmount(provision.value_numeric, provision.value_unit)],
    ['Support', support],
  ]

  const base = `/workspace/deals/${provision.deal_id}`

  return (
    <main aria-label="Provision" className={PAGE_CLASS}>
      <Link href={base} className={`${TEXT_LINK_CLASS} text-[14px]`}>
        ← Back to the deal
      </Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-[28px] font-bold tracking-tight">
          {PROVISION_TYPE_LABELS[provision.provision_type]}
        </h1>
        <div className="flex gap-3">
          <Link href={`${base}/provisions/${provision.id}/edit`} className={PRIMARY_LINK_CLASS}>
            Edit provision
          </Link>
          <Link
            href={`${base}/provisions/${provision.id}/delete`}
            className={SECONDARY_LINK_CLASS}
          >
            Delete provision
          </Link>
        </div>
      </div>

      <section aria-label="Provision details" className={`${CARD_CLASS} mt-8`}>
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

      <section aria-label="Citations" className="mt-8">
        <h2 className="text-[20px] font-bold tracking-tight">Citations</h2>
        {citationsParam === 'failed' && citations.length === 0 ? (
          <p role="status" className={`${ERROR_CLASS} mt-3`}>
            The provision was saved, but its citations could not be added. Add them below.
          </p>
        ) : null}
        {citations.length === 0 ? (
          <p className="mt-3 text-[15px] text-muted">
            No excerpt supports this provision yet.
          </p>
        ) : (
          <ol className="mt-3 flex flex-col gap-3">
            {citations.map(({ excerpt }) => (
              <li key={excerpt.id} className={`${CARD_CLASS} flex flex-col gap-3 px-6 py-4`}>
                <p className="text-[13px] text-muted">
                  <Link
                    href={`${base}/evidence/${excerpt.evidence_item.id}`}
                    className={TEXT_LINK_CLASS}
                  >
                    {excerpt.evidence_item.title}
                  </Link>{' '}
                  · Excerpt {excerpt.ordinal + 1}
                </p>
                <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
                  {excerpt.content}
                </p>
                <RemoveCitationForm provisionId={provision.id} excerptId={excerpt.id} />
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-label="Add citations" className={`${CARD_CLASS} mt-8 p-6`}>
        <h2 className="mb-4 text-[20px] font-bold tracking-tight">Add citations</h2>
        <AddCitationsForm provisionId={provision.id} groups={uncited} />
      </section>
    </main>
  )
}
