'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import type { Deal } from '../deal-desk/domain'
import { DEAL_FORM_FIELDS, parseDealForm, readFormValues } from '../deal-desk/forms'
import { createDeal, DealDeskDatabaseError } from '../db'
import { failure, type DealDeskActionState } from './deal-desk-action-state'
import { requireUser } from './require-auth'

/**
 * Server Actions for deals (Deal Records).
 *
 * Same contract as the account actions: authorise, validate on the server,
 * call the existing data layer, and show only safe messages. The data layer
 * takes the owner from the verified session; the form never supplies it.
 */

const WORKSPACE_PATH = '/workspace'
const SIGNED_OUT_MESSAGE = 'You need to be signed in.'
const INVALID_MESSAGE = 'Check the highlighted fields and try again.'
const INPUT_REJECTED_MESSAGE =
  'The deal could not be saved with these details. Check them and try again.'
const CREATE_FAILED_MESSAGE = 'Could not create the deal. Please try again.'

/** Creates a deal, then opens it. */
export async function createDealAction(
  _state: DealDeskActionState,
  formData: FormData,
): Promise<DealDeskActionState> {
  if (await requireUser()) {
    return failure(SIGNED_OUT_MESSAGE)
  }

  const values = readFormValues(formData, DEAL_FORM_FIELDS)
  const parsed = parseDealForm(formData)

  if (!parsed.ok) {
    return failure(INVALID_MESSAGE, parsed.fieldErrors, values)
  }

  let deal: Deal

  try {
    deal = await createDeal(parsed.value)
  } catch (error) {
    // Rejected input will fail again on retry, so say what to fix. An account
    // that is not the caller's is refused by the composite foreign key
    // deals_account_fkey and reads the same as one that does not exist, so
    // nothing about other users leaks.
    if (error instanceof DealDeskDatabaseError && error.kind === 'invalid_input') {
      console.error('[deals] insert rejected:', error.message)

      if (error.cause.message.includes('deals_account_fkey')) {
        return failure(
          INVALID_MESSAGE,
          { accountId: 'That account is not available. Choose one of your accounts.' },
          values,
        )
      }

      return failure(INPUT_REJECTED_MESSAGE, {}, values)
    }

    console.error('[deals] insert failed:', error)

    return failure(CREATE_FAILED_MESSAGE, {}, values)
  }

  revalidatePath(WORKSPACE_PATH)

  // Outside the try block: redirect() works by throwing.
  redirect(`${WORKSPACE_PATH}/deals/${deal.id}`)
}
