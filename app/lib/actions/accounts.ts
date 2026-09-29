'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import type { Account } from '../deal-desk/domain'
import { ACCOUNT_FORM_FIELDS, parseAccountForm, readFormValues } from '../deal-desk/forms'
import { createAccount, DealDeskDatabaseError } from '../db'
import { failure, type DealDeskActionState } from './deal-desk-action-state'
import { requireUser } from './require-auth'

/**
 * Server Actions for accounts (Deal Records).
 *
 * A Server Action is a public POST endpoint, so each one authorises the
 * request itself, validates the submission on the server, and only then
 * calls the existing data layer, which takes ownership from the verified
 * session. Database errors are logged here and replaced by a safe message.
 */

const WORKSPACE_PATH = '/workspace'
const SIGNED_OUT_MESSAGE = 'You need to be signed in.'
const INVALID_MESSAGE = 'Check the highlighted fields and try again.'
const INPUT_REJECTED_MESSAGE =
  'The account could not be saved with these details. Check them and try again.'

/**
 * Creates an account, then continues to a new deal with that account chosen:
 * in Deal Records an account exists to hold deals.
 */
export async function createAccountAction(
  _state: DealDeskActionState,
  formData: FormData,
): Promise<DealDeskActionState> {
  // Authorise before anything else: an unauthenticated caller must not reach
  // validation, the database, or any message that reveals either.
  if (await requireUser()) {
    return failure(SIGNED_OUT_MESSAGE)
  }

  const values = readFormValues(formData, ACCOUNT_FORM_FIELDS)
  const parsed = parseAccountForm(formData)

  if (!parsed.ok) {
    return failure(INVALID_MESSAGE, parsed.fieldErrors, values)
  }

  let account: Account

  try {
    account = await createAccount(parsed.value)
  } catch (error) {
    // Account names are unique per owner, so this names only the caller's
    // own account and reveals nothing about anyone else's.
    if (error instanceof DealDeskDatabaseError && error.cause.code === '23505') {
      console.error('[accounts] insert rejected as a duplicate:', error.message)

      return failure(
        INVALID_MESSAGE,
        { name: 'You already have an account with that name.' },
        values,
      )
    }

    // Other rejected input would fail again on retry, so say what to fix.
    if (error instanceof DealDeskDatabaseError && error.kind === 'invalid_input') {
      console.error('[accounts] insert rejected:', error.message)

      return failure(INPUT_REJECTED_MESSAGE, {}, values)
    }

    console.error('[accounts] insert failed:', error)

    return failure('Could not create the account. Please try again.', {}, values)
  }

  revalidatePath(WORKSPACE_PATH)

  // Outside the try block: redirect() works by throwing.
  redirect(`${WORKSPACE_PATH}/deals/new?accountId=${account.id}`)
}
