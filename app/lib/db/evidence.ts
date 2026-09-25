import type { Tables } from '../database.types'
import {
  isEvidenceMimeType,
  isEvidenceSourceKind,
  isEvidenceType,
  type CreateEvidenceExcerptInput,
  type CreateEvidenceItemInput,
  type DealId,
  type EvidenceExcerpt,
  type EvidenceExcerptId,
  type EvidenceItem,
  type EvidenceItemId,
} from '../deal-desk/domain'
import { getSupabaseClient } from '../supabase'
import { DealDeskDatabaseError } from './errors'

/**
 * Deal Desk data access for evidence: `evidence_items` and their
 * `evidence_excerpts`.
 *
 * Immutable and not independently deletable (E3). The canonical schema grants
 * the application role INSERT and SELECT on both tables and nothing else, so
 * this module offers create, get and list only. Evidence disappears when its
 * deal is deleted — `deleteDeal()` or `deleteAccount()` — and in no other way.
 * A correction is a new item that names the old one in
 * `supersedes_evidence_id`, not an edit.
 *
 * Ownership. Neither table has `user_id`: an item or excerpt belongs to whoever
 * owns its deal, and row level security checks that through `deal_id` on every
 * read and insert. Evidence on another user's deal is invisible (reads return
 * null or an empty list) and cannot be created (`not_permitted`).
 *
 * Integrity is the database's. The composite `(…, deal_id)` foreign keys keep
 * an excerpt on its item's deal and a superseded item on the same deal; the
 * check constraints validate the vocabulary, title, body and offsets. Their
 * violations surface as `invalid_input`. This module repeats none of them.
 *
 * Only pasted evidence is created: `source_kind` is always 'pasted' and the
 * upload columns stay null until the upload feature brings Storage (E8).
 */

const EVIDENCE_ITEMS_TABLE = 'evidence_items'
const EVIDENCE_EXCERPTS_TABLE = 'evidence_excerpts'

/**
 * Every `evidence_items` column, including the upload columns so that reads
 * stay complete once uploads exist. One string literal, so supabase-js infers
 * the row shape from it.
 */
const EVIDENCE_ITEM_COLUMNS =
  'id, deal_id, evidence_type, title, source_kind, body_text, storage_path, original_filename, mime_type, author, version_label, document_date, is_executed, supersedes_evidence_id, created_at'

/**
 * Every `evidence_excerpts` column except the generated `content_tsv`, which
 * full-text retrieval will query in the database rather than read.
 */
const EVIDENCE_EXCERPT_COLUMNS =
  'id, evidence_item_id, deal_id, ordinal, start_offset, end_offset, section_label, content, created_at'

/**
 * Narrows an item's vocabulary columns from the generated `string` to the
 * domain unions. As with `toDeal()`, a failure means the database vocabulary
 * changed without domain.ts following it, and is surfaced rather than passed
 * on as a mistyped item.
 */
function toEvidenceItem(row: Tables<'evidence_items'>): EvidenceItem {
  const { evidence_type, source_kind, mime_type } = row

  if (
    !isEvidenceType(evidence_type) ||
    !isEvidenceSourceKind(source_kind) ||
    (mime_type !== null && !isEvidenceMimeType(mime_type))
  ) {
    throw new Error(
      `Evidence item ${row.id} has an evidence_type, source_kind or mime_type ` +
        `unknown to the domain vocabulary (${evidence_type}, ${source_kind}, ` +
        `${mime_type}); update app/lib/deal-desk/domain.ts.`,
    )
  }

  return { ...row, evidence_type, source_kind, mime_type }
}

// ---------------------------------------------------------------------------
// Evidence items
// ---------------------------------------------------------------------------

/**
 * Lists the evidence of one deal, oldest first — the order it was added in,
 * which is also the order of a supersession chain. A deal that does not exist
 * or is not the caller's yields an empty list.
 */
export async function listEvidenceItems(dealId: DealId): Promise<EvidenceItem[]> {
  const { data, error } = await getSupabaseClient()
    .from(EVIDENCE_ITEMS_TABLE)
    .select(EVIDENCE_ITEM_COLUMNS)
    .eq('deal_id', dealId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) {
    throw new DealDeskDatabaseError('select', EVIDENCE_ITEMS_TABLE, error)
  }

  return data.map(toEvidenceItem)
}

