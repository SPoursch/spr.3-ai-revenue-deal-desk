import { describe, expect, it } from 'vitest'

import {
  parseCitationForm,
  parseProvisionForm,
  parseProvisionValueForm,
} from '../../app/lib/deal-desk/forms'

/**
 * Server-side parsing of the provision forms (Contract / Document
 * Intelligence V1): the value rules, the type → unit table, the 500-character
 * value and 20-citation limits, and that server-controlled fields are never
 * read from a form. Pure functions, so no network and no mocks.
 */

const EXCERPT_1 = '11111111-1111-4111-8111-111111111111'
const EXCERPT_2 = '22222222-2222-4222-8222-222222222222'

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item)
  }
  return data
}

/** `count` distinct uuids, for the citation limit. */
function excerptIds(count: number): string[] {
  return Array.from(
    { length: count },
    (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  )
}

function errors(result: ReturnType<typeof parseProvisionForm>) {
  if (result.ok) throw new Error('expected the form to be rejected')
  return result.fieldErrors
}

describe('parseProvisionForm', () => {
  it('accepts a trimmed value with a number in a unit the type allows', () => {
    expect(
      parseProvisionForm(
        form({
          provisionType: 'liability_cap',
          valueText: '  12 months of fees  ',
          valueNumeric: '12',
          valueUnit: 'months_of_fees',
          excerptIds: [EXCERPT_1],
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        provision_type: 'liability_cap',
        value_text: '12 months of fees',
        value_numeric: 12,
        value_unit: 'months_of_fees',
        excerpt_ids: [EXCERPT_1],
      },
    })
  })

  it('accepts a text-only type with no number and no citations', () => {
    expect(
      parseProvisionForm(form({ provisionType: 'governing_law', valueText: 'German law' })),
    ).toEqual({
      ok: true,
      value: {
        provision_type: 'governing_law',
        value_text: 'German law',
        value_numeric: null,
        value_unit: null,
        excerpt_ids: [],
      },
    })
  })

  it.each([
    ['a unit the type does not allow', { provisionType: 'discount', valueNumeric: '10', valueUnit: 'days' }, 'valueUnit'],
    ['region, which is never a number', { provisionType: 'liability_cap', valueNumeric: '1', valueUnit: 'region' }, 'valueUnit'],
    ['a number for a text-only type', { provisionType: 'governing_law', valueNumeric: '1', valueUnit: 'days' }, 'valueNumeric'],
    ['a number without its unit', { provisionType: 'payment_terms', valueNumeric: '45' }, 'valueUnit'],
    ['a unit without its number', { provisionType: 'payment_terms', valueUnit: 'days' }, 'valueNumeric'],
    ['a number that is not one', { provisionType: 'payment_terms', valueNumeric: '-45', valueUnit: 'days' }, 'valueNumeric'],
  ])('refuses %s', (_label, fields, field) => {
    expect(errors(parseProvisionForm(form({ valueText: 'A value', ...fields })))).toHaveProperty(
      field,
    )
  })

  it('caps the value at 500 characters and requires one', () => {
    const at = (valueText: string) =>
      parseProvisionForm(form({ provisionType: 'governing_law', valueText }))

    expect(at('x'.repeat(500)).ok).toBe(true)
    expect(errors(at('x'.repeat(501)))).toHaveProperty('valueText')
    expect(errors(at('   '))).toHaveProperty('valueText')
  })

  it('cites at most 20 excerpts, removing repeated ids first', () => {
    const at = (ids: string[]) =>
      parseProvisionForm(form({ provisionType: 'governing_law', valueText: 'German law', excerptIds: ids }))

    expect(at(excerptIds(20)).ok).toBe(true)
    expect(errors(at(excerptIds(21))).excerptIds).toMatch(/at most 20 excerpts/)

    const repeated = at([EXCERPT_1, EXCERPT_2, EXCERPT_1])
    expect(repeated.ok && repeated.value.excerpt_ids).toEqual([EXCERPT_1, EXCERPT_2])
    // 20 distinct ids, each submitted twice, are still 20.
    expect(at([...excerptIds(20), ...excerptIds(20)]).ok).toBe(true)
  })

  it('refuses an excerpt id that is not a uuid', () => {
    expect(
      errors(
        parseProvisionForm(
          form({ provisionType: 'governing_law', valueText: 'German law', excerptIds: ['excerpt-1'] }),
        ),
      ),
    ).toHaveProperty('excerptIds')
  })

  it('never reads the deal, owner, provenance or confirmation time from the form', () => {
    const result = parseProvisionForm(
      form({
        provisionType: 'governing_law',
        valueText: 'German law',
        dealId: EXCERPT_1,
        deal_id: EXCERPT_1,
        user_id: 'someone-else',
        source: 'ai_confirmed',
        source_finding_id: EXCERPT_2,
        confirmed_at: '2000-01-01T00:00:00Z',
      }),
    )

    expect(result.ok).toBe(true)
    expect(result.ok && Object.keys(result.value).sort()).toEqual(
      ['excerpt_ids', 'provision_type', 'value_numeric', 'value_text', 'value_unit'],
    )
  })
})

describe('parseProvisionValueForm', () => {
  it("applies the stored type's units and reads only the value fields", () => {
    expect(
      parseProvisionValueForm(
        form({
          valueText: '6 months of fees',
          valueNumeric: '6',
          valueUnit: 'months_of_fees',
          provisionType: 'discount',
          source: 'ai_confirmed',
          confirmed_at: '2000-01-01T00:00:00Z',
        }),
        'liability_cap',
      ),
    ).toEqual({
      ok: true,
      value: { value_text: '6 months of fees', value_numeric: 6, value_unit: 'months_of_fees' },
    })

    const wrongUnit = parseProvisionValueForm(
      form({ valueText: '10', valueNumeric: '10', valueUnit: 'percent' }),
      'liability_cap',
    )
    expect(!wrongUnit.ok && wrongUnit.fieldErrors).toHaveProperty('valueUnit')
  })
})

describe('parseCitationForm', () => {
  it('requires at least one excerpt and allows at most 20', () => {
    expect(parseCitationForm(form({ excerptIds: [EXCERPT_1] }))).toEqual({
      ok: true,
      value: [EXCERPT_1],
    })

    const none = parseCitationForm(form({}))
    expect(!none.ok && none.fieldErrors).toHaveProperty('excerptIds')

    const tooMany = parseCitationForm(form({ excerptIds: excerptIds(21) }))
    expect(!tooMany.ok && tooMany.fieldErrors.excerptIds).toMatch(/at most 20 excerpts/)
  })
})
