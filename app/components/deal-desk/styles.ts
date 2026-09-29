/**
 * Class names shared by the Deal Desk pages and components.
 *
 * The field, label, message and submit styles match the auth forms'
 * (app/components/LoginForm.tsx) so every form in the app looks the same.
 * They are repeated here rather than imported because LoginForm is a
 * `'use client'` module: a Server Component importing a value from it
 * receives a client reference, not the string.
 */
export const FIELD_CLASS =
  'w-full rounded-[var(--radius-control)] border border-border-strong bg-pane px-3.5 py-2.5 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted focus:border-ring'

export const LABEL_CLASS =
  'text-[13px] font-semibold uppercase tracking-[0.08em] text-muted'

export const ERROR_CLASS =
  'rounded-[var(--radius-control)] border border-red-200 bg-red-50 px-3.5 py-2.5 text-[14px] text-danger'

export const SUBMIT_CLASS =
  'rounded-[var(--radius-control)] bg-primary px-4 py-2.5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50'

/** The main column of a workspace page. */
export const PAGE_CLASS =
  'mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-8 md:px-8 md:py-12'

/** A panel on the workspace background. */
export const CARD_CLASS =
  'rounded-[var(--radius-card)] border border-border bg-pane'

/** A link styled as the primary button. */
export const PRIMARY_LINK_CLASS =
  'inline-flex items-center rounded-[var(--radius-control)] bg-primary px-4 py-2.5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover'

/** A link styled as a secondary button. */
export const SECONDARY_LINK_CLASS =
  'inline-flex items-center rounded-[var(--radius-control)] border border-border-strong bg-pane px-4 py-2.5 text-[15px] font-semibold text-foreground transition-colors hover:bg-selected'

/** An inline text link. */
export const TEXT_LINK_CLASS = 'font-semibold text-primary underline-offset-2 hover:underline'

/** The message shown under a field that failed validation. */
export const FIELD_ERROR_CLASS = 'text-[13px] text-danger'
