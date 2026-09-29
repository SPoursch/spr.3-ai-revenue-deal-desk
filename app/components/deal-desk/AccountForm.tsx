'use client'

import { useActionState } from 'react'

import { createAccountAction, updateAccountAction } from '@/app/lib/actions/accounts'
import {
  formValues,
  initialDealDeskActionState,
} from '@/app/lib/actions/deal-desk-action-state'

import { FormField } from './FormField'
import { ERROR_CLASS, FIELD_CLASS, SUBMIT_CLASS } from './styles'

/**
 * Creates an account, or edits an existing one. A Client Component only because `useActionState` is a
 * hook; validation happens in the Server Action, and the browser's own
 * `required` and `maxLength` are a convenience, not the check.
 *
 * The form is keyed by the result so that after a failed submission it is
 * re-mounted with the submitted values, instead of React's post-action reset
 * clearing them.
 */
export function AccountForm({
  edit,
}: {
  /** An existing account to edit: its id and current values. */
  edit?: { accountId: string; initial: Record<string, string> }
} = {}) {
  const [state, formAction, pending] = useActionState(
    edit ? updateAccountAction : createAccountAction,
    initialDealDeskActionState,
  )
  const { fieldErrors } = state
  // What the user typed after a failed submission; otherwise, when editing,
  // the account's current values (also after a result with no values).
  const values = formValues(state, edit?.initial)

  return (
    <form key={state.at} action={formAction} noValidate className="flex flex-col gap-5">
      {state.message ? (
        <p role="alert" className={ERROR_CLASS}>
          {state.message}
        </p>
      ) : null}

      {edit ? <input type="hidden" name="accountId" value={edit.accountId} /> : null}

      <FormField id="name" label="Account name" error={fieldErrors.name}>
        {(props) => (
          <input
            {...props}
            name="name"
            required
            maxLength={200}
            autoComplete="organization"
            defaultValue={values.name ?? ''}
            className={FIELD_CLASS}
          />
        )}
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="region" label="Region" error={fieldErrors.region}>
          {(props) => (
            <input
              {...props}
              name="region"
              maxLength={200}
              placeholder="e.g. EMEA"
              defaultValue={values.region ?? ''}
              className={FIELD_CLASS}
            />
          )}
        </FormField>

        <FormField
          id="countryCode"
          label="Country code"
          error={fieldErrors.countryCode}
          hint="Two letters, e.g. DE."
        >
          {(props) => (
            <input
              {...props}
              name="countryCode"
              maxLength={2}
              autoComplete="country"
              defaultValue={values.countryCode ?? ''}
              className={`${FIELD_CLASS} uppercase`}
            />
          )}
        </FormField>

        <FormField id="segment" label="Segment" error={fieldErrors.segment}>
          {(props) => (
            <input
              {...props}
              name="segment"
              maxLength={200}
              placeholder="e.g. Enterprise"
              defaultValue={values.segment ?? ''}
              className={FIELD_CLASS}
            />
          )}
        </FormField>

        <FormField id="industry" label="Industry" error={fieldErrors.industry}>
          {(props) => (
            <input
              {...props}
              name="industry"
              maxLength={200}
              defaultValue={values.industry ?? ''}
              className={FIELD_CLASS}
            />
          )}
        </FormField>
      </div>

      <div>
        <button type="submit" disabled={pending} className={SUBMIT_CLASS}>
          {edit ? (pending ? 'Saving…' : 'Save changes') : pending ? 'Creating…' : 'Create account'}
        </button>
      </div>
    </form>
  )
}
