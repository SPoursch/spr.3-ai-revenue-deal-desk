import type {
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from '../database.types'

/**
 * Deal Desk application-domain types: the two ownership roots, Accounts and
 * Deals, and the deal's evidence, provisions, AI findings and exceptions.
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

// ---------------------------------------------------------------------------
// Provisions
//
// A provision is a confirmed commercial or legal term of a deal (Domain Index
// §1, U4): a structured fact, not an AI candidate. AI candidates stay in
// `ai_findings` until a human confirms them; confirming one creates a
// provision with source 'ai_confirmed' that names the finding.
//
// Provisions are deal children without `user_id`; ownership is the deal's,
// through row level security on `deal_id`. They are mutable in their value
// and confirmation time only. Identity, deal, type and provenance
// (`provision_type`, `source`, `source_finding_id`) are fixed at insert (E4).
// ---------------------------------------------------------------------------

/** The uuid of a provision. An alias for readability; not a branded type. */
export type ProvisionId = string

/** Which contractual term a provision records. One per type per deal (C4). */
export const PROVISION_TYPES = [
  'liability_cap',
  'data_residency',
  'payment_terms',
  'auto_renewal',
  'termination',
  'discount',
  'governing_law',
] as const

export type ProvisionType = (typeof PROVISION_TYPES)[number]

/** The unit of a provision's numeric value, when it has one. */
export const PROVISION_VALUE_UNITS = [
  'months_of_fees',
  'eur',
  'days',
  'percent',
  'region',
] as const

export type ProvisionValueUnit = (typeof PROVISION_VALUE_UNITS)[number]

/**
 * How a provision was established: typed in by a human, or an AI candidate a
 * human confirmed. Both are human-confirmed; the AI never creates one alone.
 */
export const PROVISION_SOURCES = ['human_entered', 'ai_confirmed'] as const

export type ProvisionSource = (typeof PROVISION_SOURCES)[number]

/** Narrows an untrusted value, such as a form field, to a ProvisionType. */
export function isProvisionType(value: unknown): value is ProvisionType {
  return (
    typeof value === 'string' &&
    (PROVISION_TYPES as readonly string[]).includes(value)
  )
}

/** Narrows an untrusted value to a ProvisionValueUnit. */
export function isProvisionValueUnit(
  value: unknown,
): value is ProvisionValueUnit {
  return (
    typeof value === 'string' &&
    (PROVISION_VALUE_UNITS as readonly string[]).includes(value)
  )
}

/** Narrows an untrusted value to a ProvisionSource. */
export function isProvisionSource(value: unknown): value is ProvisionSource {
  return (
    typeof value === 'string' &&
    (PROVISION_SOURCES as readonly string[]).includes(value)
  )
}

/** A provision as the application sees it, with its vocabulary columns narrowed. */
export type Provision = Omit<
  Tables<'provisions'>,
  'provision_type' | 'value_unit' | 'source'
> & {
  provision_type: ProvisionType
  value_unit: ProvisionValueUnit | null
  source: ProvisionSource
}

/**
 * The value columns, granted for both INSERT and UPDATE. `value_numeric` and
 * `value_unit` are both set or both null; the database enforces the pair
 * (provisions_value_unit_pair_check).
 */
type ProvisionValueFields = Pick<
  TablesInsert<'provisions'>,
  'value_text' | 'value_numeric'
> & {
  value_unit?: ProvisionValueUnit | null
}

type CreateProvisionBase = Pick<TablesInsert<'provisions'>, 'deal_id'> &
  ProvisionValueFields & {
    provision_type: ProvisionType
  }

/**
 * A provision a human typed in. It may still name the finding it was prompted
 * by; the schema allows that and requires nothing of it.
 */
export type CreateHumanEnteredProvisionInput = CreateProvisionBase & {
  source: 'human_entered'
  source_finding_id?: string | null
}

/**
 * A provision confirmed from an AI candidate. It must name that finding — the
 * database enforces the same rule with provisions_ai_confirmed_source_check —
 * and the finding must belong to the same deal (composite foreign key).
 */
export type CreateAiConfirmedProvisionInput = CreateProvisionBase & {
  source: 'ai_confirmed'
  source_finding_id: string
}

/**
 * Fields a caller may supply when creating a provision. `confirmed_at` is not
 * one of them: the database stamps the confirmation time, so a provision
 * cannot be created backdated.
 */
export type CreateProvisionInput =
  | CreateHumanEnteredProvisionInput
  | CreateAiConfirmedProvisionInput

/**
 * Fields a caller may supply when updating a provision — exactly the four
 * columns the schema grants for UPDATE. Omitted keys are left alone.
 *
 * `confirmed_at` records a human (re)confirmation; the schema leaves setting
 * it to the application and does not constrain the value.
 */
export type UpdateProvisionInput = Partial<
  Pick<TablesUpdate<'provisions'>, 'value_text' | 'value_numeric' | 'confirmed_at'>
> & {
  value_unit?: ProvisionValueUnit | null
}

/**
 * A citation linking a provision to an evidence excerpt that supports it. A
 * provision with none is shown as an unsupported claim.
 */
export type ProvisionExcerpt = Tables<'provision_excerpts'>

/**
 * Fields for a new citation. `deal_id` must be the deal of both the provision
 * and the excerpt: two composite foreign keys reject anything else.
 */
export type CreateProvisionExcerptInput = Pick<
  TablesInsert<'provision_excerpts'>,
  'provision_id' | 'excerpt_id' | 'deal_id'
>

// ---------------------------------------------------------------------------
// AI findings
//
// Model output kept for audit (Domain Index §4): a candidate, proposal or
// explanation, never a Decision and never authoritative on its own. Findings
// are deal children without `user_id`; ownership is the deal's.
//
// Content is immutable: the schema grants UPDATE of `status` only, and no
// DELETE — a finding disappears only with its deal. `created_at` is stamped
// by the database.
// ---------------------------------------------------------------------------

/** The uuid of an AI finding. An alias for readability; not a branded type. */
export type AiFindingId = string

/** What an AI finding is about. */
export const AI_FINDING_TYPES = [
  'provision_candidate',
  'exception_proposal',
  'risk_explanation',
  'deal_summary',
  'answer',
] as const

export type AiFindingType = (typeof AI_FINDING_TYPES)[number]

/** Where a finding stands with the human reviewing it. */
export const AI_FINDING_STATUSES = [
  'proposed',
  'accepted',
  'rejected',
  'superseded',
] as const

export type AiFindingStatus = (typeof AI_FINDING_STATUSES)[number]

/** Narrows an untrusted value to an AiFindingType. */
export function isAiFindingType(value: unknown): value is AiFindingType {
  return (
    typeof value === 'string' &&
    (AI_FINDING_TYPES as readonly string[]).includes(value)
  )
}

/** Narrows an untrusted value to an AiFindingStatus. */
export function isAiFindingStatus(value: unknown): value is AiFindingStatus {
  return (
    typeof value === 'string' &&
    (AI_FINDING_STATUSES as readonly string[]).includes(value)
  )
}

/** An AI finding as the application sees it, with its vocabulary columns narrowed. */
export type AiFinding = Omit<Tables<'ai_findings'>, 'finding_type' | 'status'> & {
  finding_type: AiFindingType
  status: AiFindingStatus
}

/**
 * The content columns of a new finding. `rule_key` and `rule_version` are set
 * together or not at all; the database enforces the pair
 * (ai_findings_rule_pair_check). `model` is the OpenRouter model id and
 * `prompt_version` the prompt template version in code.
 */
type CreateAiFindingBase = Pick<
  TablesInsert<'ai_findings'>,
  'deal_id' | 'content' | 'rule_key' | 'rule_version' | 'model' | 'prompt_version'
>

/**
 * A provision candidate must carry its structured payload — the database
 * enforces the same rule with ai_findings_candidate_payload_check.
 */
export type CreateProvisionCandidateFindingInput = CreateAiFindingBase & {
  finding_type: 'provision_candidate'
  payload: Json
}

/** Any other finding; a payload is optional. */
export type CreateOtherAiFindingInput = CreateAiFindingBase & {
  finding_type: Exclude<AiFindingType, 'provision_candidate'>
  payload?: Json | null
}

/**
 * Fields a caller may supply when recording a finding. `status` is not one of
 * them: every finding starts as 'proposed', and only a later status update —
 * a human review — moves it.
 */
export type CreateAiFindingInput =
  | CreateProvisionCandidateFindingInput
  | CreateOtherAiFindingInput

// ---------------------------------------------------------------------------
// Exceptions
//
// A human-facing deviation of a deal from a rule (U8). Rules are code (U3):
// an exception names its rule by `rule_key` and `rule_version`, not by a
// foreign key. Exceptions are deal children without `user_id`; ownership is
// the deal's.
//
// Everything but `status` is fixed at insert (E4), and there is no DELETE —
// an exception disappears only with its deal. `status_changed_at` is
// maintained by a trigger whenever the status changes (E9).
// ---------------------------------------------------------------------------

/** The uuid of an exception. An alias for readability; not a branded type. */
export type ExceptionId = string

/** What kind of deviation an exception records. */
export const EXCEPTION_KINDS = [
  'non_standard_provision',
  'threshold_breach',
  'missing_evidence',
  'conflicting_evidence',
  'timing_risk',
  'commercial_risk',
] as const

export type ExceptionKind = (typeof EXCEPTION_KINDS)[number]

export const EXCEPTION_SEVERITIES = ['low', 'medium', 'high'] as const

export type ExceptionSeverity = (typeof EXCEPTION_SEVERITIES)[number]

/** Whether a deterministic rule or an AI finding raised the exception. */
export const EXCEPTION_ORIGINS = ['deterministic', 'ai'] as const

export type ExceptionOrigin = (typeof EXCEPTION_ORIGINS)[number]

/** Every status an exception can have (U8). */
export const EXCEPTION_STATUSES = [
  'open',
  'under_review',
  'decided',
  'dismissed',
] as const

export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number]

