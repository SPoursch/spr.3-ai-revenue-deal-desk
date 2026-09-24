import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Tables, TablesUpdate } from '../database.types'
import {
  isDealStage,
  isDealType,
  type CreateDealInput,
  type Deal,
  type DealId,
  type UpdateDealInput,
} from '../deal-desk/domain'
import { getSupabaseClient } from '../supabase'
import { DealDeskDatabaseError } from './errors'

/**
 * Deal Desk data access for `deals`, the atomic business object and the
 * second ownership root.
 *
 * Ownership (J1) works exactly as in accounts.ts: the database derives
 * `user_id` from `auth.uid()`, the application role cannot write it, and no
 * function here sends, accepts or returns it. Row level security makes
 * another user's deal indistinguishable from a missing one, so "not found" is
 * a `null` result.
 *
 * Integrity is the database's. It rejects — and `DealDeskDatabaseError`
 * reports as `invalid_input` — an `account_id` or `predecessor_deal_id` that
 * is not one of the caller's own rows (composite `(…, user_id)` foreign keys),
 * a renewal without a predecessor, and every check-constrained value. This
 * module does not repeat those rules; `CreateDealInput` already makes a
 * renewal without a predecessor impossible in typed code.
 *
 * Writes copy each granted column out of the input by name rather than
 * spreading it, so keys outside the input types — `user_id`, and on update
 * `account_id` and `predecessor_deal_id` — never reach the request, even from
 * an untyped caller.
 */

const DEALS_TABLE = 'deals'

/**
 * The columns every `deals` query selects: all of them except `user_id`,
 * which the application never reads. Typed as a literal so supabase-js infers
 * the row shape from it — which is why it is one string literal: a
 * concatenation would widen to `string` and lose the inference.
 */
const DEAL_COLUMNS =
  'id, account_id, predecessor_deal_id, name, deal_type, stage, arr_eur, tcv_eur, list_price_eur, discount_pct, term_months, start_date, end_date, renewal_date, notice_period_days, auto_renew, created_at, updated_at'

type DealRow = Omit<Tables<'deals'>, 'user_id'>

/** The request-scoped client, typed against the canonical schema. */
function client(): SupabaseClient<Database> {
  return getSupabaseClient()
}

/**
 * Narrows a row's vocabulary columns from the generated `string` to the
 * domain unions.
 *
 * The check constraints make any other value impossible today, so a failure
 * here means the database vocabulary changed without domain.ts following it.
 * That is surfaced as an error rather than passed on as a mistyped Deal.
 */
function toDeal(row: DealRow): Deal {
  const { deal_type, stage } = row

  if (!isDealType(deal_type) || !isDealStage(stage)) {
    throw new Error(
      `Deal ${row.id} has a deal_type or stage unknown to the domain ` +
        `vocabulary (${deal_type}, ${stage}); update app/lib/deal-desk/domain.ts.`,
    )
  }

  return { ...row, deal_type, stage }
}

/**
 * Lists the caller's deals, those renewing soonest first.
 *
 * Ordered by `renewal_date` (nulls last) because renewal timing is what the
 * Deal Desk asks about most, then by name so the order is stable.
 */
export async function listDeals(): Promise<Deal[]> {
  const { data, error } = await client()
    .from(DEALS_TABLE)
    .select(DEAL_COLUMNS)
    .order('renewal_date', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true })

  if (error) {
    throw new DealDeskDatabaseError('select', DEALS_TABLE, error)
  }

  return data.map(toDeal)
}

/** Reads one deal, or null when it does not exist or is not the caller's. */
export async function getDeal(id: DealId): Promise<Deal | null> {
  const { data, error } = await client()
    .from(DEALS_TABLE)
    .select(DEAL_COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new DealDeskDatabaseError('select single', DEALS_TABLE, error)
  }

  return data ? toDeal(data) : null
}

