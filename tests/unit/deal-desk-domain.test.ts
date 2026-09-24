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
  isProvisionSource,
  isProvisionType,
  isProvisionValueUnit,
  PROVISION_SOURCES,
  PROVISION_TYPES,
  PROVISION_VALUE_UNITS,
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

/**
 * The provision vocabularies mirror provisions_provision_type_check,
 * provisions_value_unit_check and provisions_source_check in the canonical
 * M3 migration, spelled out for the same reason as above.
 */
describe('provision vocabulary', () => {
  it('lists exactly the provision types the database accepts', () => {
    expect([...PROVISION_TYPES]).toEqual([
      'liability_cap',
      'data_residency',
      'payment_terms',
      'auto_renewal',
      'termination',
      'discount',
      'governing_law',
    ])
  })

  it('lists exactly the value units the database accepts', () => {
    expect([...PROVISION_VALUE_UNITS]).toEqual([
      'months_of_fees',
      'eur',
      'days',
      'percent',
      'region',
    ])
  })

  it('lists exactly the sources the database accepts', () => {
    expect([...PROVISION_SOURCES]).toEqual(['human_entered', 'ai_confirmed'])
  })

  it.each(PROVISION_TYPES)('accepts the provision type %s', (value) => {
    expect(isProvisionType(value)).toBe(true)
  })

  it.each(PROVISION_VALUE_UNITS)('accepts the value unit %s', (value) => {
    expect(isProvisionValueUnit(value)).toBe(true)
  })

  it.each(PROVISION_SOURCES)('accepts the source %s', (value) => {
    expect(isProvisionSource(value)).toBe(true)
  })

  it.each(['Liability_Cap', 'liability cap', 'sla', 'msa', '', null, undefined, 7])(
    'rejects %j as a provision type',
    (value) => {
      expect(isProvisionType(value)).toBe(false)
    },
  )

  it.each(['EUR', 'months', 'percentage', '%', '', null, undefined, 0])(
    'rejects %j as a value unit',
    (value) => {
      expect(isProvisionValueUnit(value)).toBe(false)
    },
  )

  it.each(['ai', 'ai_proposed', 'human', 'Human_Entered', '', null, undefined])(
    'rejects %j as a provision source',
    (value) => {
      expect(isProvisionSource(value)).toBe(false)
    },
  )
})
