'use client'

import { useActionState } from 'react'

import { recreateEvidenceExcerptsAction } from '@/app/lib/actions/evidence'
import { initialDealDeskActionState } from '@/app/lib/actions/deal-desk-action-state'

import { ERROR_CLASS, SUBMIT_CLASS } from './styles'

/**
 * The recovery button for evidence whose excerpts failed to be created. A
 * Client Component only for the pending state and for showing a refusal
 * without leaving the page; the action re-reads the item as the caller.
 */
export function RecreateExcerptsForm({ evidenceId }: { evidenceId: string }) {
  const [state, formAction, pending] = useActionState(
    recreateEvidenceExcerptsAction,
    initialDealDeskActionState,
  )

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-4">
      {state.message ? (
        <p role="alert" className={ERROR_CLASS}>
          {state.message}
        </p>
      ) : null}
      <input type="hidden" name="evidenceId" value={evidenceId} />
      <div>
        <button type="submit" disabled={pending} className={SUBMIT_CLASS}>
          {pending ? 'Creating…' : 'Create excerpts'}
        </button>
      </div>
    </form>
  )
}
