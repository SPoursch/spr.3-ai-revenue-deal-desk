'use client'

import { useActionState } from 'react'

import { checkDealAction, recordDecisionAction } from '@/app/lib/actions/exceptions'
import { initialDealDeskActionState } from '@/app/lib/actions/deal-desk-action-state'
import { DECISION_TYPES } from '@/app/lib/deal-desk/domain'
import { DECISION_TYPE_LABELS } from '@/app/lib/deal-desk/format'

import { FormField } from './FormField'
import { ERROR_CLASS, FIELD_CLASS, SUBMIT_CLASS } from './styles'

/**
 * Runs the deal's rules. Only the deal id reaches the action, which reads the
 * deal as the caller; the summary of the run is shown as a status, a failure
 * as an alert.
 */
export function CheckDealForm({ dealId }: { dealId: string }) {
  const [state, formAction, pending] = useActionState(checkDealAction, initialDealDeskActionState)

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="dealId" value={dealId} />
      <div>
        <button type="submit" disabled={pending} className={SUBMIT_CLASS}>
          {pending ? 'Checking…' : 'Check deal'}
        </button>
      </div>
      {state.message ? (
        state.ok ? (
          <p role="status" className="text-[14px] text-muted">
            {state.message}
          </p>
        ) : (
          <p role="alert" className={ERROR_CLASS}>
            {state.message}
          </p>
        )
      ) : null}
    </form>
  )
}

/**
 * A human's Decision on one exception. Validation happens in the Server
 * Action; see AccountForm for why the form is keyed by the result.
 */
export function DecisionForm({ exceptionId }: { exceptionId: string }) {
  const [state, formAction, pending] = useActionState(
    recordDecisionAction,
    initialDealDeskActionState,
  )
  const { fieldErrors, values } = state

  return (
    <form key={state.at} action={formAction} noValidate className="flex flex-col gap-5">
      {state.message ? (
        <p role="alert" className={ERROR_CLASS}>
          {state.message}
        </p>
      ) : null}

      <input type="hidden" name="exceptionId" value={exceptionId} />

      <FormField id="decisionType" label="Decision" error={fieldErrors.decisionType}>
        {(props) => (
          <select
            {...props}
            name="decisionType"
            required
            defaultValue={values.decisionType ?? ''}
            className={FIELD_CLASS}
          >
            <option value="" disabled>
              Choose a decision
            </option>
            {DECISION_TYPES.map((type) => (
              <option key={type} value={type}>
                {DECISION_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        )}
      </FormField>

      <FormField id="rationale" label="Rationale" error={fieldErrors.rationale}>
        {(props) => (
          <textarea
            {...props}
            name="rationale"
            required
            rows={4}
            defaultValue={values.rationale ?? ''}
            className={FIELD_CLASS}
          />
        )}
      </FormField>

      <FormField
        id="conditions"
        label="Conditions"
        error={fieldErrors.conditions}
        hint="Only for “Approve with conditions”: what the approval depends on."
      >
        {(props) => (
          <textarea
            {...props}
            name="conditions"
            rows={3}
            defaultValue={values.conditions ?? ''}
            className={FIELD_CLASS}
          />
        )}
      </FormField>

      <div>
        <button type="submit" disabled={pending} className={SUBMIT_CLASS}>
          {pending ? 'Recording…' : 'Record decision'}
        </button>
      </div>
    </form>
  )
}
