'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import type { EvidenceItem } from '../deal-desk/domain'
import { splitIntoParagraphs } from '../deal-desk/excerpts'
import {
  EVIDENCE_FORM_FIELDS,
  isUuid,
  parseEvidenceForm,
  readFormValues,
} from '../deal-desk/forms'
import {
  createEvidenceExcerpts,
  createEvidenceItem,
  DealDeskDatabaseError,
  getDeal,
} from '../db'
import { failure, type DealDeskActionState } from './deal-desk-action-state'
import { requireUser } from './require-auth'

/**
 * Server Actions for evidence (Slice 4).
 *
 * Same contract as the Deal Records actions: authorise, validate on the
 * server, call the existing data layer, show only safe messages. The deal is
 * read as the caller, so row level security decides whether it is theirs; the
 * item's `deal_id` is that deal's id, never a form value.
 */

const WORKSPACE_PATH = '/workspace'
const SIGNED_OUT_MESSAGE = 'You need to be signed in.'
const INVALID_MESSAGE = 'Check the highlighted fields and try again.'
const DEAL_NOT_FOUND_MESSAGE = 'This deal no longer exists, or it is not one of yours.'
const INPUT_REJECTED_MESSAGE =
  'The evidence could not be saved with these details. Check them and try again.'
const CREATE_FAILED_MESSAGE = 'Could not add the evidence. Please try again.'
const EXCERPTS_FAILED_MESSAGE =
  'The evidence was saved, but its excerpts could not all be created. It is listed on ' +
  'the deal; do not add it again.'

/**
 * What the server log records about a failure: metadata only. A Postgres
 * error's message and details can quote the rejected row, which here is the
 * submitted evidence text, so neither the error nor its message is logged.
 */
function safeErrorMetadata(error: unknown) {
  if (error instanceof DealDeskDatabaseError) {
    return {
      operation: error.operation,
      table: error.table,
      kind: error.kind,
      code: error.cause.code,
    }
  }

  return { kind: 'unexpected', name: error instanceof Error ? error.name : typeof error }
}

/**
 * Adds pasted evidence to one of the caller's deals, splits it into paragraph
 * excerpts, then opens it.
 *
 * The item and its excerpts are separate inserts. Evidence is immutable and
 * cannot be deleted (E3), so if the excerpts fail after the item was stored
 * there is nothing to roll back: the action reports that plainly instead of
 * redirecting as if it had succeeded.
 */
export async function createEvidenceAction(
  _state: DealDeskActionState,
  formData: FormData,
): Promise<DealDeskActionState> {
  if (await requireUser()) {
    return failure(SIGNED_OUT_MESSAGE)
  }

  const dealId = formData.get('dealId')
  const values = readFormValues(formData, EVIDENCE_FORM_FIELDS)

  if (!isUuid(dealId)) {
    return failure(DEAL_NOT_FOUND_MESSAGE, {}, values)
  }

  const parsed = parseEvidenceForm(formData)

  if (!parsed.ok) {
    return failure(INVALID_MESSAGE, parsed.fieldErrors, values)
  }

  let item: EvidenceItem

  try {
    const deal = await getDeal(dealId)

    if (!deal) {
      return failure(DEAL_NOT_FOUND_MESSAGE, {}, values)
    }

    item = await createEvidenceItem({ ...parsed.value, deal_id: deal.id })
  } catch (error) {
    if (error instanceof DealDeskDatabaseError && error.kind === 'invalid_input') {
      console.error('[evidence] item insert rejected', safeErrorMetadata(error))

      return failure(INPUT_REJECTED_MESSAGE, {}, values)
    }

    // RLS refuses an insert on a deal that is not the caller's, e.g. one
    // deleted since it was read.
    if (error instanceof DealDeskDatabaseError && error.kind === 'not_permitted') {
      console.error('[evidence] item insert refused', safeErrorMetadata(error))

      return failure(DEAL_NOT_FOUND_MESSAGE, {}, values)
    }

    console.error('[evidence] item insert failed', safeErrorMetadata(error))

    return failure(CREATE_FAILED_MESSAGE, {}, values)
  }

  const dealPath = `${WORKSPACE_PATH}/deals/${item.deal_id}`

  try {
    // Split the stored body, so every offset points into what was saved. One
    // insert for all excerpts: it stores every one or none.
    await createEvidenceExcerpts(
      splitIntoParagraphs(item.body_text).map((excerpt) => ({
        ...excerpt,
        evidence_item_id: item.id,
        deal_id: item.deal_id,
      })),
    )
  } catch (error) {
    console.error('[evidence] excerpt insert failed', {
      itemId: item.id,
      ...safeErrorMetadata(error),
    })

    // The item exists and is listed on the deal. The form is not re-filled,
    // so submitting again does not add it a second time.
    revalidatePath(dealPath)

    return failure(EXCERPTS_FAILED_MESSAGE)
  }

  revalidatePath(dealPath)

  // Outside the try blocks: redirect() works by throwing.
  redirect(`${dealPath}/evidence/${item.id}`)
}