/**
 * Creates a deal owned by the caller and returns the stored row.
 *
 * `id`, `user_id` and both timestamps are left to their database defaults.
 * Values are passed through as given: validation belongs to the calling
 * Server Action, and the database constraints are the final authority.
 */
export async function createDeal(input: CreateDealInput): Promise<Deal> {
  const { data, error } = await client()
    .from(DEALS_TABLE)
    .insert({
      account_id: input.account_id,
      predecessor_deal_id: input.predecessor_deal_id ?? null,
      name: input.name,
      deal_type: input.deal_type,
      stage: input.stage,
      arr_eur: input.arr_eur,
      tcv_eur: input.tcv_eur ?? null,
      list_price_eur: input.list_price_eur ?? null,
      discount_pct: input.discount_pct ?? null,
      term_months: input.term_months ?? null,
      start_date: input.start_date ?? null,
      end_date: input.end_date ?? null,
      renewal_date: input.renewal_date ?? null,
      notice_period_days: input.notice_period_days ?? null,
      auto_renew: input.auto_renew ?? null,
    })
    .select(DEAL_COLUMNS)
    .single()

  if (error) {
    throw new DealDeskDatabaseError('insert', DEALS_TABLE, error)
  }

  return toDeal(data)
}

/**
 * Updates a deal and returns the stored row, or null when no row matched.
 *
 * Keys omitted from `input` are not sent, leaving those columns untouched; an
 * input with no keys at all is not an edit, so the row is returned unchanged.
 * `account_id` and `predecessor_deal_id` are never sent: the schema fixes
 * both when the deal is created. `updated_at` is maintained by the
 * deals_set_updated_at trigger.
 */
export async function updateDeal(
  id: DealId,
  input: UpdateDealInput,
): Promise<Deal | null> {
  const patch: TablesUpdate<'deals'> = {}

  if ('name' in input) patch.name = input.name
  if ('deal_type' in input) patch.deal_type = input.deal_type
  if ('stage' in input) patch.stage = input.stage
  if ('arr_eur' in input) patch.arr_eur = input.arr_eur
  if ('tcv_eur' in input) patch.tcv_eur = input.tcv_eur ?? null
  if ('list_price_eur' in input) patch.list_price_eur = input.list_price_eur ?? null
  if ('discount_pct' in input) patch.discount_pct = input.discount_pct ?? null
  if ('term_months' in input) patch.term_months = input.term_months ?? null
  if ('start_date' in input) patch.start_date = input.start_date ?? null
  if ('end_date' in input) patch.end_date = input.end_date ?? null
  if ('renewal_date' in input) patch.renewal_date = input.renewal_date ?? null
  if ('notice_period_days' in input) {
    patch.notice_period_days = input.notice_period_days ?? null
  }
  if ('auto_renew' in input) patch.auto_renew = input.auto_renew ?? null

  if (Object.keys(patch).length === 0) {
    return getDeal(id)
  }

  const { data, error } = await client()
    .from(DEALS_TABLE)
    .update(patch)
    .eq('id', id)
    .select(DEAL_COLUMNS)
    .maybeSingle()

  if (error) {
    throw new DealDeskDatabaseError('update', DEALS_TABLE, error)
  }

  return data ? toDeal(data) : null
}

/**
 * Deletes a deal and returns the removed row, or null when no row matched.
 * `.select()` is chained so the caller can tell the two apart.
 *
 * A deal that a renewal still names as its predecessor cannot be deleted on
 * its own: the foreign key would null the renewal's predecessor, which a
 * renewal may not lack. The database refuses, reported as `invalid_input`.
 * The deal's children (evidence, findings, …) are deleted with it by the
 * database.
 */
export async function deleteDeal(id: DealId): Promise<Deal | null> {
  const { data, error } = await client()
    .from(DEALS_TABLE)
    .delete()
    .eq('id', id)
    .select(DEAL_COLUMNS)
    .maybeSingle()

  if (error) {
    throw new DealDeskDatabaseError('delete', DEALS_TABLE, error)
  }

  return data ? toDeal(data) : null
}
