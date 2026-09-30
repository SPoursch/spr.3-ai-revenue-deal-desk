'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { isDecisionType, type DealException } from '../deal-desk/domain'
import { isUuid, readFormValues } from '../deal-desk/forms'
import { evaluateDeal, exceptionsToRaise, type RuleEvaluation } from '../deal-desk/rules'
import {
  createException,
  DealDeskDatabaseError,
  DecisionValidationError,
  getDeal,
  getException,
  listExceptions,
  listProvisions,
  recordDecision,
} from '../db'
import { failure, type DealDeskActionState } from './deal-desk-action-state'
import { requireUser } from './require-auth'

/**
 * Server Actions for exceptions and human Decisions (Rules → Exceptions →
 * Decisions V1).
 *
 * "Check deal" runs the fixed rules (app/lib/deal-desk/rules.ts) over one deal
 * and stores an exception for each that holds. Every exception field comes
 * from the rule registry; only the deal id is read from the form, and the
 * deal is read as the caller. Recording a Decision is the human write path:
 * the database trigger then closes the exception as decided or dismissed.
 * Nothing here involves the AI, and `considered_finding_id` is always null.
 */

const WORKSPACE_PATH = '/workspace'
const SIGNED_OUT_MESSAGE = 'You need to be signed in.'
const INVALID_MESSAGE = 'Check the highlighted fields and try again.'
const DEAL_NOT_FOUND_MESSAGE = 'This deal no longer exists, or it is not one of yours.'
const EXCEPTION_NOT_FOUND_MESSAGE =
  'This exception no longer exists, or it is not one of yours.'
const CLOSED_MESSAGE = 'This exception is already closed.'
const CHECK_FAILED_MESSAGE = 'Could not check the deal. Please try again.'
const DECISION_REJECTED_MESSAGE =
  'The decision could not be recorded with these details. Check them and try again.'
const DECISION_FAILED_MESSAGE = 'Could not record the decision. Please try again.'

/** The Decision form's fields, for re-filling it after a failed submission. */
const DECISION_FORM_FIELDS = ['decisionType', 'rationale', 'conditions'] as const

/** Where each Decision input problem is shown on the form. */
const DECISION_FIELD_NAMES: Record<string, string> = {
  decision_type: 'decisionType',
  rationale: 'rationale',
  conditions: 'conditions',
}

/**
 * What the server log records about a failure: metadata only, as in the
 * other Deal Desk actions. A Postgres error's message and details can quote
 * the rejected row, so neither the error nor its message is logged.
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

/** SQLSTATE unique_violation: here, the one-live-exception-per-rule index. */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof DealDeskDatabaseError &&
    error.kind === 'invalid_input' &&
    error.cause.code === '23505'
  )
}

function isLive(exception: Pick<DealException, 'status'>): boolean {
  return exception.status === 'open' || exception.status === 'under_review'
}

/** A successful result carrying a summary to show, not an error. */
function success(message: string): DealDeskActionState {
  return { ok: true, message, fieldErrors: {}, values: {}, at: Date.now() }
}

/**
 * Runs every rule over one of the caller's deals and raises an exception for
 * each rule that holds and has none yet (re-check rule B). A second run, or
 * two at once, never duplicates a live exception: the partial unique index
 * refuses the second insert, which counts as already raised. The run is not
 * atomic across rules and says honestly how many could not be stored; it is
 * safe to run again.
 */
