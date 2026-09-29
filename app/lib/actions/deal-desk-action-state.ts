import type { DealDeskFieldErrors } from '../deal-desk/forms'

/**
 * Result contract between the Deal Desk Server Actions and the forms that
 * drive them with `useActionState`.
 *
 * Kept out of the `'use server'` action modules for the same reason as the
 * auth forms' state: those files may only export async functions, and this is
 * a plain object and a synchronous helper (`failure`) that both sides import.
 *
 * Beyond a message, a failure carries per-field errors, so a form can show
 * each one next to its input, and the values the user submitted, so the form
 * can be re-filled rather than wiped. Neither ever carries database text.
 */

// Defined with the pure form parsing, which must not depend on this layer.
export type { DealDeskFieldErrors }

export type DealDeskActionState = {
  ok: boolean
  message: string | null
  fieldErrors: DealDeskFieldErrors
  /** What the user submitted, keyed by field name, for re-filling the form. */
  values: Record<string, string>
  /** Distinguishes consecutive results so the client can react to each one. */
  at: number
}

export const initialDealDeskActionState: DealDeskActionState = {
  ok: false,
  message: null,
  fieldErrors: {},
  values: {},
  at: 0,
}

/** Builds a failed result carrying messages safe to show a user. */
export function failure(
  message: string,
  fieldErrors: DealDeskFieldErrors = {},
  values: Record<string, string> = {},
): DealDeskActionState {
  return { ok: false, message, fieldErrors, values, at: Date.now() }
}
