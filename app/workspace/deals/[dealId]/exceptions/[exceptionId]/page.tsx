import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { DecisionForm } from '@/app/components/deal-desk/ExceptionForms'
import { CARD_CLASS, PAGE_CLASS, TEXT_LINK_CLASS } from '@/app/components/deal-desk/styles'
import {
  DECISION_TYPE_LABELS,
  EXCEPTION_SEVERITY_LABELS,
  EXCEPTION_STATUS_LABELS,
  PROVISION_TYPE_LABELS,
  formatDate,
} from '@/app/lib/deal-desk/format'
import { isUuid } from '@/app/lib/deal-desk/forms'
import {
  evaluateDeal,
  exceptionApplicability,
  ruleOf,
  type ExceptionApplicability,
} from '@/app/lib/deal-desk/rules'
import {
  getAuthenticatedUser,
  getDeal,
  getException,
  listExceptionDecisions,
  listProvisionCitations,
  listProvisions,
} from '@/app/lib/db'

/**
 * One exception: the rule it broke, why, its evidence, whether the rule still
 * applies to the deal's current data, and the human Decisions on it.
 *
 * Read as the signed-in user, so someone else's exception is the same `null`
 * as a missing one; an exception under a deal other than the URL's is not
 * found either. The current check runs the same rules over the same reads as
 * "Check deal", and is worked out each time, never stored: only a Decision
 * closes an exception. A failed read goes to the error page, so it is never
 * shown as "no longer applies".
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Exception · AI Revenue Deal Desk' }

const APPLICABILITY_LABELS: Record<ExceptionApplicability, string> = {
  still_applies: 'Still applies',
  no_longer_applies: 'No longer applies',
  cannot_check: 'Cannot be checked',
  rule_changed: 'Rule has changed since this was raised',
  unknown_rule: 'Unknown rule',
}

export default async function ExceptionPage({
  params,
}: PageProps<'/workspace/deals/[dealId]/exceptions/[exceptionId]'>) {
  if (!(await getAuthenticatedUser())) {
    redirect('/login')
  }

  const { dealId, exceptionId } = await params

  if (!isUuid(dealId) || !isUuid(exceptionId)) {
    notFound()
  }

  const exception = await getException(exceptionId)

  if (!exception || exception.deal_id !== dealId) {
    notFound()
  }

  const deal = await getDeal(exception.deal_id)

  if (!deal) {
    notFound()
  }

  const [provisions, predecessor, decisions] = await Promise.all([
    listProvisions(deal.id),
    deal.predecessor_deal_id ? getDeal(deal.predecessor_deal_id) : null,
    listExceptionDecisions(exception.id),
  ])

  const provision = exception.provision_id
    ? (provisions.find((p) => p.id === exception.provision_id) ?? null)
    : null
  const citations = provision ? await listProvisionCitations(provision.id) : []

  const applicability = exceptionApplicability(
    exception,
    evaluateDeal({ deal, provisions, predecessor }),
  )
  const rule = ruleOf(exception.rule_key)
  const live = exception.status === 'open' || exception.status === 'under_review'

  const details: [string, string][] = [
    ['Rule', `${exception.rule_key} (version ${exception.rule_version})`],
    ['Severity', EXCEPTION_SEVERITY_LABELS[exception.severity]],
    ['Status', EXCEPTION_STATUS_LABELS[exception.status]],
    ['Current check', APPLICABILITY_LABELS[applicability]],
  ]

  return (
    <main aria-label="Exception" className={PAGE_CLASS}>
      <Link href={`/workspace/deals/${deal.id}`} className={`${TEXT_LINK_CLASS} text-[14px]`}>
        ← Back to the deal
      </Link>
      <h1 className="mt-4 text-[28px] font-bold tracking-tight">{exception.title}</h1>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed">{exception.why}</p>
      <p className="mt-1 text-[13px] text-muted">
        Raised {formatDate(exception.created_at.slice(0, 10))} from the deal&apos;s data at
        that time.
      </p>

      <section aria-label="Exception details" className={`${CARD_CLASS} mt-8`}>
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

      <section aria-label="Evidence" className="mt-8">
        <h2 className="text-[20px] font-bold tracking-tight">Evidence</h2>
        {provision ? (
          <div className={`${CARD_CLASS} mt-3 flex flex-col gap-3 px-6 py-4`}>
            <p className="text-[15px]">
              <Link
                href={`/workspace/deals/${deal.id}/provisions/${provision.id}`}
                className={TEXT_LINK_CLASS}
              >
                {PROVISION_TYPE_LABELS[provision.provision_type]}
              </Link>
              : {provision.value_text}
            </p>
            {citations.length === 0 ? (
              <p className="text-[14px] text-muted">No excerpt supports this provision.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {citations.map(({ excerpt }) => (
                  <li key={excerpt.id} className="text-[14px]">
                    <span className="text-muted">{excerpt.evidence_item.title}: </span>
                    <span className="whitespace-pre-wrap">{excerpt.content}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : rule?.provision_type ? (
          <p className="mt-3 text-[15px] text-muted">
            The provision this exception was raised on has been removed.
          </p>
        ) : (
          <p className="mt-3 text-[15px] text-muted">
            Raised on the deal&apos;s own figures; see the reason above.
          </p>
        )}
      </section>

      <section aria-label="Decisions" className="mt-8">
        <h2 className="text-[20px] font-bold tracking-tight">Decisions</h2>
        {decisions.length === 0 ? (
          <p className="mt-3 text-[15px] text-muted">No decision recorded yet.</p>
        ) : (
          <ol className="mt-3 flex flex-col gap-3">
            {decisions.map((decision) => (
              <li key={decision.id} className={`${CARD_CLASS} flex flex-col gap-1 px-6 py-4`}>
                <p className="text-[15px] font-semibold">
                  {DECISION_TYPE_LABELS[decision.decision_type]}
                  <span className="ml-2 text-[13px] font-normal text-muted">
                    {formatDate(decision.created_at.slice(0, 10))}
                  </span>
                </p>
                <p className="whitespace-pre-wrap text-[15px]">{decision.rationale}</p>
                {decision.conditions ? (
                  <p className="whitespace-pre-wrap text-[14px] text-muted">
                    Conditions: {decision.conditions}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      {live ? (
        <section aria-label="Record decision" className={`${CARD_CLASS} mt-8 p-6`}>
          <h2 className="mb-4 text-[20px] font-bold tracking-tight">Record decision</h2>
          <DecisionForm exceptionId={exception.id} />
        </section>
      ) : null}
    </main>
  )
}
