'use client'

import { useActionState } from 'react'

import { createAccountAction } from '@/app/lib/actions/accounts'
import { initialDealDeskActionState } from '@/app/lib/actions/deal-desk-action-state'

import { FormField } from './FormField'
import { ERROR_CLASS, FIELD_CLASS, SUBMIT_CLASS } from './styles'

/**
 * Creates an account. A Client Component only because `useActionState` is a
 * hook; validation happens in the Server Action, and the browser's own
 * `required` and `maxLength` are a convenience, not the check.
 *
 * The form is keyed by the result so that after a failed submission it is
 * re-mounted with the submitted values, instead of React's post-action reset
 * clearing them.
 */
export function AccountForm() {
  const [state, formAction, pending] = useActionState(
    createAccountAction,
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
          {pending ? 'Creating…' : 'Create account'}
        </button>
      </div>
    </form>
  )
}
