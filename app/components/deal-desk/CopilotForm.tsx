'use client'

import { useActionState } from 'react'

import { askCopilotAction } from '@/app/lib/actions/copilot'
import { initialDealDeskActionState } from '@/app/lib/actions/deal-desk-action-state'
import { MAX_QUESTION_LENGTH } from '@/app/lib/deal-desk/copilot'

import { FormField } from './FormField'
import { ERROR_CLASS, FIELD_CLASS, SUBMIT_CLASS } from './styles'

/**
 * The Copilot's single question box (Feature 6). Validation happens in the
 * Server Action; see AccountForm for why the form is keyed by the result. A
 * stored answer appears in the answer list below, which the action
 * refreshes; a failure is shown here as an alert.
 *
 * The deal id travels as a hidden field only to say which deal is meant: the
 * action reads that deal as the caller, so it can only ever be one of theirs.
 */
export function CopilotForm({ dealId }: { dealId: string }) {
  const [state, formAction, pending] = useActionState(askCopilotAction, initialDealDeskActionState)
  const { fieldErrors, values } = state

  return (
    <form key={state.at} action={formAction} noValidate className="flex flex-col gap-4">
      {state.message && !state.ok ? (
        <p role="alert" className={ERROR_CLASS}>
          {state.message}
        </p>
      ) : null}

      <input type="hidden" name="dealId" value={dealId} />

      <FormField
        id="question"
        label="Question"
        error={fieldErrors.question}
        hint={`One question about this deal, up to ${MAX_QUESTION_LENGTH} characters.`}
      >
        {(props) => (
          <textarea
            {...props}
            name="question"
            required
            rows={2}
            maxLength={MAX_QUESTION_LENGTH}
            defaultValue={values.question ?? ''}
            className={FIELD_CLASS}
          />
        )}
      </FormField>

      <div>
        <button type="submit" disabled={pending} className={SUBMIT_CLASS}>
          {pending ? 'Asking…' : 'Ask'}
        </button>
      </div>
    </form>
  )
}
