import { describe, expect, it } from 'vitest'

import { splitIntoParagraphs } from '../../app/lib/deal-desk/excerpts'

/**
 * Paragraph excerpts (Slice 4). The splitter decides what every citation
 * points at, so it must be deterministic and faithful: each excerpt's content
 * is exactly `body.slice(start_offset, end_offset)`.
 */

function expectFaithful(body: string) {
  const excerpts = splitIntoParagraphs(body)

  for (const [index, excerpt] of excerpts.entries()) {
    expect(excerpt.ordinal).toBe(index)
    expect(excerpt.content.length).toBeGreaterThan(0)
    expect(excerpt.content).toBe(excerpt.content.trim())
    expect(body.slice(excerpt.start_offset, excerpt.end_offset)).toBe(excerpt.content)
    if (index > 0) {
      expect(excerpt.start_offset).toBeGreaterThan(excerpts[index - 1].end_offset)
    }
  }

  return excerpts
}

describe('splitIntoParagraphs', () => {
  it('splits on blank lines, in body order', () => {
    const body = 'First paragraph.\n\nSecond paragraph.\n\nThird.'

    expect(expectFaithful(body)).toEqual([
      { ordinal: 0, start_offset: 0, end_offset: 16, content: 'First paragraph.' },
      { ordinal: 1, start_offset: 18, end_offset: 35, content: 'Second paragraph.' },
      { ordinal: 2, start_offset: 37, end_offset: 43, content: 'Third.' },
    ])
  })

  it('keeps a single line break inside its paragraph', () => {
    const body = 'Line one\nline two.\n\nNext.'

    expect(expectFaithful(body).map((e) => e.content)).toEqual(['Line one\nline two.', 'Next.'])
  })

  it('handles CRLF line endings, keeping them inside a paragraph', () => {
    const body = 'Term: 12 months,\r\nrenewing yearly.\r\n\r\nFees: EUR 60,000.\r\n'

    expect(expectFaithful(body).map((e) => e.content)).toEqual([
      'Term: 12 months,\r\nrenewing yearly.',
      'Fees: EUR 60,000.',
    ])
  })

  it('treats whitespace-only lines as blank and never yields an empty excerpt', () => {
    const body = 'A.\n   \n\t\n\n\nB.\r\n \r\n\r\nC.'

    expect(expectFaithful(body).map((e) => e.content)).toEqual(['A.', 'B.', 'C.'])
  })

  it('leaves surrounding whitespace out of the excerpt but inside the body offsets', () => {
    const body = '  \n\n   Indented start.  \n\n  Trailing end.   \n\n  '

    expect(expectFaithful(body)).toEqual([
      { ordinal: 0, start_offset: 7, end_offset: 22, content: 'Indented start.' },
      { ordinal: 1, start_offset: 28, end_offset: 41, content: 'Trailing end.' },
    ])
  })

  it('turns a single-paragraph body into exactly one excerpt', () => {
    expect(expectFaithful('Only one paragraph, on one line.')).toEqual([
      {
        ordinal: 0,
        start_offset: 0,
        end_offset: 32,
        content: 'Only one paragraph, on one line.',
      },
    ])
  })

  it('returns no excerpts for a body with no text', () => {
    expect(splitIntoParagraphs('')).toEqual([])
    expect(splitIntoParagraphs(' \r\n\n\t ')).toEqual([])
  })

  it('is deterministic', () => {
    const body = 'One.\n\nTwo.\r\n\r\n  Three.  '

    expect(splitIntoParagraphs(body)).toEqual(splitIntoParagraphs(body))
  })
})