/**
 * The statuses a reviewer may set directly. `decided` and `dismissed` are the
 * result of recording a human Decision, which sets them in the same
 * transaction (E5, E6); setting them any other way would claim a Decision
 * that does not exist. The schema itself does not prevent that, so the
 * application keeps to this subset.
 */
export const EXCEPTION_REVIEW_STATUSES = ['open', 'under_review'] as const

export type ExceptionReviewStatus = (typeof EXCEPTION_REVIEW_STATUSES)[number]

/** Narrows an untrusted value to an ExceptionKind. */
export function isExceptionKind(value: unknown): value is ExceptionKind {
  return (
    typeof value === 'string' &&
    (EXCEPTION_KINDS as readonly string[]).includes(value)
  )
}

/** Narrows an untrusted value to an ExceptionSeverity. */
export function isExceptionSeverity(value: unknown): value is ExceptionSeverity {
  return (
    typeof value === 'string' &&
    (EXCEPTION_SEVERITIES as readonly string[]).includes(value)
  )
}

/** Narrows an untrusted value to an ExceptionOrigin. */
export function isExceptionOrigin(value: unknown): value is ExceptionOrigin {
  return (
    typeof value === 'string' &&
    (EXCEPTION_ORIGINS as readonly string[]).includes(value)
  )
}

