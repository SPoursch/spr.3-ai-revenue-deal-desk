import type { Tables } from '../database.types'
import {
  isAiFindingStatus,
  isAiFindingType,
  type AiFinding,
  type AiFindingId,
  type AiFindingStatus,
  type CreateAiFindingInput,
  type DealId,
} from '../deal-desk/domain'
import { getSupabaseClient } from '../supabase'
import { DealDeskDatabaseError } from './errors'

/**
 * Deal Desk data access for `ai_findings`: model output kept for audit.
 *
 * A finding is a candidate, proposal or explanation — never a Decision, and
 * nothing in this module can create or change one. Decisions live in their
 * own table, behind their own human-submitted write path.
 *
 * What the canonical schema allows, and therefore all this module offers:
 * create, read, and update of `status`. The content — type, text, payload,
 * rule, model and prompt version — is immutable, and there is no DELETE: a
 * finding disappears only with its deal. A newer finding replaces an older one
 * by marking it 'superseded', not by editing it.
 *
 * Ownership. There is no `user_id`: a finding belongs to whoever owns its
 * deal, which row level security checks through `deal_id`. Another user's
 * finding is invisible (null, an empty list, or no row matched) and cannot be
 * created (`not_permitted`).
 *
 * Integrity is the database's, surfaced as `invalid_input`: the vocabularies,
 * a provision candidate's required payload, and `rule_key` with
 * `rule_version`. This module repeats none of it.
 */

const AI_FINDINGS_TABLE = 'ai_findings'

/** Every `ai_findings` column. One string literal, so supabase-js infers the row shape. */
const AI_FINDING_COLUMNS =
  'id, deal_id, finding_type, content, payload, rule_key, rule_version, model, prompt_version, status, created_at'

/**
 * Narrows a row's vocabulary columns from the generated `string` to the
 * domain unions. As with `toDeal()`, a failure means the database vocabulary
 * changed without domain.ts following it, and is surfaced rather than passed
 * on as a mistyped finding.
 */
function toAiFinding(row: Tables<'ai_findings'>): AiFinding {
  const { finding_type, status } = row

  if (!isAiFindingType(finding_type) || !isAiFindingStatus(status)) {
    throw new Error(
      `AI finding ${row.id} has a finding_type or status unknown to the ` +
        `domain vocabulary (${finding_type}, ${status}); update ` +
        `app/lib/deal-desk/domain.ts.`,
    )
  }

  return { ...row, finding_type, status }
}

/**
 * Lists the findings of one deal, newest first — the order the Copilot shows
 * them in. A deal that does not exist or is not the caller's yields an empty
 * list.
 */
export async function listAiFindings(dealId: DealId): Promise<AiFinding[]> {
  const { data, error } = await getSupabaseClient()
    .from(AI_FINDINGS_TABLE)
    .select(AI_FINDING_COLUMNS)
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })

  if (error) {
    throw new DealDeskDatabaseError('select', AI_FINDINGS_TABLE, error)
  }

  return data.map(toAiFinding)
}

/** Reads one finding, or null when it does not exist or is not the caller's. */
export async function getAiFinding(id: AiFindingId): Promise<AiFinding | null> {
  const { data, error } = await getSupabaseClient()
    .from(AI_FINDINGS_TABLE)
    .select(AI_FINDING_COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new DealDeskDatabaseError('select single', AI_FINDINGS_TABLE, error)
  }

  return data ? toAiFinding(data) : null
}

/**
 * Records a finding on one of the caller's deals and returns the stored row.
 *
 * `status` is not sent, so every finding starts 'proposed' — a finding cannot
 * be recorded already accepted. `id` and `created_at` are left to the
 * database.
 */
export async function createAiFinding(
  input: CreateAiFindingInput,
): Promise<AiFinding> {
  const { data, error } = await getSupabaseClient()
    .from(AI_FINDINGS_TABLE)
    .insert({
      deal_id: input.deal_id,
      finding_type: input.finding_type,
      content: input.content,
      payload: input.payload ?? null,
      rule_key: input.rule_key ?? null,
      rule_version: input.rule_version ?? null,
      model: input.model,
      prompt_version: input.prompt_version,
    })
    .select(AI_FINDING_COLUMNS)
    .single()

  if (error) {
    throw new DealDeskDatabaseError('insert', AI_FINDINGS_TABLE, error)
  }

  return toAiFinding(data)
}

/**
 * Sets a finding's review status — accepted or rejected by a human, or
 * superseded by a newer finding — and returns the stored row, or null when no
 * row matched. The schema constrains the value, not the transition.
 */
export async function updateAiFindingStatus(
  id: AiFindingId,
  status: AiFindingStatus,
): Promise<AiFinding | null> {
  const { data, error } = await getSupabaseClient()
    .from(AI_FINDINGS_TABLE)
    .update({ status })
    .eq('id', id)
    .select(AI_FINDING_COLUMNS)
    .maybeSingle()

  if (error) {
    throw new DealDeskDatabaseError('update', AI_FINDINGS_TABLE, error)
  }

  return data ? toAiFinding(data) : null
}
