import type { Tables, TablesUpdate } from '../database.types'
import {
  isProvisionSource,
  isProvisionType,
  isProvisionValueUnit,
  type CreateProvisionExcerptInput,
  type CreateProvisionInput,
  type DealId,
  type EvidenceExcerptId,
  type Provision,
  type ProvisionExcerpt,
  type ProvisionId,
  type UpdateProvisionInput,
} from '../deal-desk/domain'
import { getSupabaseClient } from '../supabase'
import { DealDeskDatabaseError } from './errors'

/**
 * Deal Desk data access for provisions — confirmed contractual terms (U4) —
 * and their citations in `provision_excerpts`.
 *
 * What the canonical schema allows, and therefore all this module offers:
 * - provisions: create, read, delete, and update of the value
 *   (`value_text`, `value_numeric`, `value_unit`) and of `confirmed_at`.
 *   `deal_id`, `provision_type`, `source` and `source_finding_id` are fixed at
 *   insert (E4); `confirmed_at` is stamped by the database on insert.
 * - provision_excerpts: create, read and delete; a citation is replaced by
 *   removing it and adding another, never edited.
 *
 * Ownership. Neither table has `user_id`: a provision belongs to whoever owns
 * its deal, which row level security checks through `deal_id`. Another user's
 * provision is invisible (null, an empty list, or no row matched) and cannot
 * be created (`not_permitted`).
 *
 * Integrity is the database's, surfaced as `invalid_input`: one provision per
 * type per deal (C4); `value_numeric` and `value_unit` set or null together;
 * an 'ai_confirmed' provision must name a source finding, and every finding
 * or excerpt reference must be of the same deal (composite foreign keys). This
 * module repeats none of it; `CreateProvisionInput` already makes an
 * 'ai_confirmed' provision without a finding impossible in typed code.
 *
 * Deleting a provision deletes its citations, never the evidence they cite,
 * and clears — rather than blocks on — any exception that referenced it.
 */

const PROVISIONS_TABLE = 'provisions'
const PROVISION_EXCERPTS_TABLE = 'provision_excerpts'

/** Every `provisions` column. One string literal, so supabase-js infers the row shape. */
const PROVISION_COLUMNS =
  'id, deal_id, provision_type, value_text, value_numeric, value_unit, source, source_finding_id, confirmed_at, created_at, updated_at'

/** Every `provision_excerpts` column. */
const PROVISION_EXCERPT_COLUMNS = 'provision_id, excerpt_id, deal_id, created_at'

/**
 * Narrows a row's vocabulary columns from the generated `string` to the
 * domain unions. As with `toDeal()`, a failure means the database vocabulary
 * changed without domain.ts following it, and is surfaced rather than passed
 * on as a mistyped provision.
 */
function toProvision(row: Tables<'provisions'>): Provision {
  const { provision_type, value_unit, source } = row

  if (
    !isProvisionType(provision_type) ||
    !isProvisionSource(source) ||
    (value_unit !== null && !isProvisionValueUnit(value_unit))
  ) {
    throw new Error(
      `Provision ${row.id} has a provision_type, value_unit or source unknown ` +
        `to the domain vocabulary (${provision_type}, ${value_unit}, ${source}); ` +
        `update app/lib/deal-desk/domain.ts.`,
    )
  }

  return { ...row, provision_type, value_unit, source }
}

// ---------------------------------------------------------------------------
// Provisions
// ---------------------------------------------------------------------------

/**
 * Lists the provisions of one deal, by type. There is at most one per type,
 * so the order is stable. A deal that does not exist or is not the caller's
 * yields an empty list.
 */
export async function listProvisions(dealId: DealId): Promise<Provision[]> {
  const { data, error } = await getSupabaseClient()
    .from(PROVISIONS_TABLE)
    .select(PROVISION_COLUMNS)
    .eq('deal_id', dealId)
    .order('provision_type', { ascending: true })

  if (error) {
    throw new DealDeskDatabaseError('select', PROVISIONS_TABLE, error)
  }

  return data.map(toProvision)
}

/** Reads one provision, or null when it does not exist or is not the caller's. */
export async function getProvision(id: ProvisionId): Promise<Provision | null> {
  const { data, error } = await getSupabaseClient()
    .from(PROVISIONS_TABLE)
    .select(PROVISION_COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new DealDeskDatabaseError('select single', PROVISIONS_TABLE, error)
  }

  return data ? toProvision(data) : null
}

/**
 * Records a confirmed provision on one of the caller's deals and returns the
 * stored row. `id`, `confirmed_at` and both timestamps are left to the
 * database, so a provision cannot be created backdated.
 */
