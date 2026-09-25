import type { Tables } from '../database.types'
import {
  isExceptionKind,
  isExceptionOrigin,
  isExceptionReviewStatus,
  isExceptionSeverity,
  isExceptionStatus,
  type CreateExceptionInput,
  type DealException,
  type DealId,
  type ExceptionId,
  type ExceptionReviewStatus,
} from '../deal-desk/domain'
import { getSupabaseClient } from '../supabase'
import { DealDeskDatabaseError } from './errors'

/**
 * Deal Desk data access for `exceptions`: human-facing deviations of a deal
 * from a rule (U8).
 *
 * What the canonical schema allows: create, read, and update of `status`.
 * Everything else — rule, kind, severity, text, origin, source finding,
 * provision, deal — is fixed at insert (E4), and there is no DELETE: an
 * exception disappears only with its deal. `status_changed_at` is set by the
 * database whenever the status changes (E9), `updated_at` on every update.
 *
 * The status lifecycle. An exception starts 'open'. A reviewer may move it
 * between 'open' and 'under_review' with `updateExceptionStatus`. 'decided'
 * and 'dismissed' are the outcome of recording a human Decision, which sets
 * them in the same transaction (E5, E6). The schema would accept them from a
 * plain update too, but that would record an outcome with no Decision behind
 * it, so this module refuses to send them. It enforces nothing else: there is
 * no workflow engine, and any review status may follow any other.
 *
 * Ownership. There is no `user_id`: an exception belongs to whoever owns its
 * deal, which row level security checks through `deal_id`. Another user's
 * exception is invisible (null, an empty list, or no row matched) and cannot
 * be created (`not_permitted`).
 *
 * Integrity is the database's, surfaced as `invalid_input`: the vocabularies
 * and the rule-key format; an AI-origin exception must name its source
 * finding; a source finding or provision must be of the same deal (composite
 * foreign keys); and at most one exception per rule may be live on a deal.
 * This module repeats none of it.
 *
 * References. The source finding is protected (E10, `on delete no action`),
 * and findings cannot be deleted on their own anyway. A referenced provision
 * may be deleted; the exception stays and its `provision_id` becomes null.
 */

const EXCEPTIONS_TABLE = 'exceptions'

/** Every `exceptions` column. One string literal, so supabase-js infers the row shape. */
const EXCEPTION_COLUMNS =
  'id, deal_id, rule_key, rule_version, kind, severity, title, why, origin, source_finding_id, provision_id, status, status_changed_at, created_at, updated_at'

/**
 * Narrows a row's vocabulary columns from the generated `string` to the
 * domain unions. As with `toDeal()`, a failure means the database vocabulary
 * changed without domain.ts following it, and is surfaced rather than passed
 * on as a mistyped exception.
 */
function toDealException(row: Tables<'exceptions'>): DealException {
  const { kind, severity, origin, status } = row

  if (
    !isExceptionKind(kind) ||
    !isExceptionSeverity(severity) ||
    !isExceptionOrigin(origin) ||
    !isExceptionStatus(status)
  ) {
    throw new Error(
      `Exception ${row.id} has a kind, severity, origin or status unknown to ` +
        `the domain vocabulary (${kind}, ${severity}, ${origin}, ${status}); ` +
        `update app/lib/deal-desk/domain.ts.`,
    )
  }

  return { ...row, kind, severity, origin, status }
}

/**
 * Lists the exceptions of one deal, newest first. A deal that does not exist
 * or is not the caller's yields an empty list.
 */
export async function listExceptions(dealId: DealId): Promise<DealException[]> {
  const { data, error } = await getSupabaseClient()
    .from(EXCEPTIONS_TABLE)
    .select(EXCEPTION_COLUMNS)
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })

  if (error) {
    throw new DealDeskDatabaseError('select', EXCEPTIONS_TABLE, error)
  }

  return data.map(toDealException)
}

/** Reads one exception, or null when it does not exist or is not the caller's. */
export async function getException(id: ExceptionId): Promise<DealException | null> {
  const { data, error } = await getSupabaseClient()
    .from(EXCEPTIONS_TABLE)
    .select(EXCEPTION_COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new DealDeskDatabaseError('select single', EXCEPTIONS_TABLE, error)
  }

  return data ? toDealException(data) : null
}

/**
 * Raises an exception on one of the caller's deals and returns the stored
 * row. `status` is not sent, so every exception starts 'open' (C7). `id`,
 * `status_changed_at` and both timestamps are left to the database.
 */
export async function createException(
  input: CreateExceptionInput,
): Promise<DealException> {
  const { data, error } = await getSupabaseClient()
    .from(EXCEPTIONS_TABLE)
    .insert({
      deal_id: input.deal_id,
      rule_key: input.rule_key,
      rule_version: input.rule_version,
      kind: input.kind,
      severity: input.severity,
      title: input.title,
      why: input.why,
      origin: input.origin,
      source_finding_id: input.source_finding_id ?? null,
      provision_id: input.provision_id ?? null,
    })
    .select(EXCEPTION_COLUMNS)
    .single()

  if (error) {
    throw new DealDeskDatabaseError('insert', EXCEPTIONS_TABLE, error)
  }

  return toDealException(data)
}

/**
 * Moves an exception between 'open' and 'under_review' and returns the stored
 * row, or null when no row matched.
 *
 * 'decided' and 'dismissed' are refused before anything is sent: they are set
 * only by recording a Decision (E5, E6). The check is at runtime as well as in
 * the type, because a status often arrives from an untyped form field.
 */
export async function updateExceptionStatus(
  id: ExceptionId,
  status: ExceptionReviewStatus,
): Promise<DealException | null> {
  if (!isExceptionReviewStatus(status)) {
    throw new Error(
      `Exception status "${String(status)}" can only be set by recording a ` +
        `Decision; a review may set only 'open' or 'under_review'.`,
    )
  }

  const { data, error } = await getSupabaseClient()
    .from(EXCEPTIONS_TABLE)
    .update({ status })
    .eq('id', id)
    .select(EXCEPTION_COLUMNS)
    .maybeSingle()

  if (error) {
    throw new DealDeskDatabaseError('update', EXCEPTIONS_TABLE, error)
  }

  return data ? toDealException(data) : null
}
