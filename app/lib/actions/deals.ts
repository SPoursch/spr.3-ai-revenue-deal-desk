'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import type { Deal } from '../deal-desk/domain'
import {
  DEAL_FORM_FIELDS,
  isUuid,
  parseDealForm,
  parseDealUpdateForm,
  parseRenewalForm,
  readFormValues,
} from '../deal-desk/forms'
import { createDeal, DealDeskDatabaseError, deleteDeal, getDeal, updateDeal } from '../db'
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
const NOT_FOUND_MESSAGE = 'This deal no longer exists, or it is not one of yours.'
const UPDATE_FAILED_MESSAGE = 'Could not save the deal. Please try again.'
const DELETE_FAILED_MESSAGE = 'Could not delete the deal. Please try again.'
const CREATE_RENEWAL_FAILED_MESSAGE = 'Could not create the renewal. Please try again.'
const HAS_RENEWAL_MESSAGE =
  'This deal cannot be deleted while a renewal is linked to it. Delete the renewal first.'

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

/**
 * Creates a renewal of one of the caller's deals, then opens it.
 *
 * A renewal is a new deal linked to its predecessor (U13). The submitted
 * `predecessorDealId` only says which deal is being renewed: it is read as
 * the caller, so row level security decides whether it is theirs, and
 * someone else's reads the same as one that does not exist. The renewal's
 * type is always `renewal` and its account is the stored predecessor's;
 * nothing the form submits for either is read.
 */
export async function createRenewalAction(
  _state: DealDeskActionState,
  formData: FormData,
): Promise<DealDeskActionState> {
  if (await requireUser()) {
    return failure(SIGNED_OUT_MESSAGE)
  }

  const predecessorDealId = formData.get('predecessorDealId')
  const values = readFormValues(formData, DEAL_FORM_FIELDS)

  if (!isUuid(predecessorDealId)) {
    return failure(NOT_FOUND_MESSAGE, {}, values)
  }

  const parsed = parseRenewalForm(formData)

  if (!parsed.ok) {
    return failure(INVALID_MESSAGE, parsed.fieldErrors, values)
  }

  let renewal: Deal

  try {
    const predecessor = await getDeal(predecessorDealId)

    if (!predecessor) {
      return failure(NOT_FOUND_MESSAGE, {}, values)
    }

    renewal = await createDeal({
      ...parsed.value,
      account_id: predecessor.account_id,
      predecessor_deal_id: predecessor.id,
    })
  } catch (error) {
    if (error instanceof DealDeskDatabaseError && error.kind === 'invalid_input') {
      console.error('[deals] renewal insert rejected:', error.message)

      return failure(INPUT_REJECTED_MESSAGE, {}, values)
    }

    console.error('[deals] renewal insert failed:', error)

    return failure(CREATE_RENEWAL_FAILED_MESSAGE, {}, values)
  }

  // The predecessor's page now links to the renewal, so not only the list.
  revalidatePath(WORKSPACE_PATH, 'layout')

  // Outside the try block: redirect() works by throwing.
  redirect(`${WORKSPACE_PATH}/deals/${renewal.id}`)
}

/**
 * Saves changes to a deal, then opens it.
 *
 * The submitted `dealId` only says which deal is meant: the deal is read and
 * written as the caller, so row level security decides whether it is theirs,
 * and someone else's reads the same as one that does not exist. The account
 * and predecessor are never part of the update.
 */
export async function updateDealAction(
  _state: DealDeskActionState,
  formData: FormData,
): Promise<DealDeskActionState> {
  if (await requireUser()) {
    return failure(SIGNED_OUT_MESSAGE)
  }

  const dealId = formData.get('dealId')
  const values = readFormValues(formData, DEAL_FORM_FIELDS)

  if (!isUuid(dealId)) {
    return failure(NOT_FOUND_MESSAGE, {}, values)
  }

  let updated: Deal | null

  try {
    const current = await getDeal(dealId)

    if (!current) {
      return failure(NOT_FOUND_MESSAGE, {}, values)
    }

    const parsed = parseDealUpdateForm(formData, {
      hasPredecessor: current.predecessor_deal_id !== null,
    })

    if (!parsed.ok) {
      return failure(INVALID_MESSAGE, parsed.fieldErrors, values)
    }

    updated = await updateDeal(dealId, parsed.value)
  } catch (error) {
    if (error instanceof DealDeskDatabaseError && error.kind === 'invalid_input') {
      console.error('[deals] update rejected:', error.message)

      return failure(INPUT_REJECTED_MESSAGE, {}, values)
    }

    console.error('[deals] update failed:', error)

    return failure(UPDATE_FAILED_MESSAGE, {}, values)
  }

  if (!updated) {
    return failure(NOT_FOUND_MESSAGE, {}, values)
  }

  revalidatePath(WORKSPACE_PATH, 'layout')

  // Outside the try block: redirect() works by throwing.
  redirect(`${WORKSPACE_PATH}/deals/${updated.id}`)
}

/**
 * Deletes a deal, and with it everything attached to it, then returns to the
 * deal list. Reached only from the confirmation page.
 */
export async function deleteDealAction(
  _state: DealDeskActionState,
  formData: FormData,
): Promise<DealDeskActionState> {
  if (await requireUser()) {
    return failure(SIGNED_OUT_MESSAGE)
  }

  const dealId = formData.get('dealId')

  if (!isUuid(dealId)) {
    return failure(NOT_FOUND_MESSAGE)
  }

  let deleted: Deal | null

  try {
    deleted = await deleteDeal(dealId)
  } catch (error) {
    // A renewal must keep its predecessor, so the database refuses to delete
    // a deal a renewal points at (deals_renewal_requires_predecessor_check).
    if (error instanceof DealDeskDatabaseError && error.cause.code === '23514') {
      console.error('[deals] delete refused:', error.message)

      return failure(HAS_RENEWAL_MESSAGE)
    }

    console.error('[deals] delete failed:', error)

    return failure(DELETE_FAILED_MESSAGE)
  }

  if (!deleted) {
    return failure(NOT_FOUND_MESSAGE)
  }

  revalidatePath(WORKSPACE_PATH, 'layout')

  redirect(WORKSPACE_PATH)
}
