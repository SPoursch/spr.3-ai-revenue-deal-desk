'use client'

import { useActionState } from 'react'

import { createProvisionAction, updateProvisionAction } from '@/app/lib/actions/provisions'
import {
  formValues,
  initialDealDeskActionState,
} from '@/app/lib/actions/deal-desk-action-state'
import {
  PROVISION_VALUE_UNITS,
  type DealExcerptGroup,
  type ProvisionType,
} from '@/app/lib/deal-desk/domain'
import { PROVISION_TYPE_LABELS, PROVISION_UNIT_LABELS } from '@/app/lib/deal-desk/format'

import { ExcerptPicker } from './ExcerptPicker'
import { FormField } from './FormField'
import { ERROR_CLASS, FIELD_CLASS, SUBMIT_CLASS } from './styles'

/** `region` is in the schema vocabulary but is not a number, so it is never offered. */
const OFFERED_UNITS = PROVISION_VALUE_UNITS.filter((unit) => unit !== 'region')

/** What the form needs to add a provision to a deal. */
export type ProvisionCreate = {
  dealId: string
  /** The types this deal does not have yet (one provision per type per deal). */
  types: ProvisionType[]
  groups: DealExcerptGroup[]
}

/** What the form needs to edit an existing provision's value. */
export type ProvisionEdit = {
  provisionId: string
  provisionType: ProvisionType
  /** The provision's current values, keyed by field name. */
  initial: Record<string, string>
}

/**
 * Adds a provision with the excerpts it cites, or edits a provision's value.
 * Validation happens in the Server Action; see AccountForm for why the form
 * is keyed by the result.
 *
 * When editing, the type is shown but cannot be changed, and citations are
 * managed on the provision's page.
 */
export function ProvisionForm({ create, edit }: { create?: ProvisionCreate; edit?: ProvisionEdit }) {
  const [state, formAction, pending] = useActionState(
    edit ? updateProvisionAction : createProvisionAction,
    initialDealDeskActionState,
  )
  const { fieldErrors } = state
  const values = formValues(state, edit?.initial)

  return (
    <form key={state.at} action={formAction} noValidate className="flex flex-col gap-5">
      {state.message ? (
        <p role="alert" className={ERROR_CLASS}>
          {state.message}
        </p>
      ) : null}

      {create ? <input type="hidden" name="dealId" value={create.dealId} /> : null}
      {edit ? <input type="hidden" name="provisionId" value={edit.provisionId} /> : null}

      {edit ? (
        <FormField id="provisionType" label="Provision type" hint="A provision keeps its type.">
          {(props) => (
            <input
              {...props}
              readOnly
              value={PROVISION_TYPE_LABELS[edit.provisionType]}
              className={FIELD_CLASS}
            />
          )}
        </FormField>
      ) : (
        <FormField id="provisionType" label="Provision type" error={fieldErrors.provisionType}>
          {(props) => (
            <select
              {...props}
              name="provisionType"
              required
              defaultValue={values.provisionType ?? ''}
              className={FIELD_CLASS}
            >
              <option value="" disabled>
                Choose a type
              </option>
              {create?.types.map((type) => (
                <option key={type} value={type}>
                  {PROVISION_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          )}
        </FormField>
      )}

      <FormField
        id="valueText"
        label="Value"
        error={fieldErrors.valueText}
        hint="The term as the contract states it, e.g. 12 months of fees, EU only, Net 45."
      >
        {(props) => (
          <input
            {...props}
            name="valueText"
            required
            maxLength={500}
            defaultValue={values.valueText ?? ''}
            className={FIELD_CLASS}
          />
        )}
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          id="valueNumeric"
          label="Numeric value"
          error={fieldErrors.valueNumeric}
          hint="Optional. Only for terms with a number."
        >
          {(props) => (
            <input
              {...props}
              name="valueNumeric"
              inputMode="decimal"
              defaultValue={values.valueNumeric ?? ''}
              className={FIELD_CLASS}
            />
          )}
        </FormField>

        <FormField id="valueUnit" label="Unit" error={fieldErrors.valueUnit}>
          {(props) => (
            <select
              {...props}
              name="valueUnit"
              defaultValue={values.valueUnit ?? ''}
              className={FIELD_CLASS}
            >
              <option value="">No number</option>
              {OFFERED_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {PROVISION_UNIT_LABELS[unit]}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </div>

      {create ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">
            Supporting excerpts
          </p>
          <ExcerptPicker
            groups={create.groups}
            selected={values.excerptIds ? values.excerptIds.split(',') : []}
            error={fieldErrors.excerptIds}
          />
        </div>
      ) : null}

      <div>
        <button type="submit" disabled={pending} className={SUBMIT_CLASS}>
          {edit ? (pending ? 'Saving…' : 'Save changes') : pending ? 'Adding…' : 'Add provision'}
        </button>
      </div>
    </form>
  )
}