export async function checkDealAction(
  _state: DealDeskActionState,
  formData: FormData,
): Promise<DealDeskActionState> {
  if (await requireUser()) {
    return failure(SIGNED_OUT_MESSAGE)
  }

  const dealId = formData.get('dealId')

  if (!isUuid(dealId)) {
    return failure(DEAL_NOT_FOUND_MESSAGE)
  }

  let dealIdChecked: string
  let holding: RuleEvaluation[]
  let toRaise: RuleEvaluation[]

  try {
    const deal = await getDeal(dealId)

    if (!deal) {
      return failure(DEAL_NOT_FOUND_MESSAGE)
    }

    const [provisions, existing, predecessor] = await Promise.all([
      listProvisions(deal.id),
      listExceptions(deal.id),
      deal.predecessor_deal_id ? getDeal(deal.predecessor_deal_id) : null,
    ])
    const evaluations = evaluateDeal({ deal, provisions, predecessor })

    dealIdChecked = deal.id
    holding = evaluations.filter((evaluation) => evaluation.outcome === 'holds')
    toRaise = exceptionsToRaise(evaluations, existing)
  } catch (error) {
    console.error('[exceptions] check read failed', safeErrorMetadata(error))

    return failure(CHECK_FAILED_MESSAGE)
  }

  let raised = 0
  let failed = 0

  for (const evaluation of toRaise) {
    try {
      await createException({
        deal_id: dealIdChecked,
        rule_key: evaluation.rule_key,
        rule_version: evaluation.rule_version,
        kind: evaluation.kind,
        severity: evaluation.severity,
        title: evaluation.title ?? evaluation.rule_key,
        why: evaluation.why ?? '',
        origin: 'deterministic',
        provision_id: evaluation.provision_id,
      })
      raised += 1
    } catch (error) {
      // Another run raised it first: it is already raised, not an error.
      if (isUniqueViolation(error)) continue

      console.error('[exceptions] raise failed', {
        ruleKey: evaluation.rule_key,
        ...safeErrorMetadata(error),
      })
      failed += 1
    }
  }

  revalidatePath(`${WORKSPACE_PATH}/deals/${dealIdChecked}`)

  const alreadyRaised = holding.length - raised - failed
  const summary = `Deal checked: ${raised} raised, ${alreadyRaised} already raised.`

  if (failed > 0) {
    return failure(`${summary} ${failed} could not be stored; check the deal again.`)
  }

  return success(summary)
}

/**
 * Records a human Decision on one of the caller's open exceptions, then
 * reopens its page. The exception is read as the caller, and the Decision
 * takes its deal and id from that row; the database trigger closes it in the
 * same transaction. No AI finding is ever attached.
 */
export async function recordDecisionAction(
  _state: DealDeskActionState,
  formData: FormData,
): Promise<DealDeskActionState> {
  if (await requireUser()) {
    return failure(SIGNED_OUT_MESSAGE)
  }

  const exceptionId = formData.get('exceptionId')
  const values = readFormValues(formData, DECISION_FORM_FIELDS)

  if (!isUuid(exceptionId)) {
    return failure(EXCEPTION_NOT_FOUND_MESSAGE, {}, values)
  }

  const decisionType = formData.get('decisionType')

  if (!isDecisionType(decisionType)) {
    return failure(INVALID_MESSAGE, { decisionType: 'Choose a decision.' }, values)
  }

  let exception: DealException

  try {
    const found = await getException(exceptionId)

    if (!found) {
      return failure(EXCEPTION_NOT_FOUND_MESSAGE, {}, values)
    }
    if (!isLive(found)) {
      return failure(CLOSED_MESSAGE, {}, values)
    }

    const rationale = formData.get('rationale')
    const conditions = formData.get('conditions')

    await recordDecision({
      deal_id: found.deal_id,
      exception_id: found.id,
      decision_type: decisionType,
      rationale: typeof rationale === 'string' ? rationale : '',
      conditions: typeof conditions === 'string' ? conditions : null,
      considered_finding_id: null,
    })
    exception = found
  } catch (error) {
    if (error instanceof DecisionValidationError) {
      const fieldErrors: Record<string, string> = {}
      for (const problem of error.problems) {
        fieldErrors[DECISION_FIELD_NAMES[problem.field] ?? problem.field] = problem.message
      }
      return failure(INVALID_MESSAGE, fieldErrors, values)
    }

    console.error('[exceptions] record decision failed', safeErrorMetadata(error))

    if (error instanceof DealDeskDatabaseError && error.kind === 'invalid_input') {
      return failure(DECISION_REJECTED_MESSAGE, {}, values)
    }
    if (error instanceof DealDeskDatabaseError && error.kind === 'not_permitted') {
      return failure(EXCEPTION_NOT_FOUND_MESSAGE, {}, values)
    }

    return failure(DECISION_FAILED_MESSAGE, {}, values)
  }

  const exceptionPath = `${WORKSPACE_PATH}/deals/${exception.deal_id}/exceptions/${exception.id}`
  revalidatePath(`${WORKSPACE_PATH}/deals/${exception.deal_id}`, 'layout')

  // Outside the try block: redirect() works by throwing.
  redirect(exceptionPath)
}
