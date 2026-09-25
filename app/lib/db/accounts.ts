import type { TablesUpdate } from '../database.types'
import type {
  Account,
  AccountId,
  CreateAccountInput,
  UpdateAccountInput,
} from '../deal-desk/domain'
import { getSupabaseClient } from '../supabase'
import { DealDeskDatabaseError } from './errors'

/**
 * Deal Desk data access for `accounts`, one of the two ownership roots.
 *
 * Ownership (J1). The database derives it: `user_id` defaults to `auth.uid()`
 * and the application role has no INSERT or UPDATE privilege on it. So no
 * function here sends, accepts or returns `user_id`, and none needs the
 * session — unlike the NoteSpace creates, which name their owner explicitly.
 * Row level security restricts every statement to the caller's own rows; a row
 * belonging to someone else behaves exactly like one that does not exist, so
 * "not found" is a `null` result, never an error.
 *
 * Writes copy each granted column out of the input by name rather than
 * spreading it, so a key that is not in the input type — `user_id` included —
 * never reaches the request even from an untyped caller.
 *
 * Failures throw `DealDeskDatabaseError`, whose `kind` tells the caller which
 * generic message to show; the Postgres detail is for server logs only.
 */

const ACCOUNTS_TABLE = 'accounts'

/**
 * The columns every `accounts` query selects: all of them except `user_id`,
 * which the application never reads. Typed as a literal so supabase-js infers
 * the row shape from it.
 */
const ACCOUNT_COLUMNS =
  'id, name, region, country_code, segment, industry, created_at, updated_at'

/** Lists the caller's accounts alphabetically by name. */
export async function listAccounts(): Promise<Account[]> {
  const { data, error } = await getSupabaseClient()
    .from(ACCOUNTS_TABLE)
    .select(ACCOUNT_COLUMNS)
    .order('name', { ascending: true })

  if (error) {
    throw new DealDeskDatabaseError('select', ACCOUNTS_TABLE, error)
  }

  return data
}

/** Reads one account, or null when it does not exist or is not the caller's. */
export async function getAccount(id: AccountId): Promise<Account | null> {
  const { data, error } = await getSupabaseClient()
    .from(ACCOUNTS_TABLE)
    .select(ACCOUNT_COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new DealDeskDatabaseError('select single', ACCOUNTS_TABLE, error)
  }

  return data
}

/**
 * Creates an account owned by the caller and returns the stored row.
 *
 * `id`, `user_id` and both timestamps are left to their database defaults.
 * Values are passed through as given: validation belongs to the calling
 * Server Action, and the database constraints are the final authority.
 */
export async function createAccount(input: CreateAccountInput): Promise<Account> {
  const { data, error } = await getSupabaseClient()
    .from(ACCOUNTS_TABLE)
    .insert({
      name: input.name,
      region: input.region ?? null,
      country_code: input.country_code ?? null,
      segment: input.segment ?? null,
      industry: input.industry ?? null,
    })
    .select(ACCOUNT_COLUMNS)
    .single()

  if (error) {
    throw new DealDeskDatabaseError('insert', ACCOUNTS_TABLE, error)
  }

  return data
}

/**
 * Updates an account and returns the stored row, or null when no row matched.
 *
 * Keys omitted from `input` are not sent, leaving those columns untouched; an
 * input with no keys at all is not an edit, so the row is returned unchanged.
 * `updated_at` is maintained by the accounts_set_updated_at trigger.
 */
export async function updateAccount(
  id: AccountId,
  input: UpdateAccountInput,
): Promise<Account | null> {
  const patch: TablesUpdate<'accounts'> = {}

  if ('name' in input) patch.name = input.name
  if ('region' in input) patch.region = input.region ?? null
  if ('country_code' in input) patch.country_code = input.country_code ?? null
  if ('segment' in input) patch.segment = input.segment ?? null
  if ('industry' in input) patch.industry = input.industry ?? null

  if (Object.keys(patch).length === 0) {
    return getAccount(id)
  }

  const { data, error } = await getSupabaseClient()
    .from(ACCOUNTS_TABLE)
    .update(patch)
    .eq('id', id)
    .select(ACCOUNT_COLUMNS)
    .maybeSingle()

  if (error) {
    throw new DealDeskDatabaseError('update', ACCOUNTS_TABLE, error)
  }

  return data
}

/**
 * Deletes an account and returns the removed row, or null when no row
 * matched. `.select()` is chained so the caller can tell the two apart.
 *
 * The deals of the account are deleted with it, by the database: `deals`
 * references `accounts` with `on delete cascade`.
 */
export async function deleteAccount(id: AccountId): Promise<Account | null> {
  const { data, error } = await getSupabaseClient()
    .from(ACCOUNTS_TABLE)
    .delete()
    .eq('id', id)
    .select(ACCOUNT_COLUMNS)
    .maybeSingle()

  if (error) {
    throw new DealDeskDatabaseError('delete', ACCOUNTS_TABLE, error)
  }

  return data
}
