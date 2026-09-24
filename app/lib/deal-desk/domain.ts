import type { Tables, TablesInsert, TablesUpdate } from '../database.types'

/**
 * Deal Desk application-domain types: the two ownership roots, Accounts and
 * Deals, and the deal's evidence.
 *
 * Sources of truth:
 * - Persistence: the canonical `gtm-stack-fit` schema, through the generated
 *   app/lib/database.types.ts. Every input type below is a `Pick` of the
 *   generated Insert or Update type, so a column rename or type change in the
 *   database fails the build here instead of drifting silently.
 * - Meaning: docs/sprint-3-domain-index.md (Deal, Account, U11, U13).
 *
 * The column sets are exactly the columns the M3 migration grants to
 * `authenticated` for INSERT and UPDATE. Anything not granted — `id`,
 * `user_id`, `created_at`, `updated_at` — cannot appear in an input type, so a
 * caller cannot send it even by mistake. In particular ownership is never an
 * input: `user_id` defaults to `auth.uid()` in the database and is not
 * insertable or updatable by the application role (J1).
 *
 * Column names stay snake_case, as the database spells them and as the
 * NoteSpace input types already do, so no mapping layer is needed.
 */

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/** The uuid of an account. An alias for readability; not a branded type. */
export type AccountId = string

/** The uuid of a deal. An alias for readability; not a branded type. */
export type DealId = string

// ---------------------------------------------------------------------------
// Controlled vocabulary (J2)
//
// The generated types declare these columns as plain `string`, because they
// are `text` with a check constraint rather than Postgres enums. The unions
// restore the constraint in TypeScript. They are hand-written, so they must be
// kept in step with deals_deal_type_check and deals_stage_check.
// ---------------------------------------------------------------------------

/** What kind of commercial transaction a deal is (Domain Index §1). */
export const DEAL_TYPES = [
  'new_business',
  'renewal',
  'expansion',
  'amendment',
] as const

export type DealType = (typeof DEAL_TYPES)[number]

/**
 * Where a deal is in its lifecycle. This is the deal's only status column:
 * how a closed deal ended (won, lost, renewed, churned, …) is a separate
 * `deal_outcomes` record (U10), not a stage.
 */
export const DEAL_STAGES = [
  'discovery',
  'negotiation',
  'contracting',
  'closed',
] as const

export type DealStage = (typeof DEAL_STAGES)[number]

/** Narrows an untrusted value, such as a form field, to a DealType. */
export function isDealType(value: unknown): value is DealType {
  return (
    typeof value === 'string' && (DEAL_TYPES as readonly string[]).includes(value)
  )
}

/** Narrows an untrusted value, such as a form field, to a DealStage. */
export function isDealStage(value: unknown): value is DealStage {
  return (
    typeof value === 'string' &&
    (DEAL_STAGES as readonly string[]).includes(value)
  )
}

// ---------------------------------------------------------------------------
// Accounts
//
// The canonical schema gives accounts no status column, so there is no
// account vocabulary.
// ---------------------------------------------------------------------------

/**
 * An account as the application sees it. `user_id` is left out: nothing in
 * the application reads ownership, which row level security enforces.
 */
export type Account = Omit<Tables<'accounts'>, 'user_id'>

/** The columns granted for both INSERT and UPDATE on `accounts`. */
type AccountWritableColumn =
  | 'name'
  | 'region'
  | 'country_code'
  | 'segment'
  | 'industry'

/** Fields a caller may supply when creating an account. `name` is required. */
export type CreateAccountInput = Pick<
  TablesInsert<'accounts'>,
  AccountWritableColumn
>

/** Fields a caller may supply when updating an account. Omitted keys are left alone. */
export type UpdateAccountInput = Pick<
  TablesUpdate<'accounts'>,
  AccountWritableColumn
>

// ---------------------------------------------------------------------------
// Deals
//
// Money is EUR only and ARR is the primary recurring metric (U11); the `_eur`
// columns carry that in their names. Dates are ISO `YYYY-MM-DD` strings.
// ---------------------------------------------------------------------------

/** A deal as the application sees it, with its vocabulary columns narrowed. */
export type Deal = Omit<Tables<'deals'>, 'user_id' | 'deal_type' | 'stage'> & {
  deal_type: DealType
  stage: DealStage
}

/**
 * The commercial columns granted for both INSERT and UPDATE on `deals`,
 * other than the two vocabulary columns, which are typed separately.
 */
type DealTermsColumn =
  | 'name'
  | 'arr_eur'
  | 'tcv_eur'
  | 'list_price_eur'
  | 'discount_pct'
  | 'term_months'
  | 'start_date'
  | 'end_date'
  | 'renewal_date'
  | 'notice_period_days'
  | 'auto_renew'

type CreateDealBase = Pick<TablesInsert<'deals'>, DealTermsColumn | 'account_id'> & {
  stage: DealStage
}

/**
 * A renewal is a new deal linked to its predecessor (U13), so a renewal must
 * name one — the database enforces the same rule with
 * deals_renewal_requires_predecessor_check. Other deal types may name a
 * predecessor but need not.
 *
 * The predecessor must be one of the caller's own deals; the composite
 * `(predecessor_deal_id, user_id)` foreign key rejects anything else.
 */
export type CreateRenewalDealInput = CreateDealBase & {
  deal_type: 'renewal'
  predecessor_deal_id: DealId
}

/** A non-renewal deal; a predecessor is optional. */
export type CreateNonRenewalDealInput = CreateDealBase & {
  deal_type: Exclude<DealType, 'renewal'>
  predecessor_deal_id?: DealId | null
}

