'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import type { Provision } from '../deal-desk/domain'
import { PROVISION_TYPE_LABELS } from '../deal-desk/format'
import {
  isUuid,
  parseCitationForm,
  parseProvisionForm,
  parseProvisionValueForm,
  PROVISION_FORM_FIELDS,
  readFormValues,
} from '../deal-desk/forms'
import {
  addProvisionExcerpts,
  createProvision,
  DealDeskDatabaseError,
  deleteProvision,
  getDeal,
  getProvision,
  listDealExcerptsByItem,
  removeProvisionExcerpt,
  updateProvision,
} from '../db'
import { failure, type DealDeskActionState } from './deal-desk-action-state'
import { requireUser } from './require-auth'

/**
 * Server Actions for provisions and their citations (Contract / Document
 * Intelligence V1).
 *
 * Same contract as the other Deal Desk actions: authorise first, validate on
 * the server, read the deal or provision as the caller before writing, and
 * show only safe messages. A provision is always human-entered: `source`,
 * `source_finding_id` and `confirmed_at` are never read from a form, and
 * `confirmed_at` is never sent at all. Citations must be excerpts of the
 * provision's own deal; the composite foreign keys enforce the same.
 */

const WORKSPACE_PATH = '/workspace'
const SIGNED_OUT_MESSAGE = 'You need to be signed in.'
const INVALID_MESSAGE = 'Check the highlighted fields and try again.'
const DEAL_NOT_FOUND_MESSAGE = 'This deal no longer exists, or it is not one of yours.'
const PROVISION_NOT_FOUND_MESSAGE =
  'This provision no longer exists, or it is not one of yours.'
const FOREIGN_EXCERPT_MESSAGE = "Choose excerpts of this deal's evidence."
const INPUT_REJECTED_MESSAGE =
  'The provision could not be saved with these details. Check them and try again.'
const CREATE_FAILED_MESSAGE = 'Could not add the provision. Please try again.'
const UPDATE_FAILED_MESSAGE = 'Could not save the provision. Please try again.'
const DELETE_FAILED_MESSAGE = 'Could not delete the provision. Please try again.'
/** Set on the provision page's URL when its citations failed on creation. */
const CITATIONS_FAILED_PARAM = 'citations'
const ALREADY_CITED_MESSAGE = 'One of these excerpts is already cited. Refresh the page and try again.'
const CITE_FAILED_MESSAGE = 'Could not add the citations. Please try again.'
const REMOVE_FAILED_MESSAGE = 'Could not remove the citation. Please try again.'

/**
 * What the server log records about a failure: metadata only, as in the
 * evidence actions. A Postgres error's message and details can quote the
 * rejected row, so neither the error nor its message is logged.
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

/** SQLSTATE unique_violation: C4 on provisions, the primary key on citations. */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof DealDeskDatabaseError &&
    error.kind === 'invalid_input' &&
    error.cause.code === '23505'
  )
}

/** The submitted value fields and excerpt choices, for re-filling a form. */
function submittedValues(formData: FormData): Record<string, string> {
  const values = readFormValues(formData, PROVISION_FORM_FIELDS)
  const excerptIds = formData.getAll('excerptIds').filter((id) => typeof id === 'string')
  return { ...values, excerptIds: excerptIds.join(',') }
}

/** Whether every id is an excerpt of `dealId`, read as the caller. */
async function areExcerptsOfDeal(dealId: string, excerptIds: string[]): Promise<boolean> {
  if (excerptIds.length === 0) return true
  const dealExcerptIds = new Set(
    (await listDealExcerptsByItem(dealId)).flatMap((item) => item.excerpts.map((e) => e.id)),
  )
  return excerptIds.every((id) => dealExcerptIds.has(id))
}

function provisionPath(provision: Pick<Provision, 'id' | 'deal_id'>): string {
  return `${WORKSPACE_PATH}/deals/${provision.deal_id}/provisions/${provision.id}`
}

/**
 * Records a provision on one of the caller's deals, cites the chosen
 * excerpts in one batched insert, then opens it.
 *
 * The provision and its citations are two inserts. If the citations fail
 * after the provision was stored, the provision stays, shown as unsupported,
 * and its page opens with a notice that the citations were not added, rather
 * than claiming success.
 */
