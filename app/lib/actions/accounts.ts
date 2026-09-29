'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import type { Account } from '../deal-desk/domain'
import {
  ACCOUNT_FORM_FIELDS,
  isUuid,
  parseAccountForm,
  readFormValues,
} from '../deal-desk/forms'
import { createAccount, DealDeskDatabaseError, deleteAccount, updateAccount } from '../db'
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
const DUPLICATE_NAME_MESSAGE = 'You already have an account with that name.'
const NOT_FOUND_MESSAGE = 'This account no longer exists, or it is not one of yours.'
const ACCOUNTS_PATH = '/workspace/accounts'
const HAS_LINKED_RENEWAL_MESSAGE =
  'This account cannot be deleted: a renewal on another account follows one of its deals. Delete that renewal first.'

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
        { name: DUPLICATE_NAME_MESSAGE },
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

/**
 * Saves changes to an account, then returns to the account list.
 *
 * The submitted `accountId` only says which account is meant: the update
 * runs as the caller, so row level security decides whether it is theirs,
 * and someone else's reads the same as one that does not exist.
 */
export async function updateAccountAction(
  _state: DealDeskActionState,
  formData: FormData,
): Promise<DealDeskActionState> {
  if (await requireUser()) {
    return failure(SIGNED_OUT_MESSAGE)
  }

  const accountId = formData.get('accountId')
  const values = readFormValues(formData, ACCOUNT_FORM_FIELDS)

  if (!isUuid(accountId)) {
    return failure(NOT_FOUND_MESSAGE, {}, values)
  }

  const parsed = parseAccountForm(formData)

  if (!parsed.ok) {
    return failure(INVALID_MESSAGE, parsed.fieldErrors, values)
  }

  let updated: Account | null

  try {
    updated = await updateAccount(accountId, parsed.value)
  } catch (error) {
    if (error instanceof DealDeskDatabaseError && error.cause.code === '23505') {
      console.error('[accounts] update rejected as a duplicate:', error.message)

      return failure(INVALID_MESSAGE, { name: DUPLICATE_NAME_MESSAGE }, values)
    }

    if (error instanceof DealDeskDatabaseError && error.kind === 'invalid_input') {
      console.error('[accounts] update rejected:', error.message)

      return failure(INPUT_REJECTED_MESSAGE, {}, values)
    }

    console.error('[accounts] update failed:', error)

    return failure('Could not save the account. Please try again.', {}, values)
  }

  if (!updated) {
    return failure(NOT_FOUND_MESSAGE, {}, values)
  }

  revalidatePath(WORKSPACE_PATH, 'layout')

  // Outside the try block: redirect() works by throwing.
  redirect(ACCOUNTS_PATH)
}

/**
 * Deletes an account and, through the database's cascade, every deal on it,
 * then returns to the account list. Reached only from the confirmation page.
 */
export async function deleteAccountAction(
  _state: DealDeskActionState,
  formData: FormData,
): Promise<DealDeskActionState> {
  if (await requireUser()) {
    return failure(SIGNED_OUT_MESSAGE)
  }

  const accountId = formData.get('accountId')

  if (!isUuid(accountId)) {
    return failure(NOT_FOUND_MESSAGE)
  }

  let deleted: Account | null

  try {
    deleted = await deleteAccount(accountId)
  } catch (error) {
    // The cascade would leave a renewal on another account without its
    // predecessor, which deals_renewal_requires_predecessor_check refuses.
    if (error instanceof DealDeskDatabaseError && error.cause.code === '23514') {
      console.error('[accounts] delete refused:', error.message)

      return failure(HAS_LINKED_RENEWAL_MESSAGE)
    }

    console.error('[accounts] delete failed:', error)

    return failure('Could not delete the account. Please try again.')
  }

  if (!deleted) {
    return failure(NOT_FOUND_MESSAGE)
  }

  revalidatePath(WORKSPACE_PATH, 'layout')

  redirect(ACCOUNTS_PATH)
}