/** Fields a caller may supply when creating a deal. */
export type CreateDealInput = CreateRenewalDealInput | CreateNonRenewalDealInput

/**
 * Fields a caller may supply when updating a deal. Omitted keys are left
 * alone.
 *
 * `account_id` and `predecessor_deal_id` are absent on purpose: the canonical
 * schema grants no UPDATE on them, so a deal's account and its renewal lineage
 * are fixed when the deal is created.
 */
export type UpdateDealInput = Pick<TablesUpdate<'deals'>, DealTermsColumn> & {
  deal_type?: DealType
  stage?: DealStage
}

// ---------------------------------------------------------------------------
// Evidence
//
// Evidence items and their excerpts are deal children (Domain Index §3,
// EVIDENCE). Neither carries `user_id`: ownership is the deal's, enforced by
// row level security through `deal_id`.
//
// Both are immutable and not independently deletable (E3): the canonical
// schema grants INSERT and SELECT only, and they disappear only when their
// deal is deleted. So there are create inputs and no update inputs.
// ---------------------------------------------------------------------------

/** The uuid of an evidence item. An alias for readability; not a branded type. */
export type EvidenceItemId = string

/**
 * The uuid of an evidence excerpt — the stable citation identifier that AI
 * findings and provisions point at. An alias; not a branded type.
 */
export type EvidenceExcerptId = string

/** What kind of source artefact an evidence item is. */
export const EVIDENCE_TYPES = [
  'msa',
  'order_form',
  'amendment',
  'dpa',
  'email',
  'call_note',
  'pricing_record',
  'security_questionnaire',
  'other',
] as const

export type EvidenceType = (typeof EVIDENCE_TYPES)[number]

/**
 * How the evidence text reached the Deal Desk. Only `pasted` can be created
 * today: `uploaded` needs Storage, which is deferred (E8).
 */
export const EVIDENCE_SOURCE_KINDS = ['pasted', 'uploaded'] as const

export type EvidenceSourceKind = (typeof EVIDENCE_SOURCE_KINDS)[number]

/** The file types an uploaded evidence item may have, once uploads exist. */
export const EVIDENCE_MIME_TYPES = ['text/plain', 'text/markdown'] as const

export type EvidenceMimeType = (typeof EVIDENCE_MIME_TYPES)[number]

/** Narrows an untrusted value, such as a form field, to an EvidenceType. */
export function isEvidenceType(value: unknown): value is EvidenceType {
  return (
    typeof value === 'string' &&
    (EVIDENCE_TYPES as readonly string[]).includes(value)
  )
}

/** Narrows an untrusted value to an EvidenceSourceKind. */
export function isEvidenceSourceKind(
  value: unknown,
): value is EvidenceSourceKind {
  return (
    typeof value === 'string' &&
    (EVIDENCE_SOURCE_KINDS as readonly string[]).includes(value)
  )
}

/** Narrows an untrusted value to an EvidenceMimeType. */
export function isEvidenceMimeType(value: unknown): value is EvidenceMimeType {
  return (
    typeof value === 'string' &&
    (EVIDENCE_MIME_TYPES as readonly string[]).includes(value)
  )
}

/**
 * An evidence item as the application sees it, with its vocabulary columns
 * narrowed. The upload columns (`storage_path`, `original_filename`,
 * `mime_type`) are null for pasted evidence.
 */
export type EvidenceItem = Omit<
  Tables<'evidence_items'>,
  'evidence_type' | 'source_kind' | 'mime_type'
> & {
  evidence_type: EvidenceType
  source_kind: EvidenceSourceKind
  mime_type: EvidenceMimeType | null
}

/**
 * Fields a caller may supply when creating pasted evidence.
 *
 * The provenance columns (`author`, `version_label`, `document_date`,
 * `is_executed`, `supersedes_evidence_id`) are fixed at insert like the rest
 * of the row. `supersedes_evidence_id` must name an item of the same deal:
 * the composite `(supersedes_evidence_id, deal_id)` foreign key rejects any
 * other.
 *
 * `source_kind` and the upload columns are not inputs: until the upload
 * feature exists (E8), the data-access layer creates pasted evidence only.
 */
export type CreateEvidenceItemInput = Pick<
  TablesInsert<'evidence_items'>,
  | 'deal_id'
  | 'title'
  | 'body_text'
  | 'author'
  | 'version_label'
  | 'document_date'
  | 'is_executed'
  | 'supersedes_evidence_id'
> & {
  evidence_type: EvidenceType
}

/**
 * An evidence excerpt as the application sees it: an addressable span of an
 * item's `body_text`, the unit of retrieval and citation.
 *
 * `content_tsv`, the generated full-text column, is left out; retrieval will
 * query it in the database rather than read it.
 */
export type EvidenceExcerpt = Omit<Tables<'evidence_excerpts'>, 'content_tsv'>

/**
 * Fields a caller may supply when creating an excerpt.
 *
 * `deal_id` must be the item's own deal: the composite
 * `(evidence_item_id, deal_id)` foreign key rejects any other, so an excerpt
 * can never point outside its deal. `ordinal` is unique per item.
 */
export type CreateEvidenceExcerptInput = Pick<
  TablesInsert<'evidence_excerpts'>,
  | 'evidence_item_id'
  | 'deal_id'
  | 'ordinal'
  | 'start_offset'
  | 'end_offset'
  | 'section_label'
  | 'content'
>
