'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { deleteAccountAction } from '@/app/lib/actions/accounts'
import { deleteDealAction } from '@/app/lib/actions/deals'
import { deleteProvisionAction } from '@/app/lib/actions/provisions'
import { initialDealDeskActionState } from '@/app/lib/actions/deal-desk-action-state'

import { ERROR_CLASS, SECONDARY_LINK_CLASS } from './styles'

/** The destructive variant of the submit button. */
const DELETE_BUTTON_CLASS =
  'rounded-[var(--radius-control)] bg-danger px-4 py-2.5 text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'

const TARGETS = {
  deal: { action: deleteDealAction, idField: 'dealId', label: 'Delete deal' },
  account: { action: deleteAccountAction, idField: 'accountId', label: 'Delete account' },
  provision: {
    action: deleteProvisionAction,
    idField: 'provisionId',
    label: 'Delete provision',
  },
} as const

/**
 * The confirm and cancel buttons of a delete confirmation page.
 *
 * A Client Component only for the pending state and for showing a refusal
 * (for example, a deal a renewal still depends on) without leaving the page.
 * The page around it is rendered on the server, and nothing is deleted until
 * this form is submitted.
 */
export function ConfirmDeleteForm({
  target,
  id,
  cancelHref,
}: {
  target: keyof typeof TARGETS
  id: string
  cancelHref: string
}) {
  const { action, idField, label } = TARGETS[target]
  const [state, formAction, pending] = useActionState(action, initialDealDeskActionState)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.message ? (
        <p role="alert" className={ERROR_CLASS}>
          {state.message}
        </p>
      ) : null}
      <input type="hidden" name={idField} value={id} />
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={DELETE_BUTTON_CLASS}>
          {pending ? 'Deleting…' : label}
        </button>
        <Link href={cancelHref} className={SECONDARY_LINK_CLASS}>
          Cancel
        </Link>
      </div>
    </form>
  )
}