export async function createProvision(
  input: CreateProvisionInput,
): Promise<Provision> {
  const { data, error } = await getSupabaseClient()
    .from(PROVISIONS_TABLE)
    .insert({
      deal_id: input.deal_id,
      provision_type: input.provision_type,
      value_text: input.value_text,
      value_numeric: input.value_numeric ?? null,
      value_unit: input.value_unit ?? null,
      source: input.source,
      source_finding_id: input.source_finding_id ?? null,
    })
    .select(PROVISION_COLUMNS)
    .single()

  if (error) {
    throw new DealDeskDatabaseError('insert', PROVISIONS_TABLE, error)
  }

  return toProvision(data)
}

/**
 * Updates a provision's value or confirmation time and returns the stored
 * row, or null when no row matched.
 *
 * Keys omitted from `input` are not sent; an input with no keys at all is not
 * an edit, so the row is returned unchanged. `updated_at` is maintained by the
 * provisions_set_updated_at trigger. `confirmed_at` is stored as given: the
 * schema leaves the confirmation time to the application.
 */
export async function updateProvision(
  id: ProvisionId,
  input: UpdateProvisionInput,
): Promise<Provision | null> {
  const patch: TablesUpdate<'provisions'> = {}

  if ('value_text' in input) patch.value_text = input.value_text
  if ('value_numeric' in input) patch.value_numeric = input.value_numeric ?? null
  if ('value_unit' in input) patch.value_unit = input.value_unit ?? null
  if ('confirmed_at' in input) patch.confirmed_at = input.confirmed_at

  if (Object.keys(patch).length === 0) {
    return getProvision(id)
  }

  const { data, error } = await getSupabaseClient()
    .from(PROVISIONS_TABLE)
    .update(patch)
    .eq('id', id)
    .select(PROVISION_COLUMNS)
    .maybeSingle()

  if (error) {
    throw new DealDeskDatabaseError('update', PROVISIONS_TABLE, error)
  }

  return data ? toProvision(data) : null
}

/**
 * Deletes a provision and returns the removed row, or null when no row
 * matched. Its citations go with it; the cited evidence stays.
 */
export async function deleteProvision(
  id: ProvisionId,
): Promise<Provision | null> {
  const { data, error } = await getSupabaseClient()
    .from(PROVISIONS_TABLE)
    .delete()
    .eq('id', id)
    .select(PROVISION_COLUMNS)
    .maybeSingle()

  if (error) {
    throw new DealDeskDatabaseError('delete', PROVISIONS_TABLE, error)
  }

  return data ? toProvision(data) : null
}

// ---------------------------------------------------------------------------
// Citations (provision_excerpts)
// ---------------------------------------------------------------------------

/**
 * Lists the excerpts cited in support of one provision, oldest link first. A
 * provision with none is an unsupported claim; one that does not exist or is
 * not the caller's yields an empty list.
 */
export async function listProvisionExcerpts(
  provisionId: ProvisionId,
): Promise<ProvisionExcerpt[]> {
  const { data, error } = await getSupabaseClient()
    .from(PROVISION_EXCERPTS_TABLE)
    .select(PROVISION_EXCERPT_COLUMNS)
    .eq('provision_id', provisionId)
    .order('created_at', { ascending: true })
    .order('excerpt_id', { ascending: true })

  if (error) {
    throw new DealDeskDatabaseError('select', PROVISION_EXCERPTS_TABLE, error)
  }

  return data
}

/**
 * Cites an excerpt in support of a provision and returns the stored link.
 * Linking the same pair twice is rejected (`invalid_input`), as is an excerpt
 * of a different deal.
 */
export async function addProvisionExcerpt(
  input: CreateProvisionExcerptInput,
): Promise<ProvisionExcerpt> {
  const { data, error } = await getSupabaseClient()
    .from(PROVISION_EXCERPTS_TABLE)
    .insert({
      provision_id: input.provision_id,
      excerpt_id: input.excerpt_id,
      deal_id: input.deal_id,
    })
    .select(PROVISION_EXCERPT_COLUMNS)
    .single()

  if (error) {
    throw new DealDeskDatabaseError('insert', PROVISION_EXCERPTS_TABLE, error)
  }

  return data
}

/**
 * Removes one citation, leaving the provision and the excerpt intact.
 *
 * Returns whether a link was actually removed, so a caller can tell "no
 * longer cited" from "was never cited" — the same contract as NoteSpace's
 * `removeTagFromNote`.
 */
export async function removeProvisionExcerpt(
  provisionId: ProvisionId,
  excerptId: EvidenceExcerptId,
): Promise<boolean> {
  const { data, error } = await getSupabaseClient()
    .from(PROVISION_EXCERPTS_TABLE)
    .delete()
    .eq('provision_id', provisionId)
    .eq('excerpt_id', excerptId)
    .select('provision_id')

  if (error) {
    throw new DealDeskDatabaseError('delete', PROVISION_EXCERPTS_TABLE, error)
  }

  return data.length > 0
}
