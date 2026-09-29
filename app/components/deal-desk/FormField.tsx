import type { ReactNode } from 'react'

import { FIELD_ERROR_CLASS, LABEL_CLASS } from './styles'

/**
 * A labelled form control with its validation message.
 *
 * The control is passed as a render function so it receives the id, the
 * error state and the `aria-describedby` link, which is what lets a screen
 * reader announce the message with the field.
 */
export function FormField({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string
  label: string
  error?: string
  hint?: string
  children: (props: {
    id: string
    'aria-invalid': boolean
    'aria-describedby': string | undefined
  }) => ReactNode
}) {
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const describedBy = [error ? errorId : null, hint ? hintId : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      {children({
        id,
        'aria-invalid': Boolean(error),
        'aria-describedby': describedBy || undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className={FIELD_ERROR_CLASS}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
