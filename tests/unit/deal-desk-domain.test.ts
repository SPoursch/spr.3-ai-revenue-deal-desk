import { describe, expect, it } from 'vitest'

import {
  DEAL_STAGES,
  DEAL_TYPES,
  EVIDENCE_MIME_TYPES,
  EVIDENCE_SOURCE_KINDS,
  EVIDENCE_TYPES,
  isDealStage,
  isDealType,
  isEvidenceMimeType,
  isEvidenceSourceKind,
  isEvidenceType,
} from '../../app/lib/deal-desk/domain'

/**
 * The vocabularies mirror the check constraints on `public.deals` in the
 * canonical M3 migration (deals_deal_type_check, deals_stage_check). The
 * expected lists are spelled out here, not derived from the constants, so a
 * change to either side has to be made deliberately.
 */
describe('deal vocabulary', () => {
  it('lists exactly the deal types the database accepts', () => {
    expect([...DEAL_TYPES]).toEqual([
      'new_business',
      'renewal',
      'expansion',
      'amendment',
    ])
  })

  it('lists exactly the deal stages the database accepts', () => {
    expect([...DEAL_STAGES]).toEqual([
      'discovery',
      'negotiation',
      'contracting',
      'closed',
    ])
  })

  it.each(DEAL_TYPES)('accepts the deal type %s', (value) => {
    expect(isDealType(value)).toBe(true)
  })

  it.each(DEAL_STAGES)('accepts the deal stage %s', (value) => {
    expect(isDealStage(value)).toBe(true)
  })

  it.each([
    'Renewal',
    ' renewal',
    'renewal ',
    'new business',
    'discovery',
    '',
    null,
    undefined,
    1,
    {},
  ])('rejects %j as a deal type', (value) => {
    expect(isDealType(value)).toBe(false)
  })

  it.each([
    'Closed',
    ' closed',
    'closed_won',
    'renewal',
    '',
    null,
    undefined,
    0,
    [],
  ])('rejects %j as a deal stage', (value) => {
    expect(isDealStage(value)).toBe(false)
  })
})

/**
 * The evidence vocabularies mirror evidence_items_evidence_type_check,
 * evidence_items_source_kind_check and evidence_items_mime_type_check in the
 * canonical M3 migration, spelled out for the same reason as above.
 */
describe('evidence vocabulary', () => {
  it('lists exactly the evidence types the database accepts', () => {
    expect([...EVIDENCE_TYPES]).toEqual([
      'msa',
      'order_form',
      'amendment',
      'dpa',
      'email',
      'call_note',
      'pricing_record',
      'security_questionnaire',
      'other',
    ])
  })

  it('lists exactly the source kinds the database accepts', () => {
    expect([...EVIDENCE_SOURCE_KINDS]).toEqual(['pasted', 'uploaded'])
  })

  it('lists exactly the mime types the database accepts', () => {
    expect([...EVIDENCE_MIME_TYPES]).toEqual(['text/plain', 'text/markdown'])
  })

  it.each(EVIDENCE_TYPES)('accepts the evidence type %s', (value) => {
    expect(isEvidenceType(value)).toBe(true)
  })

  it.each(EVIDENCE_SOURCE_KINDS)('accepts the source kind %s', (value) => {
    expect(isEvidenceSourceKind(value)).toBe(true)
  })

  it.each(EVIDENCE_MIME_TYPES)('accepts the mime type %s', (value) => {
    expect(isEvidenceMimeType(value)).toBe(true)
  })

  it.each(['MSA', ' msa', 'contract', 'order form', '', null, undefined, 3])(
    'rejects %j as an evidence type',
    (value) => {
      expect(isEvidenceType(value)).toBe(false)
    },
  )

  it.each(['Pasted', 'upload', 'file', '', null, undefined, true])(
    'rejects %j as a source kind',
    (value) => {
      expect(isEvidenceSourceKind(value)).toBe(false)
    },
  )

  it.each(['application/pdf', 'text/html', 'TEXT/PLAIN', '', null, undefined])(
    'rejects %j as a mime type',
    (value) => {
      expect(isEvidenceMimeType(value)).toBe(false)
    },
  )
})
