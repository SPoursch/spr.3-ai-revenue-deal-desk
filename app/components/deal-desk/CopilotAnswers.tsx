import Link from 'next/link'

import {
  AI_ANSWER_LABEL,
  UNSUPPORTED_LABEL,
  changedFactRefs,
  readAnswerPayload,
  statusMessage,
  type CopilotAnswerPayload,
  type CopilotSource,
  type UnsupportedReason,
} from '@/app/lib/deal-desk/copilot'
import type { DealException } from '@/app/lib/deal-desk/domain'
import { formatDate } from '@/app/lib/deal-desk/format'
import type { CopilotAnswerRecord } from '@/app/lib/db'

import { CARD_CLASS, TEXT_LINK_CLASS } from './styles'

/**
 * The stored Copilot answers of one deal, newest first (Feature 6). Each is
 * shown as it was stored — never regenerated — labelled as AI output.
 *
 * A claim shows only what it cites: an excerpt with its evidence title, a
 * fact as the value snapshotted with the answer (and whether it has changed
 * since), an exception of this deal, or a precedent Decision. A claim without
 * valid support is marked Unsupported. Nothing here records or changes
 * anything.
 */

const UNSUPPORTED_REASONS: Record<UnsupportedReason, string> = {
  no_valid_reference: 'no valid source',
  number_not_in_sources: 'a number is not in its sources',
}

type Claim = CopilotAnswerPayload['claims'][number]
type Ref = Claim['refs'][number]

function Citation({
  dealId,
  record,
  payload,
  changed,
  exceptions,
  citedRef,
}: {
  dealId: string
  record: CopilotAnswerRecord
  payload: CopilotAnswerPayload
  changed: string[]
  exceptions: Pick<DealException, 'id' | 'title'>[]
  citedRef: Ref
}) {
  switch (citedRef.kind) {
    case 'excerpt': {
      const citation = record.citations.find((c) => c.excerpt_id === citedRef.ref)
      if (!citation) return <span className="text-muted">An excerpt that is no longer available</span>
      return (
        <>
          <Link
            href={`/workspace/deals/${dealId}/evidence/${citation.evidence_item_id}`}
            className={TEXT_LINK_CLASS}
          >
            {citation.evidence_title}
          </Link>
          : <q>{citation.content}</q>
          {citation.quote ? <span className="text-muted"> (quoted: “{citation.quote}”)</span> : null}
        </>
      )
    }
    case 'fact': {
      const fact = payload.facts.find((f) => f.ref === citedRef.ref)
      if (!fact) return <span className="text-muted">A fact that is no longer available</span>
      return (
        <>
          {fact.label}: {fact.value}
          {changed.includes(fact.ref) ? (
            <span className="text-muted"> (changed since this answer)</span>
          ) : null}
        </>
      )
    }
    case 'exception': {
      const exception = exceptions.find((e) => e.id === citedRef.ref)
      if (!exception) return <span className="text-muted">An exception of this deal</span>
      return (
        <>
          Exception:{' '}
          <Link
            href={`/workspace/deals/${dealId}/exceptions/${exception.id}`}
            className={TEXT_LINK_CLASS}
          >
            {exception.title}
          </Link>
        </>
      )
    }
    case 'decision':
      return <>A precedent Decision</>
  }
}

function Answer({
  dealId,
  record,
  currentSources,
  exceptions,
}: {
  dealId: string
  record: CopilotAnswerRecord
  currentSources: CopilotSource[]
  exceptions: Pick<DealException, 'id' | 'title'>[]
}) {
  const { finding } = record
  const payload = readAnswerPayload(finding.payload)
  const message = payload ? statusMessage(payload.status) : null
  const changed = payload ? changedFactRefs(payload, currentSources) : []

  return (
    <article aria-label="Copilot answer" className="flex flex-col gap-3 px-6 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[15px] font-semibold">{payload?.question ?? 'Question unavailable'}</p>
        <p className="text-[13px] text-muted">
          {AI_ANSWER_LABEL} · {formatDate(finding.created_at.slice(0, 10))} · {finding.model}
        </p>
      </div>

      {!payload ? (
        <p className="text-[15px] text-muted">This answer could not be shown.</p>
      ) : null}
      {message ? <p className="text-[15px]">{message}</p> : null}

      {payload && payload.claims.length > 0 ? (
        <ul aria-label="Claims" className="flex flex-col gap-3">
          {payload.claims.map((claim, index) => (
            <li key={index} className="flex flex-col gap-1 text-[15px]">
              <p>
                {claim.text}
                {!claim.supported ? (
                  <span className="ml-2 text-[13px] font-semibold text-danger">
                    {UNSUPPORTED_LABEL}
                    {claim.unsupported_reason
                      ? ` — ${UNSUPPORTED_REASONS[claim.unsupported_reason]}`
                      : null}
                  </span>
                ) : null}
              </p>
              {/* Not a nested list: each claim is one item of the Claims list. */}
              {claim.refs.map((citedRef) => (
                <p key={`${citedRef.kind}:${citedRef.ref}`} className="pl-4 text-[14px]">
                  <span className="text-muted">Source: </span>
                  <Citation
                    dealId={dealId}
                    record={record}
                    payload={payload}
                    changed={changed}
                    exceptions={exceptions}
                    citedRef={citedRef}
                  />
                </p>
              ))}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  )
}

export function CopilotAnswers({
  dealId,
  answers,
  currentSources,
  exceptions,
}: {
  dealId: string
  answers: CopilotAnswerRecord[]
  /** The deal's facts as they are now, to tell which snapshots have changed. */
  currentSources: CopilotSource[]
  exceptions: Pick<DealException, 'id' | 'title'>[]
}) {
  return (
    <section aria-label="Copilot answers" className="flex flex-col gap-3">
      <h3 className="text-[16px] font-bold tracking-tight">Copilot answers</h3>
      {answers.length === 0 ? (
        <p className="text-[15px] text-muted">No Copilot answers yet.</p>
      ) : (
        <div className={`${CARD_CLASS} divide-y divide-border`}>
          {answers.map((record) => (
            <Answer
              key={record.finding.id}
              dealId={dealId}
              record={record}
              currentSources={currentSources}
              exceptions={exceptions}
            />
          ))}
        </div>
      )}
    </section>
  )
}
