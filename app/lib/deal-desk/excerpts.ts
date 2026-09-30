import type { CreateEvidenceExcerptInput } from './domain'

/**
 * Paragraph excerpts of pasted evidence (Slice 4, decision A).
 *
 * An excerpt is one paragraph: a run of lines that contain text, bounded by
 * blank or whitespace-only lines or the ends of the body. Its content is the
 * paragraph without surrounding whitespace, and it is always exactly
 * `body.slice(start_offset, end_offset)`, so a citation can be traced back to
 * the stored text. Line breaks inside a paragraph, LF or CRLF, are kept.
 *
 * Offsets are JavaScript string indices (UTF-16 code units), the unit the
 * application reads them back in. The database stores them as given.
 *
 * Pure and deterministic: no sentence or token chunking.
 */

/** What the splitter decides for one excerpt; the item and deal are the caller's. */
export type ParagraphExcerpt = Pick<
  CreateEvidenceExcerptInput,
  'ordinal' | 'start_offset' | 'end_offset' | 'content'
>

/** Splits a body into its paragraphs, in order, with ordinals 0..n-1. */
export function splitIntoParagraphs(body: string): ParagraphExcerpt[] {
  const excerpts: ParagraphExcerpt[] = []
  let start: number | null = null
  let end = 0

  const close = () => {
    if (start === null) return
    excerpts.push({
      ordinal: excerpts.length,
      start_offset: start,
      end_offset: end,
      content: body.slice(start, end),
    })
    start = null
  }

  let lineStart = 0
  while (lineStart <= body.length) {
    const newline = body.indexOf('\n', lineStart)
    const lineEnd = newline === -1 ? body.length : newline
    const line = body.slice(lineStart, lineEnd)
    const text = line.trim()

    if (text.length === 0) {
      close()
    } else {
      // The first and last non-whitespace characters of the line.
      const first = lineStart + line.search(/\S/)
      const last = lineStart + line.trimEnd().length
      if (start === null) start = first
      end = last
    }

    if (newline === -1) break
    lineStart = newline + 1
  }

  close()
  return excerpts
}
