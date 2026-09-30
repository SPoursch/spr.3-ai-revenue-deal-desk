import {
  isDealStage,
  isDealType,
  isEvidenceType,
  isProvisionType,
  isProvisionValueUnit,
  type Account,
  type CreateAccountInput,
  type CreateEvidenceItemInput,
  type CreateNonRenewalDealInput,
  type CreateRenewalDealInput,
  type Deal,
  type DealStage,
  type DealType,
  type ProvisionType,
  type ProvisionValueUnit,
  type UpdateDealInput,
} from './domain'
import { splitIntoParagraphs } from './excerpts'

/**
 * Server-side parsing of the Deal Records forms.
 *
 * Each function turns a submitted `FormData` into the typed input the
 * existing data layer takes (`createAccount`, `createDeal`), or into
 * field-level errors. The rules mirror the canonical database checks on
 * `accounts` and `deals` (gtm-stack-fit/docs/platform-persistence-design.md),
 * so a value the database would reject is rejected here first, with a
 * message tied to its field instead of a failed insert.
 *
 * A form is untrusted input. Only the named fields are read; anything else in
 * the submission, `user_id` included, is ignored. Ownership comes from the
 * verified session in the data layer, never from the form.
 */

/** Field name (as submitted by the form) → a message safe to show the user. */
export type DealDeskFieldErrors = Partial<Record<string, string>>

export type FormResult<T> =
  | { ok: true; value: T }
  | { ok: false; fieldErrors: DealDeskFieldErrors }

/** The account form's field names, in the order the form shows them. */
export const ACCOUNT_FORM_FIELDS = [
  'name',
  'region',
  'countryCode',
  'segment',
  'industry',
] as const

/** The deal form's field names, in the order the form shows them. */
export const DEAL_FORM_FIELDS = [
  'accountId',
  'predecessorDealId',
  'name',
  'dealType',
  'stage',
  'arrEur',
  'tcvEur',
  'listPriceEur',
  'discountPct',
  'termMonths',
  'startDate',
  'endDate',
  'renewalDate',
  'noticePeriodDays',
  'autoRenew',
] as const

/** The evidence form's field names, in the order the form shows them. */
export const EVIDENCE_FORM_FIELDS = [
  'evidenceType',
  'title',
  'bodyText',
  'author',
  'versionLabel',
  'documentDate',
  'isExecuted',
] as const

/**
 * The submitted values of the named fields, as strings, for re-filling a
 * form after a failed submission. Files and unknown fields are dropped.
 */
export function readFormValues(
  formData: FormData,
  fields: readonly string[],
): Record<string, string> {
  const values: Record<string, string> = {}

  for (const field of fields) {
    const raw = formData.get(field)
    if (typeof raw === 'string') values[field] = raw
  }

  return values
}

/** Names, and the free-text account fields, are capped as the schema caps names. */
const MAX_NAME_LENGTH = 200
/** `evidence_items_title_check`: 1–300 characters once trimmed. */
const MAX_EVIDENCE_TITLE_LENGTH = 300
/**
 * Pasted evidence is capped well below the Server Action body limit (1 MB by
 * default), so a long document gets a field message, not a failed request.
 */
export const MAX_EVIDENCE_BODY_LENGTH = 100_000
/**
 * Each paragraph becomes one excerpt, stored with one insert, so the count is
 * capped: 100,000 characters of one-letter paragraphs would otherwise be
 * tens of thousands of inserts in a single request.
 */
export const MAX_EVIDENCE_PARAGRAPHS = 500
const MAX_TEXT_LENGTH = 200

/** `numeric(14,2)`: up to 12 whole digits and 2 decimals, never negative. */
const EUR_PATTERN = /^\d{1,12}(\.\d{1,2})?$/
/** `numeric(5,2)` limited to 0–100. */
const PERCENT_PATTERN = /^\d{1,3}(\.\d{1,2})?$/
/** A whole number that fits an `integer` column comfortably. */
const COUNT_PATTERN = /^\d{1,9}$/
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The trimmed value of a field, or null when it is absent or blank. */
function readText(formData: FormData, field: string): string | null {
  const raw = formData.get(field)
  if (typeof raw !== 'string') return null

  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** A real calendar date in ISO `YYYY-MM-DD` form, e.g. not 2026-02-30. */
function isIsoDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value)
  if (!match) return false

  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

