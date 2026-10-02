/**
 * An account's initials in a tinted square: a visual anchor for the account
 * list and the account page, derived from the name alone (there is no logo
 * or image in the domain). Decorative: the name is always shown beside it.
 */

/** Up to two initials: the first letters of the first two words. */
function initials(name: string): string {
  const words = name.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word))
  const letters = words
    .slice(0, 2)
    .map((word) => word.match(/[\p{L}\p{N}]/u)?.[0] ?? '')
    .join('')
  return letters.toUpperCase() || '?'
}

export function AccountMark({ name, size = 'sm' }: { name: string; size?: 'sm' | 'lg' }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-selected-border bg-selected font-semibold text-primary ${
        size === 'lg' ? 'size-12 text-[16px]' : 'size-8 text-[12px]'
      }`}
    >
      {initials(name)}
    </span>
  )
}
