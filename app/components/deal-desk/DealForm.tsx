'use client'

import { useActionState } from 'react'

import { createDealAction, updateDealAction } from '@/app/lib/actions/deals'
import { initialDealDeskActionState } from '@/app/lib/actions/deal-desk-action-state'
import { DEAL_STAGES, DEAL_TYPES } from '@/app/lib/deal-desk/domain'
import { DEAL_STAGE_LABELS, DEAL_TYPE_LABELS } from '@/app/lib/deal-desk/format'

import { FormField } from './FormField'
import { ERROR_CLASS, FIELD_CLASS, SUBMIT_CLASS } from './styles'

/** Only what the account picker shows; the full account never reaches the browser. */
export type AccountOption = { id: string; name: string }

/**
 * A renewal must name the deal it follows (U13). Choosing a predecessor
 * belongs to the renewal part of Deal Records, so until then the form offers
 * the other types; the server rejects a renewal without a predecessor anyway.
 */
const OFFERED_DEAL_TYPES = DEAL_TYPES.filter((type) => type !== 'renewal')

/** What the form needs to edit an existing deal instead of creating one. */
export type DealEdit = {
  dealId: string
  accountName: string
  /** Only a deal created as a renewal has a predecessor, and may stay one. */
  hasPredecessor: boolean
  /** The deal's current values, keyed by field name. */
  initial: Record<string, string>
}

/**
 * Creates a deal on one of the user's accounts, or edits an existing deal.
 * Validation happens in the Server Action; see AccountForm for why the form
 * is keyed by the result.
 *
 * When editing, the account is shown but cannot be changed: the database
 * grants no UPDATE on a deal's account or predecessor.
 */
export function DealForm({
  accounts = [],
  defaultAccountId = null,
  edit,
}: {
  accounts?: AccountOption[]
  defaultAccountId?: string | null
  edit?: DealEdit
}) {
  const [state, formAction, pending] = useActionState(
    edit ? updateDealAction : createDealAction,
    initialDealDeskActionState,
  )
  const { fieldErrors } = state
  // After a failed submission, what the user typed; otherwise the deal's
  // current values when editing.
  const values = state.at === 0 && edit ? edit.initial : state.values
  const dealTypes = edit?.hasPredecessor ? DEAL_TYPES : OFFERED_DEAL_TYPES

  const text = (
    field: string,
    label: string,
    options: { hint?: string; inputMode?: 'decimal' | 'numeric'; type?: string } = {},
  ) => (
    <FormField id={field} label={label} error={fieldErrors[field]} hint={options.hint}>
      {(props) => (
        <input
          {...props}
          name={field}
          type={options.type ?? 'text'}
          inputMode={options.inputMode}
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

      {edit ? <input type="hidden" name="dealId" value={edit.dealId} /> : null}

      {edit ? (
        <FormField
          id="accountId"
          label="Account"
          hint="A deal stays with the account it was created on."
        >
          {(props) => (
            <input {...props} readOnly value={edit.accountName} className={FIELD_CLASS} />
          )}
        </FormField>
      ) : (
        <FormField id="accountId" label="Account" error={fieldErrors.accountId}>
          {(props) => (
            <select
              {...props}
              name="accountId"
              required
              defaultValue={values.accountId ?? defaultAccountId ?? ''}
              className={FIELD_CLASS}
            >
              <option value="" disabled>
                Choose an account
              </option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          )}
        </FormField>
      )}

      <FormField id="name" label="Deal name" error={fieldErrors.name}>
        {(props) => (
          <input
            {...props}
            name="name"
            required
            maxLength={200}
            defaultValue={values.name ?? ''}
            className={FIELD_CLASS}
          />
        )}
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="dealType" label="Deal type" error={fieldErrors.dealType}>
          {(props) => (
            <select
              {...props}
              name="dealType"
              required
              defaultValue={values.dealType ?? ''}
              className={FIELD_CLASS}
            >
              <option value="" disabled>
                Choose a type
              </option>
              {dealTypes.map((type) => (
                <option key={type} value={type}>
                  {DEAL_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField id="stage" label="Stage" error={fieldErrors.stage}>
          {(props) => (
            <select
              {...props}
              name="stage"
              required
              defaultValue={values.stage ?? ''}
              className={FIELD_CLASS}
            >
              <option value="" disabled>
                Choose a stage
              </option>
              {DEAL_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {DEAL_STAGE_LABELS[stage]}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </div>

      <fieldset className="grid gap-5 sm:grid-cols-3">
        <legend className="sr-only">Commercial terms</legend>
        {text('arrEur', 'ARR (EUR)', { inputMode: 'decimal', hint: 'Annual recurring revenue.' })}
        {text('tcvEur', 'TCV (EUR)', { inputMode: 'decimal' })}
        {text('listPriceEur', 'List price (EUR)', { inputMode: 'decimal' })}
        {text('discountPct', 'Discount (%)', { inputMode: 'decimal' })}
        {text('termMonths', 'Term (months)', { inputMode: 'numeric' })}
        {text('noticePeriodDays', 'Notice period (days)', { inputMode: 'numeric' })}
      </fieldset>

      <fieldset className="grid gap-5 sm:grid-cols-3">
        <legend className="sr-only">Dates</legend>
        {text('startDate', 'Start date', { type: 'date' })}
        {text('endDate', 'End date', { type: 'date' })}
        {text('renewalDate', 'Renewal date', { type: 'date' })}
      </fieldset>

      <FormField id="autoRenew" label="Auto-renews" error={fieldErrors.autoRenew}>
        {(props) => (
          <select
            {...props}
            name="autoRenew"
            defaultValue={values.autoRenew ?? ''}
            className={`${FIELD_CLASS} sm:max-w-xs`}
          >
            <option value="">Not known</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        )}
      </FormField>

      <div>
        <button type="submit" disabled={pending} className={SUBMIT_CLASS}>
          {edit ? (pending ? 'Saving…' : 'Save changes') : pending ? 'Creating…' : 'Create deal'}
        </button>
      </div>
    </form>
  )
}
