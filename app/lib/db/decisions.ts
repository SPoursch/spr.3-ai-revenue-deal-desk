import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Tables } from '../database.types'
import {
  isDecisionType,
  validateDecisionInput,
  type DealId,
  type Decision,
  type DecisionId,
  type ExceptionId,
  type RecordExceptionDecisionInput,
} from '../deal-desk/domain'
import { getSupabaseClient } from '../supabase'
import { DealDeskDatabaseError, DecisionValidationError } from './errors'

/**
 * Deal Desk data access for `decisions`: a human's recorded judgement on an
 * exception (U9).
 *
 * This is the only write path for Decisions, and it is for human-submitted
 * input only. The AI never creates a Decision (CLAUDE.md): no AI code may
 * call `recordDecision`, which tests/unit/decision-write-path.test.ts
 * enforces. An AI finding can only be referenced as the explanation that was
 * in view (`considered_finding_id`).
 *
 * What the canonical schema allows: create and read. A Decision is immutable
 * and there is no DELETE — it disappears only with its deal. A change of mind
 * is a new Decision; the newest one on an exception is the one in force.
 *
 * The exception status. Inserting a Decision fires the database trigger
 * `decisions_apply_to_exception`, which sets the exception to 'dismissed'
 * (dismiss_false_positive) or 'decided' (every other type) in the same
 * transaction, and rolls the Decision back if that update fails (E5, E6, P2).
 * So a successful insert is itself the proof that the status changed: this
 * module neither repeats the transition nor reads the exception back, and
 * once the insert has returned nothing can turn it into a reported failure
 * that a caller might retry into a duplicate Decision.
 *
 * Ownership. There is no `user_id`: a Decision belongs to whoever owns its
 * deal, which row level security checks through `deal_id`, so the decider is
 * always the verified session user. Another user's Decision is invisible
 * (null or an empty list) and cannot be recorded (`not_permitted`).
 *
 * Validation. The input is checked with `validateDecisionInput` before
 * anything is sent; a failure is a `DecisionValidationError` carrying the
 * field-level problems. Referential integrity is the database's, surfaced as
 * `invalid_input`: the exception and the considered finding must be of the
 * Decision's deal (composite foreign keys).
 */

const DECISIONS_TABLE = 'decisions'

/** Every `decisions` column. One string literal, so supabase-js infers the row shape. */
const DECISION_COLUMNS =
  'id, deal_id, exception_id, decision_type, rationale, conditions, considered_finding_id, created_at'

/** The request-scoped client, typed against the canonical schema. */
function client(): SupabaseClient<Database> {
  return getSupabaseClient()
}

/**
 * Narrows a row's `decision_type` from the generated `string` to the domain
 * union. A failure means the database vocabulary changed without domain.ts
 * following it, and is surfaced rather than passed on as a mistyped Decision.
 */
function toDecision(row: Tables<'decisions'>): Decision {
  const { decision_type } = row

  if (!isDecisionType(decision_type)) {
    throw new Error(
      `Decision ${row.id} has a decision type unknown to the domain ` +
        `vocabulary (${decision_type}); update app/lib/deal-desk/domain.ts.`,
    )
  }

  return { ...row, decision_type }
}

/**
 * Records a human Decision on one of the caller's exceptions and returns the
 * stored row. When this resolves, the exception's status has already been set
 * by the database in the same transaction.
 *
 * Invalid input is refused before anything is sent, with a
 * `DecisionValidationError`: the check is at runtime as well as in the type,
 * because a Decision arrives from a form. Only the validated fields are
 * inserted, so no id, timestamp or owner can be smuggled in. A database
 * refusal is a `DealDeskDatabaseError`, and in either case nothing was
 * recorded.
 */
export async function recordDecision(
  input: RecordExceptionDecisionInput,
): Promise<Decision> {
  const validation = validateDecisionInput(input)

  if (!validation.ok) {
    throw new DecisionValidationError(validation.problems)
  }

  const { value } = validation

  const { data, error } = await client()
    .from(DECISIONS_TABLE)
    .insert({
      deal_id: value.deal_id,
      exception_id: value.exception_id,
      decision_type: value.decision_type,
      rationale: value.rationale,
      conditions: value.conditions ?? null,
      considered_finding_id: value.considered_finding_id ?? null,
    })
    .select(DECISION_COLUMNS)
    .single()

  if (error) {
    throw new DealDeskDatabaseError('insert', DECISIONS_TABLE, error)
  }

  return toDecision(data)
}

/**
 * Lists the Decisions of one deal, newest first. A deal that does not exist
 * or is not the caller's yields an empty list.
 */
export async function listDecisions(dealId: DealId): Promise<Decision[]> {
  const { data, error } = await client()
    .from(DECISIONS_TABLE)
    .select(DECISION_COLUMNS)
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })

  if (error) {
    throw new DealDeskDatabaseError('select', DECISIONS_TABLE, error)
  }

  return data.map(toDecision)
}

/**
 * Lists the Decisions on one exception, newest first: the first is the one in
 * force, the rest are its history. An exception that does not exist or is not
 * the caller's yields an empty list.
 */
export async function listExceptionDecisions(
  exceptionId: ExceptionId,
): Promise<Decision[]> {
  const { data, error } = await client()
    .from(DECISIONS_TABLE)
    .select(DECISION_COLUMNS)
    .eq('exception_id', exceptionId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })

  if (error) {
    throw new DealDeskDatabaseError('select', DECISIONS_TABLE, error)
  }

  return data.map(toDecision)
}

/** Reads one Decision, or null when it does not exist or is not the caller's. */
export async function getDecision(id: DecisionId): Promise<Decision | null> {
  const { data, error } = await client()
    .from(DECISIONS_TABLE)
    .select(DECISION_COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new DealDeskDatabaseError('select single', DECISIONS_TABLE, error)
  }

  return data ? toDecision(data) : null
}
