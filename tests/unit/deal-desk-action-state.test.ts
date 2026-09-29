import { describe, expect, it } from 'vitest'

import {
  failure,
  formValues,
  initialDealDeskActionState,
} from '../../app/lib/actions/deal-desk-action-state'

/**
 * `formValues` decides what a Deal Records form shows: what the user typed
 * after a failed submission, otherwise the record's current values when
 * editing (review finding R-L1: an edit form must not come back empty when a
 * result carries no values, e.g. after the session expired).
 */

const RECORD = { name: 'Acme 2027', arrEur: '60000' }

describe('formValues', () => {
  it("shows the record's values before anything was submitted", () => {
    expect(formValues(initialDealDeskActionState, RECORD)).toEqual(RECORD)
  })

  it('shows what the user typed after a failed submission', () => {
    const typed = { name: 'Acme 2028', arrEur: '-1' }

    expect(formValues(failure('Check the fields.', { arrEur: 'x' }, typed), RECORD)).toEqual(
      typed,
    )
  })

  it("falls back to the record's values when the result carries none (signed out)", () => {
    expect(formValues(failure('You need to be signed in.'), RECORD)).toEqual(RECORD)
  })

  it('shows nothing extra on a create form', () => {
    expect(formValues(failure('You need to be signed in.'))).toEqual({})
    expect(formValues(failure('x', {}, { name: 'typed' }))).toEqual({ name: 'typed' })
  })
})
