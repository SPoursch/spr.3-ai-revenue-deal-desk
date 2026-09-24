import type { PostgrestError } from '@supabase/supabase-js'

/**
 * Error thrown when Supabase reports a failure. Wrapping keeps the Postgrest
 * details available while giving callers a single error type to catch.
 */
export class NotesDatabaseError extends Error {
  readonly operation: string
  readonly table: string
  readonly cause?: PostgrestError

  constructor(operation: string, table: string, cause: PostgrestError) {
    super(`Supabase ${operation} on "${table}" failed: ${cause.message}`)
    this.name = 'NotesDatabaseError'
    this.operation = operation
    this.table = table
    this.cause = cause
  }
}