/**
 * Collects field errors while reading, so a form reports every problem at
 * once rather than one per submission.
 */
class FieldReader {
  readonly errors: DealDeskFieldErrors = {}

  constructor(private readonly formData: FormData) {}

  private fail(field: string, message: string): null {
    this.errors[field] = message
    return null
  }

  requiredName(field: string, label: string, maxLength = MAX_NAME_LENGTH): string | null {
    const value = readText(this.formData, field)
    if (value === null) return this.fail(field, `Enter ${label}.`)
    if (value.length > maxLength) {
      return this.fail(field, `Keep ${label} to ${maxLength} characters or fewer.`)
    }
    return value
  }

  optionalText(field: string): string | null {
    const value = readText(this.formData, field)
    if (value !== null && value.length > MAX_TEXT_LENGTH) {
      return this.fail(field, `Keep this to ${MAX_TEXT_LENGTH} characters or fewer.`)
    }
    return value
  }

  eur(field: string, required: boolean): number | null {
    const value = readText(this.formData, field)
    if (value === null) {
      return required ? this.fail(field, 'Enter an amount in euros.') : null
    }
    if (!EUR_PATTERN.test(value)) {
      return this.fail(
        field,
        'Enter an amount in euros using digits only, with up to two decimals (e.g. 60000 or 60000.50).',
      )
    }
    return Number(value)
  }

  percent(field: string): number | null {
    const value = readText(this.formData, field)
    if (value === null) return null
    if (!PERCENT_PATTERN.test(value) || Number(value) > 100) {
      return this.fail(field, 'Enter a percentage between 0 and 100, with up to two decimals.')
    }
    return Number(value)
  }

  count(field: string, minimum: number, message: string): number | null {
    const value = readText(this.formData, field)
    if (value === null) return null
    if (!COUNT_PATTERN.test(value) || Number(value) < minimum) {
      return this.fail(field, message)
    }
    return Number(value)
  }

  date(field: string): string | null {
    const value = readText(this.formData, field)
    if (value !== null && !isIsoDate(value)) {
      return this.fail(field, 'Enter a valid date.')
    }
    return value
  }

  errorFor(field: string, message: string): void {
    this.fail(field, message)
  }
}

/** Parses the account form into `CreateAccountInput`. */
export function parseAccountForm(formData: FormData): FormResult<CreateAccountInput> {
  const read = new FieldReader(formData)

  const name = read.requiredName('name', 'an account name')
  const region = read.optionalText('region')
  const segment = read.optionalText('segment')
  const industry = read.optionalText('industry')

  const rawCountryCode = readText(formData, 'countryCode')
  const countryCode = rawCountryCode === null ? null : rawCountryCode.toUpperCase()
  if (countryCode !== null && !COUNTRY_CODE_PATTERN.test(countryCode)) {
    read.errorFor('countryCode', 'Enter a two-letter country code, e.g. DE.')
  }

  if (Object.keys(read.errors).length > 0 || name === null) {
    return { ok: false, fieldErrors: read.errors }
  }

  return {
    ok: true,
    value: { name, region, country_code: countryCode, segment, industry },
  }
}

/** The deal fields shared by create and edit: name, type, stage, terms, dates. */
type DealTerms = Omit<UpdateDealInput, 'deal_type' | 'stage'> & {
  name: string
  deal_type: DealType
  stage: DealStage
  arr_eur: number
}

/**
 * Reads the fields a deal has whether it is being created or edited,
 * recording any errors on `read`. Returns null when a required field is
 * missing or invalid.
 *
 * `fixedDealType`, when given, is the deal type, and the submitted
 * `dealType` is not read at all.
 */
