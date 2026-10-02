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

/** The main column of a workspace page: forms and single records. */
export const PAGE_CLASS =
  'mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-8 md:px-8 md:py-10'

/** The wider frame for pages built around tables and lists. */
export const WIDE_PAGE_CLASS =
  'mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-8 md:px-8 md:py-10'

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

/**
 * A data table inside a CARD_CLASS panel. The panel scrolls sideways
 * (`overflow-x-auto`) rather than the page when the table needs more room.
 */
export const TABLE_CLASS = 'w-full text-left text-[14px]'
export const TABLE_HEAD_CLASS =
  'border-b border-border bg-workspace/60 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted'
export const TABLE_HEADER_CELL_CLASS = 'px-4 py-3'
export const TABLE_ROW_CLASS =
  'border-b border-border transition-colors last:border-b-0 hover:bg-workspace/50'
export const TABLE_CELL_CLASS = 'px-4 py-3'

/** The panel shown in place of a list that has nothing in it yet. */
export const EMPTY_STATE_CLASS =
  'rounded-[var(--radius-card)] border border-dashed border-border-strong bg-pane px-6 py-10 text-center'

/** A small status label. Combine with exactly one BADGE_TONE. */
export const BADGE_CLASS =
  'inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] font-semibold leading-5 whitespace-nowrap'

export const BADGE_TONE = {
  neutral: 'border-border-strong bg-workspace text-foreground',
  primary: 'border-selected-border bg-selected text-primary',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-red-200 bg-red-50 text-danger',
} as const

/** A navigation link in the workspace shell, and its current-page state. */
export const NAV_ITEM_CLASS =
  'relative flex shrink-0 items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2 text-[14px] font-medium text-foreground/80 transition-colors hover:bg-nav-hover hover:text-foreground'
export const NAV_ITEM_ACTIVE_CLASS =
  'bg-nav-active font-semibold text-primary hover:bg-nav-active hover:text-primary'
