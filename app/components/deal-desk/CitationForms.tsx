'use client'

import { useActionState } from 'react'

import { addCitationsAction, removeCitationAction } from '@/app/lib/actions/provisions'
import { initialDealDeskActionState } from '@/app/lib/actions/deal-desk-action-state'
import type { DealExcerptGroup } from '@/app/lib/deal-desk/domain'

import { ExcerptPicker } from './ExcerptPicker'
import { ERROR_CLASS, SECONDARY_LINK_CLASS, SUBMIT_CLASS } from './styles'

/**
 * Cites more of the deal's excerpts in support of a provision. Only ids reach
 * the action, which reads the provision as the caller and checks that every
 * excerpt is of its deal.
 */
export function AddCitationsForm({
  provisionId,
  groups,
}: {
  provisionId: string
  groups: DealExcerptGroup[]
}) {
  const [state, formAction, pending] = useActionState(
    addCitationsAction,
    initialDealDeskActionState,
  )

  return (
    <form key={state.at} action={formAction} className="flex flex-col gap-4">
      {state.message ? (
        <p role="alert" className={ERROR_CLASS}>
          {state.message}
        </p>
      ) : null}
      <input type="hidden" name="provisionId" value={provisionId} />
      <ExcerptPicker groups={groups} error={state.fieldErrors.excerptIds} />
      <div>
        <button type="submit" disabled={pending} className={SUBMIT_CLASS}>
          {pending ? 'Adding…' : 'Add citations'}
        </button>
      </div>
    </form>
  )
}

/** Removes one citation; the provision and the excerpt stay. */
export function RemoveCitationForm({
  provisionId,
  excerptId,
}: {
  provisionId: string
  excerptId: string
}) {
  const [state, formAction, pending] = useActionState(
    removeCitationAction,
    initialDealDeskActionState,
  )

  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state.message ? (
        <p role="alert" className={ERROR_CLASS}>
          {state.message}
        </p>
      ) : null}
      <input type="hidden" name="provisionId" value={provisionId} />
      <input type="hidden" name="excerptId" value={excerptId} />
      <div>
        <button type="submit" disabled={pending} className={SECONDARY_LINK_CLASS}>
          {pending ? 'Removing…' : 'Remove citation'}
        </button>
      </div>
    </form>
  )
}