function readDealTerms(
  read: FieldReader,
  formData: FormData,
  fixedDealType?: DealType,
): DealTerms | null {
  const name = read.requiredName('name', 'a deal name')

  const dealType = fixedDealType ?? formData.get('dealType')
  if (!isDealType(dealType)) read.errorFor('dealType', 'Choose a deal type.')

  const stage = formData.get('stage')
  if (!isDealStage(stage)) read.errorFor('stage', 'Choose a stage.')

  const arrEur = read.eur('arrEur', true)
  const tcvEur = read.eur('tcvEur', false)
  const listPriceEur = read.eur('listPriceEur', false)
  const discountPct = read.percent('discountPct')
  const termMonths = read.count('termMonths', 1, 'Enter the term as a whole number of months, at least 1.')
  const noticePeriodDays = read.count(
    'noticePeriodDays',
    0,
    'Enter the notice period as a whole number of days.',
  )
  const startDate = read.date('startDate')
  const endDate = read.date('endDate')
  const renewalDate = read.date('renewalDate')

  if (startDate !== null && endDate !== null && endDate < startDate) {
    read.errorFor('endDate', 'The end date cannot be before the start date.')
  }

  const rawAutoRenew = readText(formData, 'autoRenew')
  let autoRenew: boolean | null = null
  if (rawAutoRenew === 'yes') autoRenew = true
  else if (rawAutoRenew === 'no') autoRenew = false
  else if (rawAutoRenew !== null) {
    read.errorFor('autoRenew', 'Choose whether the deal renews automatically.')
  }

  if (name === null || arrEur === null || !isDealType(dealType) || !isDealStage(stage)) {
    return null
  }

  return {
    name,
    deal_type: dealType,
    stage,
    arr_eur: arrEur,
    tcv_eur: tcvEur,
    list_price_eur: listPriceEur,
    discount_pct: discountPct,
    term_months: termMonths,
    start_date: startDate,
    end_date: endDate,
    renewal_date: renewalDate,
    notice_period_days: noticePeriodDays,
    auto_renew: autoRenew,
  }
}

/**
 * Parses the deal form into a `CreateNonRenewalDealInput`.
 *
 * A renewal is created only from the deal it renews (`parseRenewalForm` and
 * `createRenewalAction`), which keeps it on its predecessor's account (U13).
 * So this form refuses the `renewal` type and never reads a predecessor:
 * nothing submitted here can create renewal lineage.
 */
export function parseDealForm(formData: FormData): FormResult<CreateNonRenewalDealInput> {
  const read = new FieldReader(formData)

  const accountId = readText(formData, 'accountId')
  if (accountId === null || !UUID_PATTERN.test(accountId)) {
    read.errorFor('accountId', 'Choose the account this deal belongs to.')
  }

  const terms = readDealTerms(read, formData)

  // Read from the submission, so this is reported even when other fields
  // are invalid.
  if (formData.get('dealType') === 'renewal') {
    read.errorFor('dealType', 'Create a renewal from the deal it renews.')
  }

  if (
    Object.keys(read.errors).length > 0 ||
    accountId === null ||
    terms === null ||
    terms.deal_type === 'renewal'
  ) {
    return { ok: false, fieldErrors: read.errors }
  }

  return {
    ok: true,
    value: { ...terms, account_id: accountId, deal_type: terms.deal_type, predecessor_deal_id: null },
  }
}

/**
 * Parses the edit-deal form into `UpdateDealInput`.
 *
 * The account and the predecessor are fixed when a deal is created (the
 * database grants no UPDATE on them), so the form cannot change them and
 * anything submitted for them is ignored. For the same reason a deal can
 * only become a renewal if it already has a predecessor.
 */
export function parseDealUpdateForm(
  formData: FormData,
  { hasPredecessor }: { hasPredecessor: boolean },
): FormResult<UpdateDealInput> {
  const read = new FieldReader(formData)
  const terms = readDealTerms(read, formData)

  // Read from the submission, so this is reported even when other fields
  // are invalid.
  if (formData.get('dealType') === 'renewal' && !hasPredecessor) {
    read.errorFor(
      'dealType',
      'Only a deal created as a renewal of another deal can be a renewal.',
    )
  }

  if (Object.keys(read.errors).length > 0 || terms === null) {
    return { ok: false, fieldErrors: read.errors }
  }

  return { ok: true, value: terms }
}

