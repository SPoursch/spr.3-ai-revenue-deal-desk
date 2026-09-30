import type { DealExcerptGroup } from '@/app/lib/deal-desk/domain'

import { FIELD_ERROR_CLASS } from './styles'

/**
 * Checkboxes for choosing excerpts of a deal's evidence, one group per
 * evidence item, submitted as `excerptIds`. Rendered inside the provision and
 * add-citations forms. The Server Action decides what may actually be cited;
 * this only offers the deal's own excerpts.
 */
export function ExcerptPicker({
  groups,
  selected = [],
  error,
}: {
  groups: DealExcerptGroup[]
  selected?: string[]
  error?: string
}) {
  const withExcerpts = groups.filter((group) => group.excerpts.length > 0)

  return (
    <section aria-label="Supporting excerpts" className="flex flex-col gap-4">
      {withExcerpts.length === 0 ? (
        <p className="text-[15px] text-muted">This deal has no evidence excerpts to cite.</p>
      ) : (
        withExcerpts.map((group) => (
          <fieldset key={group.id} className="flex flex-col gap-2">
            <legend className="mb-1 text-[15px] font-semibold">{group.title}</legend>
            {group.excerpts.map((excerpt) => (
              <label key={excerpt.id} className="flex items-start gap-2 text-[14px]">
                <input
                  type="checkbox"
                  name="excerptIds"
                  value={excerpt.id}
                  defaultChecked={selected.includes(excerpt.id)}
                  className="mt-1"
                />
                <span className="line-clamp-3 whitespace-pre-wrap">
                  Excerpt {excerpt.ordinal + 1}: {excerpt.content}
                </span>
              </label>
            ))}
          </fieldset>
        ))
      )}
      {error ? <p className={FIELD_ERROR_CLASS}>{error}</p> : null}
    </section>
  )
}