/** Narrows an untrusted value to an ExceptionStatus. */
export function isExceptionStatus(value: unknown): value is ExceptionStatus {
  return (
    typeof value === 'string' &&
    (EXCEPTION_STATUSES as readonly string[]).includes(value)
  )
}

/** Narrows an untrusted value to an ExceptionReviewStatus. */
export function isExceptionReviewStatus(
  value: unknown,
): value is ExceptionReviewStatus {
  return (
    typeof value === 'string' &&
    (EXCEPTION_REVIEW_STATUSES as readonly string[]).includes(value)
  )
}

/**
 * An exception as the application sees it, with its vocabulary columns
 * narrowed. Named DealException so it is not mistaken for a thrown error.
 */
export type DealException = Omit<
  Tables<'exceptions'>,
  'kind' | 'severity' | 'origin' | 'status'
> & {
  kind: ExceptionKind
  severity: ExceptionSeverity
  origin: ExceptionOrigin
  status: ExceptionStatus
}

/**
 * The columns of a new exception. `provision_id`, when set, must be a
 * provision of the same deal (composite foreign key). At most one exception
 * per rule may be live — open or under review — on a deal
 * (exceptions_deal_id_rule_key_live_key).
 */
type CreateExceptionBase = Pick<
  TablesInsert<'exceptions'>,
  'deal_id' | 'rule_key' | 'rule_version' | 'title' | 'why' | 'provision_id'
> & {
  kind: ExceptionKind
  severity: ExceptionSeverity
}

/**
 * An exception raised from an AI finding must name that finding — the
 * database enforces the same rule with exceptions_ai_origin_source_check —
 * and the finding must be of the same deal.
 */
export type CreateAiExceptionInput = CreateExceptionBase & {
  origin: 'ai'
  source_finding_id: AiFindingId
}

/** An exception raised by a deterministic rule; a source finding is optional. */
export type CreateDeterministicExceptionInput = CreateExceptionBase & {
  origin: 'deterministic'
  source_finding_id?: AiFindingId | null
}

/**
 * Fields a caller may supply when raising an exception. `status` is not one
 * of them: every exception starts 'open' (C7).
 */
export type CreateExceptionInput =
  | CreateAiExceptionInput
  | CreateDeterministicExceptionInput