/**
 * A renewal as its form describes it: everything but its account and
 * predecessor, which come from the predecessor deal itself.
 */
export type RenewalTerms = Omit<CreateRenewalDealInput, 'account_id' | 'predecessor_deal_id'>

/**
 * Parses the renewal form into the renewal's terms, always of type `renewal`.
 *
 * A renewal belongs to its predecessor's account (U13), so anything submitted
 * as `dealType`, `accountId` or `predecessorDealId` is ignored here; the
 * Server Action takes the predecessor from its own id and the account from
 * the stored predecessor.
 */
export function parseRenewalForm(formData: FormData): FormResult<RenewalTerms> {
  const read = new FieldReader(formData)
  const terms = readDealTerms(read, formData, 'renewal')

  if (Object.keys(read.errors).length > 0 || terms === null) {
    return { ok: false, fieldErrors: read.errors }
  }

  return { ok: true, value: { ...terms, deal_type: 'renewal' } }
}

/** What the evidence form supplies: everything but the deal, which is the page's. */
export type EvidenceTerms = Omit<CreateEvidenceItemInput, 'deal_id' | 'supersedes_evidence_id'>

/**
 * Parses the add-evidence form into the item's terms.
 *
 * The body is kept exactly as submitted, untrimmed, because excerpt offsets
 * point into it; it only has to contain some text. The deal, owner, source
 * kind and supersession are never read from the form: the Server Action takes
 * the deal from the verified deal and the data layer fixes the rest.
 */
export function parseEvidenceForm(formData: FormData): FormResult<EvidenceTerms> {
  const read = new FieldReader(formData)

  const evidenceType = formData.get('evidenceType')
  if (!isEvidenceType(evidenceType)) read.errorFor('evidenceType', 'Choose a type of evidence.')

  const title = read.requiredName('title', 'a title', MAX_EVIDENCE_TITLE_LENGTH)

  const rawBody = formData.get('bodyText')
  const bodyText = typeof rawBody === 'string' ? rawBody : ''
  if (bodyText.trim().length === 0) {
    read.errorFor('bodyText', 'Paste the text of the evidence.')
  } else if (bodyText.length > MAX_EVIDENCE_BODY_LENGTH) {
    read.errorFor(
      'bodyText',
      `Keep the text to ${MAX_EVIDENCE_BODY_LENGTH.toLocaleString('en-GB')} characters or fewer.`,
    )
  } else if (splitIntoParagraphs(bodyText).length > MAX_EVIDENCE_PARAGRAPHS) {
    read.errorFor(
      'bodyText',
      `Keep the text to ${MAX_EVIDENCE_PARAGRAPHS} paragraphs or fewer.`,
    )
  }

  const author = read.optionalText('author')
  const versionLabel = read.optionalText('versionLabel')
  const documentDate = read.date('documentDate')

  const rawExecuted = formData.get('isExecuted')
  if (rawExecuted !== null && rawExecuted !== 'yes') {
    read.errorFor('isExecuted', 'Tick the box only if this is the executed version.')
  }

  if (Object.keys(read.errors).length > 0 || !isEvidenceType(evidenceType) || title === null) {
    return { ok: false, fieldErrors: read.errors }
  }

  return {
    ok: true,
    value: {
      evidence_type: evidenceType,
      title,
      body_text: bodyText,
      author,
      version_label: versionLabel,
      document_date: documentDate,
      is_executed: rawExecuted === 'yes',
    },
  }
}

// ---------------------------------------------------------------------------
// Provisions (Contract / Document Intelligence V1)
// ---------------------------------------------------------------------------

/** The provision form's value fields, in the order the form shows them. */
export const PROVISION_FORM_FIELDS = [
  'provisionType',
  'valueText',
  'valueNumeric',
  'valueUnit',
] as const