export async function createProvisionAction(
  _state: DealDeskActionState,
  formData: FormData,
): Promise<DealDeskActionState> {
  if (await requireUser()) {
    return failure(SIGNED_OUT_MESSAGE)
  }

  const dealId = formData.get('dealId')
  const values = submittedValues(formData)

  if (!isUuid(dealId)) {
    return failure(DEAL_NOT_FOUND_MESSAGE, {}, values)
  }

  const parsed = parseProvisionForm(formData)

  if (!parsed.ok) {
    return failure(INVALID_MESSAGE, parsed.fieldErrors, values)
  }

  const { excerpt_ids: excerptIds, ...terms } = parsed.value
  let provision: Provision

  try {
    const deal = await getDeal(dealId)

    if (!deal) {
      return failure(DEAL_NOT_FOUND_MESSAGE, {}, values)
    }

    if (!(await areExcerptsOfDeal(deal.id, excerptIds))) {
      return failure(INVALID_MESSAGE, { excerptIds: FOREIGN_EXCERPT_MESSAGE }, values)
    }

    provision = await createProvision({
      deal_id: deal.id,
      provision_type: terms.provision_type,
      value_text: terms.value_text,
      value_numeric: terms.value_numeric,
      value_unit: terms.value_unit,
      source: 'human_entered',
    })
  } catch (error) {
    console.error('[provisions] create failed', safeErrorMetadata(error))

    // One provision per type per deal (C4), e.g. two quick submissions.
    if (isUniqueViolation(error)) {
      const message = `This deal already has a ${PROVISION_TYPE_LABELS[terms.provision_type]} provision.`
      return failure(message, { provisionType: message }, values)
    }
    if (error instanceof DealDeskDatabaseError && error.kind === 'invalid_input') {
      return failure(INPUT_REJECTED_MESSAGE, {}, values)
    }
    if (error instanceof DealDeskDatabaseError && error.kind === 'not_permitted') {
      return failure(DEAL_NOT_FOUND_MESSAGE, {}, values)
    }

    return failure(CREATE_FAILED_MESSAGE, {}, values)
  }

  let citationsFailed = false

  try {
    await addProvisionExcerpts(
      excerptIds.map((excerptId) => ({
        provision_id: provision.id,
        excerpt_id: excerptId,
        deal_id: provision.deal_id,
      })),
    )
  } catch (error) {
    console.error('[provisions] citation insert failed', {
      provisionId: provision.id,
      ...safeErrorMetadata(error),
    })

    // The provision exists, so open it rather than the form (a retry would
    // hit the one-per-type rule). Its page says the citations failed.
    citationsFailed = true
  }

  revalidatePath(`${WORKSPACE_PATH}/deals/${provision.deal_id}`)

  // Outside the try blocks: redirect() works by throwing.
  redirect(
    citationsFailed
      ? `${provisionPath(provision)}?${CITATIONS_FAILED_PARAM}=failed`
      : provisionPath(provision),
  )
}

/**
 * Saves a provision's value: the text, and the number with its unit. The
 * type, deal, provenance and `confirmed_at` are never part of the update.
 */
export async function updateProvisionAction(
  _state: DealDeskActionState,
  formData: FormData,
): Promise<DealDeskActionState> {
  if (await requireUser()) {
    return failure(SIGNED_OUT_MESSAGE)
  }

  const provisionId = formData.get('provisionId')
  const values = submittedValues(formData)

  if (!isUuid(provisionId)) {
    return failure(PROVISION_NOT_FOUND_MESSAGE, {}, values)
  }

  let updated: Provision | null

  try {
    const current = await getProvision(provisionId)

    if (!current) {
      return failure(PROVISION_NOT_FOUND_MESSAGE, {}, values)
    }

    const parsed = parseProvisionValueForm(formData, current.provision_type)

    if (!parsed.ok) {
      return failure(INVALID_MESSAGE, parsed.fieldErrors, values)
    }

    updated = await updateProvision(provisionId, {
      value_text: parsed.value.value_text,
      value_numeric: parsed.value.value_numeric,
      value_unit: parsed.value.value_unit,
    })
  } catch (error) {
    console.error('[provisions] update failed', safeErrorMetadata(error))

    if (error instanceof DealDeskDatabaseError && error.kind === 'invalid_input') {
      return failure(INPUT_REJECTED_MESSAGE, {}, values)
    }

    return failure(UPDATE_FAILED_MESSAGE, {}, values)
  }

  if (!updated) {
    return failure(PROVISION_NOT_FOUND_MESSAGE, {}, values)
  }

  revalidatePath(`${WORKSPACE_PATH}/deals/${updated.deal_id}`, 'layout')

  redirect(provisionPath(updated))
}

