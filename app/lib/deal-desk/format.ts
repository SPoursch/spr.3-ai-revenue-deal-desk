import type {
  DealStage,
  DealType,
  EvidenceType,
  ProvisionType,
  ProvisionValueUnit,
} from './domain'

/**
 * Display helpers for Deal Records.
 *
 * Money is EUR only (U11). Dates are stored as ISO `YYYY-MM-DD` strings with
 * no time of day, so they are formatted in UTC: formatting them in the
 * server's time zone could show the previous day. A missing value reads
 * "Not set" rather than a blank, so "unknown" never looks like zero or "no".
 */

export const NOT_SET = 'Not set'

export const DEAL_TYPE_LABELS: Record<DealType, string> = {
  new_business: 'New business',
  renewal: 'Renewal',
  expansion: 'Expansion',
  amendment: 'Amendment',
}

export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  discovery: 'Discovery',
  negotiation: 'Negotiation',
  contracting: 'Contracting',
  closed: 'Closed',
}

export const EVIDENCE_TYPE_LABELS: Record<EvidenceType, string> = {
  msa: 'Master agreement (MSA)',
  order_form: 'Order form',
  amendment: 'Amendment',
  dpa: 'Data processing agreement (DPA)',
  email: 'Email',
  call_note: 'Call note',
  pricing_record: 'Pricing record',
  security_questionnaire: 'Security questionnaire',
  other: 'Other',
}

export const PROVISION_TYPE_LABELS: Record<ProvisionType, string> = {
  liability_cap: 'Liability cap',
  data_residency: 'Data residency',
  payment_terms: 'Payment terms',
  auto_renewal: 'Auto-renewal',
  termination: 'Termination',
  discount: 'Discount',
  governing_law: 'Governing law',
}

/** How the provision form names each unit a number may use. */
export const PROVISION_UNIT_LABELS: Record<ProvisionValueUnit, string> = {
  months_of_fees: 'Months of fees',
  eur: 'EUR',
  days: 'Days',
  percent: 'Percent',
  region: 'Region',
}

const EUR = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' })
const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const DECIMAL = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 })

export function formatEur(value: number | null): string {
  return value === null ? NOT_SET : EUR.format(value)
}

export function formatDate(value: string | null): string {
  return value === null ? NOT_SET : DATE.format(new Date(`${value}T00:00:00Z`))
}

export function formatPercent(value: number | null): string {
  return value === null ? NOT_SET : `${DECIMAL.format(value)}%`
}

/**
 * A count with its unit, singular for exactly one: "1 month", "36 months".
 * `unit` is the singular form; the plural adds an "s".
 */
export function formatNumber(value: number | null, unit: string): string {
  if (value === null) return NOT_SET
  return `${DECIMAL.format(value)} ${value === 1 ? unit : `${unit}s`}`
}

/** A provision's number with its unit: "12 months of fees", "€50,000.00", "45 days", "10%". */
export function formatProvisionAmount(
  value: number | null,
  unit: ProvisionValueUnit | null,
): string {
  if (value === null || unit === null) return NOT_SET
  switch (unit) {
    case 'months_of_fees':
      return `${formatNumber(value, 'month')} of fees`
    case 'eur':
      return formatEur(value)
    case 'days':
      return formatNumber(value, 'day')
    case 'percent':
      return formatPercent(value)
    case 'region':
      return DECIMAL.format(value)
  }
}

/** Three-state: unknown is not the same as "No". */
export function formatBoolean(value: boolean | null): string {
  if (value === null) return NOT_SET
  return value ? 'Yes' : 'No'
}