/** `value_text` has no length check in the schema, so the application caps it. */
export const MAX_PROVISION_VALUE_LENGTH = 500

/** How many excerpts one request may cite: a bound on each batched insert. */
export const MAX_CITATIONS_PER_REQUEST = 20

/**
 * The units each provision type's number may be stated in. A type with none
 * takes no number: its term is only the value text. `region` is in the schema
 * vocabulary but is not a number, so it is never allowed (known schema debt).
 */
export const PROVISION_UNITS_BY_TYPE: Record<ProvisionType, readonly ProvisionValueUnit[]> = {
  liability_cap: ['months_of_fees', 'eur'],
  payment_terms: ['days'],
  auto_renewal: ['days'],
  termination: ['days'],
  discount: ['percent'],
  data_residency: [],
  governing_law: [],
}

/** A provision's value as stored: the text, and a number with its unit or neither. */
export type ProvisionValue = {
  value_text: string
  value_numeric: number | null
  value_unit: ProvisionValueUnit | null
}

/** A non-negative number with up to two decimals, as `numeric` stores it. */
const PROVISION_NUMBER_PATTERN = /^\d{1,12}(\.\d{1,2})?$/

/**
 * Reads the value fields for a provision of `type`, recording any errors on
 * `read`. The number and unit are both given or both left out, and the unit
 * must be one `PROVISION_UNITS_BY_TYPE` allows for the type.
 */
function readProvisionValue(
  read: FieldReader,
  formData: FormData,
  type: ProvisionType | null,
): ProvisionValue | null {
  const valueText = read.requiredName('valueText', 'a value', MAX_PROVISION_VALUE_LENGTH)

  const rawNumber = readText(formData, 'valueNumeric')
  let valueNumeric: number | null = null
  if (rawNumber !== null) {
    if (PROVISION_NUMBER_PATTERN.test(rawNumber)) valueNumeric = Number(rawNumber)
    else read.errorFor('valueNumeric', 'Enter a number using digits only, with up to two decimals.')
  }

  const rawUnit = readText(formData, 'valueUnit')
  const valueUnit = isProvisionValueUnit(rawUnit) ? rawUnit : null
  if (rawUnit !== null && valueUnit === null) read.errorFor('valueUnit', 'Choose a unit.')

  if (type !== null && (rawNumber !== null || rawUnit !== null)) {
    const allowed = PROVISION_UNITS_BY_TYPE[type]
    if (allowed.length === 0) {
      read.errorFor('valueNumeric', 'This type of provision takes no number; state it in the value.')
    } else if (rawNumber === null) {
      read.errorFor('valueNumeric', 'Enter the number for this unit.')
    } else if (rawUnit === null) {
      read.errorFor('valueUnit', 'Choose the unit of the number.')
    } else if (valueUnit !== null && !allowed.includes(valueUnit)) {
      read.errorFor('valueUnit', 'Choose a unit that fits this type of provision.')
    } else if (type === 'discount' && valueNumeric !== null && valueNumeric > 100) {
      // A discount is a percentage (the number is never negative).
      read.errorFor('valueNumeric', 'Enter a discount between 0 and 100 percent.')
    }
  }

  if (valueText === null) return null
  return { value_text: valueText, value_numeric: valueNumeric, value_unit: valueUnit }
}

/**
 * Reads the chosen excerpt ids: uuids only, duplicates removed, at most
 * `MAX_CITATIONS_PER_REQUEST`, and at least one when `required`. Whether each
 * is an excerpt of the provision's deal is for the caller to check.
 */
function readExcerptIds(
  read: FieldReader,
  formData: FormData,
  { required }: { required: boolean },
): string[] {
  const raw = formData.getAll('excerptIds')
  const ids = [...new Set(raw.filter((value): value is string => typeof value === 'string'))]

  if (raw.some((value) => typeof value !== 'string' || !UUID_PATTERN.test(value))) {
    read.errorFor('excerptIds', 'Choose excerpts from the list.')
  } else if (ids.length > MAX_CITATIONS_PER_REQUEST) {
    read.errorFor(
      'excerptIds',
      `Choose at most ${MAX_CITATIONS_PER_REQUEST} excerpts at a time.`,
    )
  } else if (required && ids.length === 0) {
    read.errorFor('excerptIds', 'Choose at least one excerpt.')
  }

  return ids
}

