import { describe, expect, it } from 'vitest'

import {
  AI_FINDING_STATUSES,
  AI_FINDING_TYPES,
  DEAL_STAGES,
  DEAL_TYPES,
  DECISION_TYPES,
  EVIDENCE_MIME_TYPES,
  EVIDENCE_SOURCE_KINDS,
  EVIDENCE_TYPES,
  EXCEPTION_KINDS,
  EXCEPTION_ORIGINS,
  EXCEPTION_REVIEW_STATUSES,
  EXCEPTION_SEVERITIES,
  EXCEPTION_STATUSES,
  isAiFindingStatus,
  isAiFindingType,
  isDealStage,
  isDealType,
  isDecisionType,
  isEvidenceMimeType,
  isEvidenceSourceKind,
  isEvidenceType,
  isExceptionKind,
  isExceptionOrigin,
  isExceptionReviewStatus,
  isExceptionSeverity,
  isExceptionStatus,
  isProvisionSource,
  isProvisionType,
  isProvisionValueUnit,
  PROVISION_SOURCES,
  PROVISION_TYPES,
  PROVISION_VALUE_UNITS,
  validateDecisionInput,
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

/**
 * The AI finding vocabularies mirror ai_findings_finding_type_check and
 * ai_findings_status_check in the canonical M3 migration.
 */
describe('AI finding vocabulary', () => {
  it('lists exactly the finding types the database accepts', () => {
    expect([...AI_FINDING_TYPES]).toEqual([
      'provision_candidate',
      'exception_proposal',
      'risk_explanation',
      'deal_summary',
      'answer',
    ])
  })

  it('lists exactly the finding statuses the database accepts', () => {
    expect([...AI_FINDING_STATUSES]).toEqual([
      'proposed',
      'accepted',
      'rejected',
      'superseded',
    ])
  })

  it.each(AI_FINDING_TYPES)('accepts the finding type %s', (value) => {
    expect(isAiFindingType(value)).toBe(true)
  })

  it.each(AI_FINDING_STATUSES)('accepts the finding status %s', (value) => {
    expect(isAiFindingStatus(value)).toBe(true)
  })

  it.each(['decision', 'summary', 'Answer', '', null, undefined, 1])(
    'rejects %j as a finding type',
    (value) => {
      expect(isAiFindingType(value)).toBe(false)
    },
  )

  it.each(['approved', 'decided', 'open', 'Proposed', '', null, undefined])(
    'rejects %j as a finding status',
    (value) => {
      expect(isAiFindingStatus(value)).toBe(false)
    },
  )
})

/**
 * The exception vocabularies mirror exceptions_kind_check,
 * exceptions_severity_check, exceptions_origin_check and
 * exceptions_status_check in the canonical M3 migration.
 */
describe('exception vocabulary', () => {
  it('lists exactly the kinds the database accepts', () => {
    expect([...EXCEPTION_KINDS]).toEqual([
      'non_standard_provision',
      'threshold_breach',
      'missing_evidence',
      'conflicting_evidence',
      'timing_risk',
      'commercial_risk',
    ])
  })

  it('lists exactly the severities the database accepts', () => {
    expect([...EXCEPTION_SEVERITIES]).toEqual(['low', 'medium', 'high'])
  })

  it('lists exactly the origins the database accepts', () => {
    expect([...EXCEPTION_ORIGINS]).toEqual(['deterministic', 'ai'])
  })

  it('lists exactly the statuses the database accepts', () => {
    expect([...EXCEPTION_STATUSES]).toEqual([
      'open',
      'under_review',
      'decided',
      'dismissed',
    ])
  })

  it('reserves decided and dismissed for Decisions: review statuses are open and under_review only', () => {
    expect([...EXCEPTION_REVIEW_STATUSES]).toEqual(['open', 'under_review'])
  })

  it.each(EXCEPTION_KINDS)('accepts the kind %s', (value) => {
    expect(isExceptionKind(value)).toBe(true)
  })

  it.each(EXCEPTION_SEVERITIES)('accepts the severity %s', (value) => {
    expect(isExceptionSeverity(value)).toBe(true)
  })

  it.each(EXCEPTION_ORIGINS)('accepts the origin %s', (value) => {
    expect(isExceptionOrigin(value)).toBe(true)
  })

  it.each(EXCEPTION_STATUSES)('accepts the status %s', (value) => {
    expect(isExceptionStatus(value)).toBe(true)
  })

  it.each(EXCEPTION_REVIEW_STATUSES)('accepts the review status %s', (value) => {
    expect(isExceptionReviewStatus(value)).toBe(true)
  })

  it.each(['decided', 'dismissed', 'closed', 'Open', '', null, undefined])(
    'rejects %j as a review status',
    (value) => {
      expect(isExceptionReviewStatus(value)).toBe(false)
    },
  )

  it.each(['risk', 'threshold', 'Timing_Risk', '', null, undefined])(
    'rejects %j as a kind',
    (value) => {
      expect(isExceptionKind(value)).toBe(false)
    },
  )

  it.each(['critical', 'HIGH', 'med', '', null, undefined, 3])(
    'rejects %j as a severity',
    (value) => {
      expect(isExceptionSeverity(value)).toBe(false)
    },
  )

  it.each(['human', 'rule', 'AI', '', null, undefined])(
    'rejects %j as an origin',
    (value) => {
      expect(isExceptionOrigin(value)).toBe(false)
    },
  )

  it.each(['closed', 'resolved', 'Open', '', null, undefined])(
    'rejects %j as a status',
    (value) => {
      expect(isExceptionStatus(value)).toBe(false)
    },
  )
})

describe('decision vocabulary', () => {
  it('lists exactly the decision types the database accepts', () => {
    expect([...DECISION_TYPES]).toEqual([
      'approve',
      'reject',
      'approve_with_conditions',
      'accept_risk',
      'request_change',
      'dismiss_false_positive',
    ])
  })

  it.each(DECISION_TYPES)('accepts the decision type %s', (value) => {
    expect(isDecisionType(value)).toBe(true)
  })

  it.each(['escalate', 'Approve', 'approved', 'dismiss', '', null, undefined, 1])(
    'rejects %j as a decision type',
    (value) => {
      expect(isDecisionType(value)).toBe(false)
    },
  )
})

describe('validateDecisionInput', () => {
  const DEAL_ID = '3f0c6a52-1d2e-4a8b-9c3d-5e6f7a8b9c0d'
  const EXCEPTION_ID = '7b1d2c3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e'
  const FINDING_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

  const valid = {
    deal_id: DEAL_ID,
    exception_id: EXCEPTION_ID,
    decision_type: 'accept_risk',
    rationale: 'The customer is strategic; legal has reviewed the cap.',
  }

  function problemFields(input: Parameters<typeof validateDecisionInput>[0]) {
    const result = validateDecisionInput(input)
    return result.ok ? [] : result.problems.map((problem) => problem.field)
  }

  it('accepts a complete Decision and trims its text', () => {
    expect(
      validateDecisionInput({
        ...valid,
        rationale: '  Strategic customer.  ',
        considered_finding_id: ` ${FINDING_ID} `,
      }),
    ).toEqual({
      ok: true,
      value: {
        deal_id: DEAL_ID,
        exception_id: EXCEPTION_ID,
        decision_type: 'accept_risk',
        rationale: 'Strategic customer.',
        conditions: null,
        considered_finding_id: FINDING_ID,
      },
    })
  })

  it('treats blank optional fields as absent', () => {
    const result = validateDecisionInput({
      ...valid,
      conditions: '   ',
      considered_finding_id: '',
    })

    expect(result.ok && result.value).toMatchObject({
      conditions: null,
      considered_finding_id: null,
    })
  })

  it('drops fields it does not know, such as an owner, id or timestamp', () => {
    const result = validateDecisionInput({
      ...valid,
      user_id: FINDING_ID,
      id: FINDING_ID,
      created_at: '2000-01-01T00:00:00Z',
    } as Parameters<typeof validateDecisionInput>[0])

    expect(result.ok && Object.keys(result.value).sort()).toEqual([
      'conditions',
      'considered_finding_id',
      'deal_id',
      'decision_type',
      'exception_id',
      'rationale',
    ])
  })

  it.each(['', '   ', '\n\t', null, undefined, 42])(
    'rejects %j as a rationale',
    (rationale) => {
      expect(problemFields({ ...valid, rationale })).toEqual(['rationale'])
    },
  )

  it.each(['escalate', 'APPROVE', '', null, undefined])(
    'rejects %j as a decision type',
    (decisionType) => {
      expect(problemFields({ ...valid, decision_type: decisionType })).toEqual([
        'decision_type',
      ])
    },
  )

  it('requires conditions for approve_with_conditions', () => {
    const input = { ...valid, decision_type: 'approve_with_conditions' }

    expect(problemFields(input)).toEqual(['conditions'])
    expect(problemFields({ ...input, conditions: '  ' })).toEqual(['conditions'])
    expect(
      validateDecisionInput({ ...input, conditions: ' Net 60 at most. ' }),
    ).toMatchObject({ ok: true, value: { conditions: 'Net 60 at most.' } })
  })

  it.each(['approve', 'reject', 'accept_risk', 'request_change', 'dismiss_false_positive'])(
    'refuses conditions on %s',
    (decisionType) => {
      expect(
        problemFields({ ...valid, decision_type: decisionType, conditions: 'Net 60.' }),
      ).toEqual(['conditions'])
    },
  )

  it.each([
    ['deal_id', ''],
    ['deal_id', 'not-a-uuid'],
    ['deal_id', undefined],
    ['exception_id', ''],
    ['exception_id', '123'],
    ['exception_id', null],
    ['considered_finding_id', 'finding-1'],
  ] as const)('rejects %s = %j', (field, value) => {
    expect(problemFields({ ...valid, [field]: value })).toEqual([field])
  })

  it('reports every problem at once, each with a message', () => {
    const result = validateDecisionInput({})

    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.problems.map((p) => p.field)).toEqual([
      'deal_id',
      'exception_id',
      'decision_type',
      'rationale',
    ])
    expect(
      result.ok ? [] : result.problems.every((p) => p.message.length > 0),
    ).toBe(true)
  })
})
