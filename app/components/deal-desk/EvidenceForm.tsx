'use client'

import { useActionState } from 'react'

import { createEvidenceAction } from '@/app/lib/actions/evidence'
import { initialDealDeskActionState } from '@/app/lib/actions/deal-desk-action-state'
import { EVIDENCE_TYPES } from '@/app/lib/deal-desk/domain'
import { EVIDENCE_TYPE_LABELS } from '@/app/lib/deal-desk/format'

import { FormField } from './FormField'
import { ERROR_CLASS, FIELD_CLASS, FIELD_ERROR_CLASS, SUBMIT_CLASS } from './styles'

/**
 * Adds pasted evidence to a deal. Validation happens in the Server Action;
 * see AccountForm for why the form is keyed by the result.
 *
 * The deal id travels as a hidden field only to say which deal is meant: the
 * action reads that deal as the caller, so it can only ever be one of theirs.
 */
export function EvidenceForm({ dealId }: { dealId: string }) {
  const [state, formAction, pending] = useActionState(
    createEvidenceAction,
    initialDealDeskActionState,
  )
  const { fieldErrors, values } = state

  const text = (field: string, label: string, options: { type?: string } = {}) => (
    <FormField id={field} label={label} error={fieldErrors[field]}>
      {(props) => (
        <input
          {...props}
          name={field}
          type={options.type ?? 'text'}
          defaultValue={values[field] ?? ''}
          className={FIELD_CLASS}
        />
      )}
    </FormField>
  )

  return (
    <form key={state.at} action={formAction} noValidate className="flex flex-col gap-5">
      {state.message ? (
        <p role="alert" className={ERROR_CLASS}>
          {state.message}
        </p>
      ) : null}

      <input type="hidden" name="dealId" value={dealId} />

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="evidenceType" label="Evidence type" error={fieldErrors.evidenceType}>
          {(props) => (
            <select
              {...props}
              name="evidenceType"
              required
              defaultValue={values.evidenceType ?? ''}
              className={FIELD_CLASS}
            >
              <option value="" disabled>
                Choose a type
              </option>
              {EVIDENCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {EVIDENCE_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField id="title" label="Title" error={fieldErrors.title}>
          {(props) => (
            <input
              {...props}
              name="title"
              required
              maxLength={300}
              defaultValue={values.title ?? ''}
              className={FIELD_CLASS}
            />
          )}
        </FormField>
      </div>

      <FormField
        id="bodyText"
        label="Evidence text"
        error={fieldErrors.bodyText}
        hint="Paste the text. Each paragraph, separated by a blank line, becomes one excerpt."
      >
        {(props) => (
          <textarea
            {...props}
            name="bodyText"
            required
            rows={12}
            defaultValue={values.bodyText ?? ''}
            className={FIELD_CLASS}
          />
        )}
      </FormField>

      <fieldset className="grid gap-5 sm:grid-cols-3">
        <legend className="sr-only">Provenance</legend>
        {text('author', 'Author')}
        {text('versionLabel', 'Version')}
        {text('documentDate', 'Document date', { type: 'date' })}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-[15px]">
          <input
            type="checkbox"
            name="isExecuted"
            value="yes"
            defaultChecked={values.isExecuted === 'yes'}
            aria-invalid={Boolean(fieldErrors.isExecuted)}
          />
          Executed version
        </label>
        {fieldErrors.isExecuted ? (
          <p className={FIELD_ERROR_CLASS}>{fieldErrors.isExecuted}</p>
        ) : null}
      </div>

      <div>
        <button type="submit" disabled={pending} className={SUBMIT_CLASS}>
          {pending ? 'Adding…' : 'Add evidence'}
        </button>
      </div>
    </form>
  )
}