/** Reads one evidence item, or null when it does not exist or is not the caller's. */
export async function getEvidenceItem(
  id: EvidenceItemId,
): Promise<EvidenceItem | null> {
  const { data, error } = await getSupabaseClient()
    .from(EVIDENCE_ITEMS_TABLE)
    .select(EVIDENCE_ITEM_COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new DealDeskDatabaseError('select single', EVIDENCE_ITEMS_TABLE, error)
  }

  return data ? toEvidenceItem(data) : null
}

/**
 * Adds pasted evidence to one of the caller's deals and returns the stored
 * row. `id` and `created_at` are left to their database defaults, and
 * `is_executed` to its `false` default when omitted.
 */
export async function createEvidenceItem(
  input: CreateEvidenceItemInput,
): Promise<EvidenceItem> {
  const { data, error } = await getSupabaseClient()
    .from(EVIDENCE_ITEMS_TABLE)
    .insert({
      deal_id: input.deal_id,
      evidence_type: input.evidence_type,
      title: input.title,
      source_kind: 'pasted',
      body_text: input.body_text,
      author: input.author ?? null,
      version_label: input.version_label ?? null,
      document_date: input.document_date ?? null,
      is_executed: input.is_executed ?? false,
      supersedes_evidence_id: input.supersedes_evidence_id ?? null,
    })
    .select(EVIDENCE_ITEM_COLUMNS)
    .single()

  if (error) {
    throw new DealDeskDatabaseError('insert', EVIDENCE_ITEMS_TABLE, error)
  }

  return toEvidenceItem(data)
}

// ---------------------------------------------------------------------------
// Evidence excerpts
// ---------------------------------------------------------------------------

/**
 * Lists the excerpts of one evidence item in ordinal order. An item that does
 * not exist or is not the caller's yields an empty list.
 */
export async function listEvidenceExcerpts(
  evidenceItemId: EvidenceItemId,
): Promise<EvidenceExcerpt[]> {
  const { data, error } = await getSupabaseClient()
    .from(EVIDENCE_EXCERPTS_TABLE)
    .select(EVIDENCE_EXCERPT_COLUMNS)
    .eq('evidence_item_id', evidenceItemId)
    .order('ordinal', { ascending: true })

  if (error) {
    throw new DealDeskDatabaseError('select', EVIDENCE_EXCERPTS_TABLE, error)
  }

  return data
}

/** Reads one excerpt, or null when it does not exist or is not the caller's. */
export async function getEvidenceExcerpt(
  id: EvidenceExcerptId,
): Promise<EvidenceExcerpt | null> {
  const { data, error } = await getSupabaseClient()
    .from(EVIDENCE_EXCERPTS_TABLE)
    .select(EVIDENCE_EXCERPT_COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new DealDeskDatabaseError(
      'select single',
      EVIDENCE_EXCERPTS_TABLE,
      error,
    )
  }

  return data
}

/**
 * Adds an excerpt to one of the caller's evidence items and returns the
 * stored row. `id`, `created_at` and the generated `content_tsv` are left to
 * the database.
 *
 * The span is stored as given. The database checks that the offsets are
 * ordered and non-negative, not that `content` equals that span of the item's
 * `body_text`; producing a faithful span is the caller's responsibility.
 */
export async function createEvidenceExcerpt(
  input: CreateEvidenceExcerptInput,
): Promise<EvidenceExcerpt> {
  const { data, error } = await getSupabaseClient()
    .from(EVIDENCE_EXCERPTS_TABLE)
    .insert({
      evidence_item_id: input.evidence_item_id,
      deal_id: input.deal_id,
      ordinal: input.ordinal,
      start_offset: input.start_offset,
      end_offset: input.end_offset,
      section_label: input.section_label ?? null,
      content: input.content,
    })
    .select(EVIDENCE_EXCERPT_COLUMNS)
    .single()

  if (error) {
    throw new DealDeskDatabaseError('insert', EVIDENCE_EXCERPTS_TABLE, error)
  }

  return data
}
