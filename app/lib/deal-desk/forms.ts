import {
  isDealStage,
  isDealType,
  type Account,
  type CreateAccountInput,
  type CreateDealInput,
  type CreateRenewalDealInput,
  type Deal,
  type DealId,
  type DealStage,
  type DealType,
  type UpdateDealInput,
} from './domain'

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

  requiredName(field: string, label: string): string | null {
    const value = readText(this.formData, field)
    if (value === null) return this.fail(field, `Enter ${label}.`)
    if (value.length > MAX_NAME_LENGTH) {
      return this.fail(field, `Keep ${label} to ${MAX_NAME_LENGTH} characters or fewer.`)
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

  optionalUuid(field: string, message: string): string | null {
    const value = readText(this.formData, field)
    if (value !== null && !UUID_PATTERN.test(value)) return this.fail(field, message)
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

/** Parses the deal form into `CreateDealInput`. */
export function parseDealForm(formData: FormData): FormResult<CreateDealInput> {
  const read = new FieldReader(formData)

  const accountId = readText(formData, 'accountId')
  if (accountId === null || !UUID_PATTERN.test(accountId)) {
    read.errorFor('accountId', 'Choose the account this deal belongs to.')
  }

  const predecessorDealId = read.optionalUuid(
    'predecessorDealId',
    'Choose the deal this one follows from the list.',
  )
  const terms = readDealTerms(read, formData)

  // A renewal is a new deal linked to its predecessor (U13). Read from the
  // submission, so this is reported even when other fields are invalid.
  if (
    formData.get('dealType') === 'renewal' &&
    predecessorDealId === null &&
    !read.errors.predecessorDealId
  ) {
    read.errorFor('predecessorDealId', 'Choose the deal this renewal follows.')
  }

  if (Object.keys(read.errors).length > 0 || accountId === null || terms === null) {
    return { ok: false, fieldErrors: read.errors }
  }

  const { deal_type: dealType, ...rest } = terms
  const base = { ...rest, account_id: accountId }

  const value: CreateDealInput =
    dealType === 'renewal'
      ? { ...base, deal_type: 'renewal', predecessor_deal_id: predecessorDealId as DealId }
      : { ...base, deal_type: dealType, predecessor_deal_id: predecessorDealId }

  return { ok: true, value }
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