/** A new provision as its form describes it, with the excerpts it cites. */
export type ProvisionTerms = ProvisionValue & {
  provision_type: ProvisionType
  excerpt_ids: string[]
}

/**
 * Parses the add-provision form. The deal, `source`, `source_finding_id` and
 * `confirmed_at` are never read: the Server Action takes the deal from the
 * verified deal and fixes the provenance itself.
 */
export function parseProvisionForm(formData: FormData): FormResult<ProvisionTerms> {
  const read = new FieldReader(formData)

  const rawType = formData.get('provisionType')
  const provisionType = isProvisionType(rawType) ? rawType : null
  if (provisionType === null) read.errorFor('provisionType', 'Choose a type of provision.')

  const value = readProvisionValue(read, formData, provisionType)
  const excerptIds = readExcerptIds(read, formData, { required: false })

  if (Object.keys(read.errors).length > 0 || provisionType === null || value === null) {
    return { ok: false, fieldErrors: read.errors }
  }

  return { ok: true, value: { ...value, provision_type: provisionType, excerpt_ids: excerptIds } }
}

/**
 * Parses the edit-provision form for a provision of `type`: its value only.
 * The type, deal, provenance and `confirmed_at` are fixed and never read.
 */
export function parseProvisionValueForm(
  formData: FormData,
  type: ProvisionType,
): FormResult<ProvisionValue> {
  const read = new FieldReader(formData)
  const value = readProvisionValue(read, formData, type)

  if (Object.keys(read.errors).length > 0 || value === null) {
    return { ok: false, fieldErrors: read.errors }
  }

  return { ok: true, value }
}

/** Parses the add-citations form: at least one, at most 20, excerpt ids. */
export function parseCitationForm(formData: FormData): FormResult<string[]> {
  const read = new FieldReader(formData)
  const excerptIds = readExcerptIds(read, formData, { required: true })

  if (Object.keys(read.errors).length > 0) {
    return { ok: false, fieldErrors: read.errors }
  }

  return { ok: true, value: excerptIds }
}

/** An existing provision's value as the edit form's starting values. */
export function toProvisionFormValues(provision: ProvisionValue): Record<string, string> {
  return {
    valueText: provision.value_text,
    valueNumeric: toFormNumber(provision.value_numeric),
    valueUnit: provision.value_unit ?? '',
  }
}

/** Whether a value is a uuid, the shape of every record id. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

/** A stored number as the form shows it, or '' when it is not set. */
function toFormNumber(value: number | null): string {
  return value === null ? '' : String(value)
}

/** An existing account as the account form's starting values. */
export function toAccountFormValues(account: Account): Record<string, string> {
  return {
    name: account.name,
    region: account.region ?? '',
    countryCode: account.country_code ?? '',
    segment: account.segment ?? '',
    industry: account.industry ?? '',
  }
}

/** An existing deal as the deal form's starting values. */
export function toDealFormValues(deal: Deal): Record<string, string> {
  return {
    name: deal.name,
    dealType: deal.deal_type,
    stage: deal.stage,
    arrEur: toFormNumber(deal.arr_eur),
    tcvEur: toFormNumber(deal.tcv_eur),
    listPriceEur: toFormNumber(deal.list_price_eur),
    discountPct: toFormNumber(deal.discount_pct),
    termMonths: toFormNumber(deal.term_months),
    startDate: deal.start_date ?? '',
    endDate: deal.end_date ?? '',
    renewalDate: deal.renewal_date ?? '',
    noticePeriodDays: toFormNumber(deal.notice_period_days),
    autoRenew: deal.auto_renew === null ? '' : deal.auto_renew ? 'yes' : 'no',
  }
}
