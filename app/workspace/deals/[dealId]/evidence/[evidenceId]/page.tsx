import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { CARD_CLASS, PAGE_CLASS, TEXT_LINK_CLASS } from '@/app/components/deal-desk/styles'
import { EVIDENCE_TYPE_LABELS, NOT_SET, formatBoolean, formatDate } from '@/app/lib/deal-desk/format'
import { isUuid } from '@/app/lib/deal-desk/forms'
import { getAuthenticatedUser, getEvidenceItem, listEvidenceExcerpts } from '@/app/lib/db'

/**
 * One evidence item with its excerpts, read-only: evidence is immutable and
 * not independently deletable (E3), so the page offers no edit or delete.
 *
 * The item is read as the signed-in user, so someone else's evidence is the
 * same `null` as a missing one. An item that exists but belongs to a
 * different deal than the URL names is not found either.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Evidence · AI Revenue Deal Desk' }

export default async function EvidencePage({
  params,
}: PageProps<'/workspace/deals/[dealId]/evidence/[evidenceId]'>) {
  if (!(await getAuthenticatedUser())) {
    redirect('/login')
  }

  const { dealId, evidenceId } = await params

  if (!isUuid(dealId) || !isUuid(evidenceId)) {
    notFound()
  }

  const item = await getEvidenceItem(evidenceId)

  if (!item || item.deal_id !== dealId) {
    notFound()
  }

  const excerpts = await listEvidenceExcerpts(item.id)

  const details: [string, string][] = [
    ['Type', EVIDENCE_TYPE_LABELS[item.evidence_type]],
    ['Author', item.author ?? NOT_SET],
    ['Version', item.version_label ?? NOT_SET],
    ['Document date', formatDate(item.document_date)],
    ['Executed', formatBoolean(item.is_executed)],
  ]

  return (
    <main aria-label="Evidence" className={PAGE_CLASS}>
      <Link href={`/workspace/deals/${item.deal_id}`} className={`${TEXT_LINK_CLASS} text-[14px]`}>
        ← Back to the deal
      </Link>
      <h1 className="mt-4 text-[28px] font-bold tracking-tight">{item.title}</h1>

      <section aria-label="Evidence details" className={`${CARD_CLASS} mt-8`}>
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

      <section aria-label="Excerpts" className="mt-8">
        <h2 className="text-[20px] font-bold tracking-tight">Excerpts</h2>
        {excerpts.length === 0 ? (
          <p className="mt-3 text-[15px] text-muted">
            This evidence has no excerpts.
          </p>
        ) : (
          <ol className="mt-3 flex flex-col gap-3">
            {excerpts.map((excerpt) => (
              <li key={excerpt.id} className={`${CARD_CLASS} px-6 py-4`}>
                <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Excerpt {excerpt.ordinal + 1}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed">
                  {excerpt.content}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  )
}
