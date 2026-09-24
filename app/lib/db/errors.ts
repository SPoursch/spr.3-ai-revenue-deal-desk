import type { PostgrestError } from '@supabase/supabase-js'

import type { Database } from '../database.types'
import type { DecisionInputProblem } from '../deal-desk/domain'

/**
 * Error thrown when Supabase reports a failure on a NoteSpace table. Wrapping
 * keeps the Postgrest details available while giving callers a single error
 * type to catch.
 */
export class NotesDatabaseError extends Error {
  readonly operation: string
  readonly table: string
  readonly cause?: PostgrestError

  constructor(operation: string, table: string, cause: PostgrestError) {
    super(`Supabase ${operation} on "${table}" failed: ${cause.message}`)
    this.name = 'NotesDatabaseError'
    this.operation = operation
    this.table = table
    this.cause = cause
  }
}

/**
 * The Deal Intelligence tables of the canonical database. `saved_assessments`
 * belongs to GTM Stack Fit, which the Deal Desk never reads or writes.
 */
export type DealDeskTable = Exclude<
  keyof Database['public']['Tables'],
  'saved_assessments'
>

/**
 * What kind of failure a Deal Desk query hit, so a caller can choose a message
 * without inspecting Postgres codes itself.
 *
 * - `invalid_input`: the database rejected the values — a check, not-null,
 *   unique or foreign-key constraint, or a value it could not parse. The
 *   caller may say "check your input". A foreign-key violation also covers a
 *   reference to another user's row: the composite `(…, user_id)` keys make
 *   that indistinguishable from a reference to a row that does not exist.
 * - `not_permitted`: a privilege or row level security refusal, such as
 *   writing a column that is not granted. For a request that went through
 *   app/lib/db this means a bug, not a user error.
 * - `unexpected`: anything else — connection, timeout, PostgREST errors.
 *
 * "Not found" is deliberately not a kind. As in the NoteSpace functions, a
 * row that does not exist or is not the caller's is an ordinary `null`
 * result, not an error: row level security makes the two indistinguishable,
 * which is what keeps other users' ids from being probed.
 */
export type DatabaseErrorKind = 'invalid_input' | 'not_permitted' | 'unexpected'

/** SQLSTATE codes meaning the submitted values were rejected. */
const INVALID_INPUT_CODES: ReadonlySet<string> = new Set([
  '23502', // not_null_violation
  '23503', // foreign_key_violation
  '23505', // unique_violation
  '23514', // check_violation
  '22P02', // invalid_text_representation
  '22003', // numeric_value_out_of_range
  '22007', // invalid_datetime_format
  '22008', // datetime_field_overflow
])

/** SQLSTATE codes meaning the role may not do this. */
const NOT_PERMITTED_CODES: ReadonlySet<string> = new Set([
  '42501', // insufficient_privilege, also raised by an RLS `with check` refusal
])

/** Classifies a PostgREST error by its SQLSTATE code. */
export function classifyPostgrestError(
  error: Pick<PostgrestError, 'code'>,
): DatabaseErrorKind {
  if (INVALID_INPUT_CODES.has(error.code)) return 'invalid_input'
  if (NOT_PERMITTED_CODES.has(error.code)) return 'not_permitted'

  return 'unexpected'
}

/**
 * Error thrown when Supabase reports a failure on a Deal Desk table.
 *
 * Separate from `NotesDatabaseError` so that NoteSpace callers, which catch
 * that type, are unaffected, and so the Deal Desk carries its own
 * classification. The message includes the Postgres detail and is meant for
 * server logs only; callers show the user a generic message chosen by `kind`.
 */
export class DealDeskDatabaseError extends Error {
  readonly operation: string
  readonly table: DealDeskTable
  readonly kind: DatabaseErrorKind
  readonly cause: PostgrestError

  constructor(operation: string, table: DealDeskTable, cause: PostgrestError) {
    super(
      `Supabase ${operation} on "${table}" failed (${cause.code}): ${cause.message}`,
    )
    this.name = 'DealDeskDatabaseError'
    this.operation = operation
    this.table = table
    this.kind = classifyPostgrestError(cause)
    this.cause = cause
  }
}

/**
 * Error thrown when a Decision fails validation, before anything is sent to
 * the database.
 *
 * It carries the field-level problems from `validateDecisionInput`, each with
 * a message safe to show the user, so a caller can render them next to the
 * form fields instead of parsing the error message. Separate from
 * `DealDeskDatabaseError` because nothing reached the database.
 */
export class DecisionValidationError extends Error {
  readonly problems: readonly DecisionInputProblem[]

  constructor(problems: readonly DecisionInputProblem[]) {
    super(
      `Decision not recorded: invalid ${problems
        .map((problem) => problem.field)
        .join(', ')}.`,
    )
    this.name = 'DecisionValidationError'
    this.problems = problems
  }
}