/**
 * Deletes a provision and its citations, never the evidence they cite, then
 * returns to its deal. Reached only from the confirmation page.
 */
export async function deleteProvisionAction(
  _state: DealDeskActionState,
  formData: FormData,
): Promise<DealDeskActionState> {
  if (await requireUser()) {
    return failure(SIGNED_OUT_MESSAGE)
  }

  const provisionId = formData.get('provisionId')

  if (!isUuid(provisionId)) {
    return failure(PROVISION_NOT_FOUND_MESSAGE)
  }

  let deleted: Provision | null

  try {
    deleted = await deleteProvision(provisionId)
  } catch (error) {
    console.error('[provisions] delete failed', safeErrorMetadata(error))

    return failure(DELETE_FAILED_MESSAGE)
  }

  if (!deleted) {
    return failure(PROVISION_NOT_FOUND_MESSAGE)
  }

  const dealPath = `${WORKSPACE_PATH}/deals/${deleted.deal_id}`
  revalidatePath(dealPath, 'layout')

  redirect(dealPath)
}

/**
 * Cites more excerpts of the provision's deal, at most 20 in one request, in
 * one batched insert: all of them or none.
 */
export async function addCitationsAction(
  _state: DealDeskActionState,
  formData: FormData,
): Promise<DealDeskActionState> {
  if (await requireUser()) {
    return failure(SIGNED_OUT_MESSAGE)
  }

  const provisionId = formData.get('provisionId')

  if (!isUuid(provisionId)) {
    return failure(PROVISION_NOT_FOUND_MESSAGE)
  }

  const parsed = parseCitationForm(formData)

  if (!parsed.ok) {
    return failure(INVALID_MESSAGE, parsed.fieldErrors)
  }

  let provision: Provision

  try {
    const found = await getProvision(provisionId)

    if (!found) {
      return failure(PROVISION_NOT_FOUND_MESSAGE)
    }

    if (!(await areExcerptsOfDeal(found.deal_id, parsed.value))) {
      return failure(INVALID_MESSAGE, { excerptIds: FOREIGN_EXCERPT_MESSAGE })
    }

    await addProvisionExcerpts(
      parsed.value.map((excerptId) => ({
        provision_id: found.id,
        excerpt_id: excerptId,
        deal_id: found.deal_id,
      })),
    )
    provision = found
  } catch (error) {
    console.error('[provisions] add citations failed', safeErrorMetadata(error))

    return failure(isUniqueViolation(error) ? ALREADY_CITED_MESSAGE : CITE_FAILED_MESSAGE)
  }

  revalidatePath(`${WORKSPACE_PATH}/deals/${provision.deal_id}`, 'layout')

  redirect(provisionPath(provision))
}

/** Removes one citation from a provision; the provision and the excerpt stay. */
export async function removeCitationAction(
  _state: DealDeskActionState,
  formData: FormData,
): Promise<DealDeskActionState> {
  if (await requireUser()) {
    return failure(SIGNED_OUT_MESSAGE)
  }

  const provisionId = formData.get('provisionId')
  const excerptId = formData.get('excerptId')

  if (!isUuid(provisionId) || !isUuid(excerptId)) {
    return failure(PROVISION_NOT_FOUND_MESSAGE)
  }

  let provision: Provision

  try {
    const found = await getProvision(provisionId)

    if (!found) {
      return failure(PROVISION_NOT_FOUND_MESSAGE)
    }

    // Already gone is the outcome the user asked for, so it is not an error.
    await removeProvisionExcerpt(found.id, excerptId)
    provision = found
  } catch (error) {
    console.error('[provisions] remove citation failed', safeErrorMetadata(error))

    return failure(REMOVE_FAILED_MESSAGE)
  }

  revalidatePath(`${WORKSPACE_PATH}/deals/${provision.deal_id}`, 'layout')

  redirect(provisionPath(provision))
}
