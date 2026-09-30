import { describe, expect, it } from 'vitest'

import {
  isUuid,
  parseAccountForm,
  parseDealForm,
  parseDealUpdateForm,
  parseEvidenceForm,
  parseRenewalForm,
  toAccountFormValues,
  toDealFormValues,
} from '../../app/lib/deal-desk/forms'

/**
 * Server-side parsing of the account and deal forms (Deal Records, slice 1).
 *
 * These functions are the validation every Server Action relies on, so they
 * mirror the canonical database checks: a value the database would reject is
 * rejected here first, with a message tied to its field. They are pure, so
 * the tests need no network and no mocks.
 */

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111'
const PREDECESSOR_ID = '22222222-2222-4222-8222-222222222222'

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const VALID_DEAL = {
  accountId: ACCOUNT_ID,
  name: 'Acme renewal 2027',
  dealType: 'new_business',
  stage: 'negotiation',
  arrEur: '60000',
}

function dealErrors(fields: Record<string, string>) {
  const result = parseDealForm(form(fields))
  if (result.ok) throw new Error('expected the form to be rejected')
  return result.fieldErrors
}

function accountErrors(fields: Record<string, string>) {
  const result = parseAccountForm(form(fields))
  if (result.ok) throw new Error('expected the form to be rejected')
  return result.fieldErrors
}

describe('parseAccountForm', () => {
  it('accepts a name alone and trims it', () => {
    expect(parseAccountForm(form({ name: '  Acme GmbH  ' }))).toEqual({
      ok: true,
      value: {
        name: 'Acme GmbH',
        region: null,
        country_code: null,
        segment: null,
        industry: null,
      },
    })
  })

  it('accepts every optional field, upper-casing the country code', () => {
    const result = parseAccountForm(
      form({
        name: 'Acme GmbH',
        region: 'EMEA',
        countryCode: 'de',
        segment: 'Enterprise',
        industry: 'Manufacturing',
      }),
    )

    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Acme GmbH',
        region: 'EMEA',
        country_code: 'DE',
        segment: 'Enterprise',
        industry: 'Manufacturing',
      },
    })
  })

  it.each([
    ['missing', {}],
    ['blank', { name: '   ' }],
    ['longer than 200 characters', { name: 'a'.repeat(201) }],
  ])('rejects a name that is %s', (_label, fields) => {
    expect(accountErrors(fields)).toHaveProperty('name')
  })

  it.each(['D', 'DEU', 'D1', 'Deutschland'])(
    'rejects the country code %j',
    (countryCode) => {
      expect(accountErrors({ name: 'Acme', countryCode })).toHaveProperty(
        'countryCode',
      )
    },
  )

  it('rejects an optional text field longer than 200 characters', () => {
    expect(accountErrors({ name: 'Acme', industry: 'x'.repeat(201) })).toHaveProperty(
      'industry',
    )
  })

  it('ignores fields it does not know, including user_id', () => {
    const result = parseAccountForm(
      form({ name: 'Acme', user_id: 'someone-else', userId: 'someone-else' }),
    )

    expect(result.ok).toBe(true)
    expect(result.ok && Object.keys(result.value)).not.toContain('user_id')
  })
})

describe('parseDealForm', () => {
  it('accepts the required fields and leaves the optional ones null', () => {
    expect(parseDealForm(form(VALID_DEAL))).toEqual({
      ok: true,
      value: {
        account_id: ACCOUNT_ID,
        predecessor_deal_id: null,
        name: 'Acme renewal 2027',
        deal_type: 'new_business',
        stage: 'negotiation',
        arr_eur: 60000,
        tcv_eur: null,
        list_price_eur: null,
        discount_pct: null,
        term_months: null,
        start_date: null,
        end_date: null,
        renewal_date: null,
        notice_period_days: null,
        auto_renew: null,
      },
    })
  })

  it('accepts every optional field', () => {
    const result = parseDealForm(
      form({
        ...VALID_DEAL,
        arrEur: '60000.50',
        tcvEur: '180000',
        listPriceEur: '75000',
        discountPct: '20.5',
        termMonths: '36',
        startDate: '2026-04-01',
        endDate: '2029-03-31',
        renewalDate: '2029-03-31',
        noticePeriodDays: '90',
        autoRenew: 'yes',
      }),
    )

    expect(result.ok && result.value).toMatchObject({
      arr_eur: 60000.5,
      tcv_eur: 180000,
      list_price_eur: 75000,
      discount_pct: 20.5,
      term_months: 36,
      start_date: '2026-04-01',
      end_date: '2029-03-31',
      renewal_date: '2029-03-31',
      notice_period_days: 90,
      auto_renew: true,
    })
  })

  it.each([
    ['yes', true],
    ['no', false],
    ['', null],
  ])('reads auto-renew %j as %j (unknown is not false)', (autoRenew, expected) => {
    const result = parseDealForm(form({ ...VALID_DEAL, autoRenew }))
    expect(result.ok && result.value.auto_renew).toBe(expected)
  })

  it.each([
    ['accountId', { accountId: '' }],
    ['accountId', { accountId: 'not-a-uuid' }],
    ['name', { name: '  ' }],
    ['name', { name: 'n'.repeat(201) }],
    ['dealType', { dealType: 'upsell' }],
    ['stage', { stage: 'won' }],
    ['arrEur', { arrEur: '' }],
    ['arrEur', { arrEur: '-1' }],
    ['arrEur', { arrEur: '60,000' }],
    ['arrEur', { arrEur: '1.234' }],
    ['arrEur', { arrEur: '1e5' }],
    ['arrEur', { arrEur: '1000000000000' }],
    ['tcvEur', { tcvEur: '-5' }],
    ['listPriceEur', { listPriceEur: 'abc' }],
    ['discountPct', { discountPct: '100.01' }],
    ['discountPct', { discountPct: '-1' }],
    ['termMonths', { termMonths: '0' }],
    ['termMonths', { termMonths: '1.5' }],
    ['noticePeriodDays', { noticePeriodDays: '-1' }],
    ['startDate', { startDate: '2026-02-30' }],
    ['renewalDate', { renewalDate: '31.03.2027' }],
    ['autoRenew', { autoRenew: 'maybe' }],
  ])('rejects an invalid %s (%j)', (field, overrides) => {
    expect(dealErrors({ ...VALID_DEAL, ...overrides })).toHaveProperty(field)
  })

  it('rejects an end date before the start date', () => {
    expect(
      dealErrors({ ...VALID_DEAL, startDate: '2027-01-01', endDate: '2026-12-31' }),
    ).toHaveProperty('endDate')
  })

  it('reports every invalid field at once', () => {
    const errors = dealErrors({ accountId: '', name: '', dealType: '', stage: '', arrEur: '' })
    expect(Object.keys(errors).sort()).toEqual(
      ['accountId', 'arrEur', 'dealType', 'name', 'stage'].sort(),
    )
  })

  it('refuses the renewal type: a renewal is created from the deal it renews', () => {
    const errors = dealErrors({
      ...VALID_DEAL,
      dealType: 'renewal',
      predecessorDealId: PREDECESSOR_ID,
    })

    expect(errors.dealType).toMatch(/from the deal it renews/i)
  })

  it('reports a refused renewal together with other invalid fields', () => {
    const errors = dealErrors({ ...VALID_DEAL, dealType: 'renewal', arrEur: '-1' })

    expect(errors).toHaveProperty('dealType')
    expect(errors).toHaveProperty('arrEur')
  })

  it('never reads a predecessor, so it cannot create renewal lineage', () => {
    for (const predecessorDealId of [PREDECESSOR_ID, 'deal-1']) {
      const result = parseDealForm(
        form({ ...VALID_DEAL, dealType: 'expansion', predecessorDealId }),
      )

      expect(result.ok && result.value).toMatchObject({
        deal_type: 'expansion',
        predecessor_deal_id: null,
      })
    }
  })

  it('ignores fields it does not know, including user_id', () => {
    const result = parseDealForm(form({ ...VALID_DEAL, user_id: 'someone-else' }))

    expect(result.ok).toBe(true)
    expect(result.ok && Object.keys(result.value)).not.toContain('user_id')
  })
})

describe('parseDealUpdateForm', () => {
  const VALID_UPDATE = {
    name: 'Acme 2027',
    dealType: 'expansion',
    stage: 'contracting',
    arrEur: '75000.50',
  }

  it('reads the editable fields and never the account or predecessor', () => {
    const result = parseDealUpdateForm(
      form({
        ...VALID_UPDATE,
        accountId: ACCOUNT_ID,
        predecessorDealId: PREDECESSOR_ID,
        user_id: 'someone-else',
      }),
      { hasPredecessor: false },
    )

    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Acme 2027',
        deal_type: 'expansion',
        stage: 'contracting',
        arr_eur: 75000.5,
        tcv_eur: null,
        list_price_eur: null,
        discount_pct: null,
        term_months: null,
        start_date: null,
        end_date: null,
        renewal_date: null,
        notice_period_days: null,
        auto_renew: null,
      },
    })
  })

  it('applies the same field rules as creating a deal', () => {
    const result = parseDealUpdateForm(
      form({ ...VALID_UPDATE, arrEur: '-1', discountPct: '101', stage: 'won' }),
      { hasPredecessor: false },
    )

    expect(result.ok).toBe(false)
    expect(!result.ok && Object.keys(result.fieldErrors).sort()).toEqual(
      ['arrEur', 'discountPct', 'stage'].sort(),
    )
  })

  it('refuses to make a deal without a predecessor a renewal', () => {
    const result = parseDealUpdateForm(form({ ...VALID_UPDATE, dealType: 'renewal' }), {
      hasPredecessor: false,
    })

    expect(!result.ok && result.fieldErrors).toHaveProperty('dealType')
  })

  it('lets a deal that has a predecessor stay a renewal', () => {
    const result = parseDealUpdateForm(form({ ...VALID_UPDATE, dealType: 'renewal' }), {
      hasPredecessor: true,
    })

    expect(result.ok && result.value.deal_type).toBe('renewal')
  })
})

describe('parseRenewalForm', () => {
  const VALID_RENEWAL = { name: 'Acme 2028', stage: 'discovery', arrEur: '66000' }

  it('reads the terms as a renewal, never the submitted type, account or predecessor', () => {
    const result = parseRenewalForm(
      form({
        ...VALID_RENEWAL,
        renewalDate: '2028-03-31',
        dealType: 'new_business',
        accountId: ACCOUNT_ID,
        predecessorDealId: PREDECESSOR_ID,
        user_id: 'someone-else',
      }),
    )

    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Acme 2028',
        deal_type: 'renewal',
        stage: 'discovery',
        arr_eur: 66000,
        tcv_eur: null,
        list_price_eur: null,
        discount_pct: null,
        term_months: null,
        start_date: null,
        end_date: null,
        renewal_date: '2028-03-31',
        notice_period_days: null,
        auto_renew: null,
      },
    })
  })

  it('does not ask for a deal type', () => {
    const result = parseRenewalForm(form(VALID_RENEWAL))

    expect(result.ok).toBe(true)
  })

  it('applies the same field rules as creating a deal', () => {
    const result = parseRenewalForm(
      form({ ...VALID_RENEWAL, name: '', arrEur: '-1', stage: 'won' }),
    )

    expect(result.ok).toBe(false)
    expect(!result.ok && Object.keys(result.fieldErrors).sort()).toEqual(
      ['arrEur', 'name', 'stage'].sort(),
    )
  })
})

describe('parseEvidenceForm', () => {
  const VALID_EVIDENCE = {
    evidenceType: 'order_form',
    title: ' Order form 2027 ',
    bodyText: '  Term: 12 months.\r\n\r\nFees: EUR 60,000.  ',
  }

  it('accepts the required fields, keeps the body exactly as pasted and leaves provenance unset', () => {
    expect(parseEvidenceForm(form(VALID_EVIDENCE))).toEqual({
      ok: true,
      value: {
        evidence_type: 'order_form',
        title: 'Order form 2027',
        body_text: '  Term: 12 months.\r\n\r\nFees: EUR 60,000.  ',
        author: null,
        version_label: null,
        document_date: null,
        is_executed: false,
      },
    })
  })

  it('reads the provenance fields', () => {
    const result = parseEvidenceForm(
      form({
        ...VALID_EVIDENCE,
        author: ' Jane Buyer ',
        versionLabel: 'v2',
        documentDate: '2027-01-15',
        isExecuted: 'yes',
      }),
    )

    expect(result.ok && result.value).toMatchObject({
      author: 'Jane Buyer',
      version_label: 'v2',
      document_date: '2027-01-15',
      is_executed: true,
    })
  })

  it('reports every invalid field at once', () => {
    const result = parseEvidenceForm(
      form({
        evidenceType: 'contract',
        title: '  ',
        bodyText: ' \r\n\t ',
        documentDate: '2027-02-30',
        isExecuted: 'maybe',
      }),
    )

    expect(!result.ok && Object.keys(result.fieldErrors).sort()).toEqual(
      ['bodyText', 'documentDate', 'evidenceType', 'isExecuted', 'title'].sort(),
    )
  })

  it('caps the title at 300 characters and the text at 100,000', () => {
    const result = parseEvidenceForm(
      form({ ...VALID_EVIDENCE, title: 'x'.repeat(301), bodyText: 'y'.repeat(100_001) }),
    )

    expect(!result.ok && result.fieldErrors).toMatchObject({
      title: expect.stringMatching(/300 characters/),
      bodyText: expect.stringMatching(/100,000 characters/),
    })
    expect(parseEvidenceForm(form({ ...VALID_EVIDENCE, title: 'x'.repeat(300) })).ok).toBe(true)
  })

  it('caps the text at 500 paragraphs, however short they are', () => {
    const paragraphs = (count: number) => Array(count).fill('p').join('\r\n\r\n')

    const result = parseEvidenceForm(form({ ...VALID_EVIDENCE, bodyText: paragraphs(501) }))

    expect(!result.ok && result.fieldErrors.bodyText).toMatch(/500 paragraphs/)
    expect(parseEvidenceForm(form({ ...VALID_EVIDENCE, bodyText: paragraphs(500) })).ok).toBe(true)
  })

  it('never reads the deal, the owner or the source kind from the form', () => {
    const result = parseEvidenceForm(
      form({
        ...VALID_EVIDENCE,
        dealId: ACCOUNT_ID,
        deal_id: ACCOUNT_ID,
        user_id: 'someone-else',
        source_kind: 'uploaded',
        supersedes_evidence_id: PREDECESSOR_ID,
      }),
    )

    expect(result.ok).toBe(true)
    for (const key of ['deal_id', 'user_id', 'source_kind', 'supersedes_evidence_id']) {
      expect(result.ok && result.value).not.toHaveProperty(key)
    }
  })
})

describe('isUuid', () => {
  it.each([
    [ACCOUNT_ID, true],
    ['not-a-uuid', false],
    ['', false],
    [null, false],
  ])('%j → %j', (value, expected) => {
    expect(isUuid(value)).toBe(expected)
  })
})

describe('form values from stored records', () => {
  it('turns a deal into the edit form values, round-tripping through the parser', () => {
    const values = toDealFormValues({
      id: 'd',
      account_id: ACCOUNT_ID,
      predecessor_deal_id: null,
      name: 'Acme 2027',
      deal_type: 'new_business',
      stage: 'negotiation',
      arr_eur: 60000,
      tcv_eur: null,
      list_price_eur: 75000,
      discount_pct: 20,
      term_months: 12,
      start_date: '2026-01-01',
      end_date: null,
      renewal_date: '2027-03-31',
      notice_period_days: null,
      auto_renew: false,
      created_at: '',
      updated_at: '',
    })

    expect(values).toMatchObject({
      arrEur: '60000',
      tcvEur: '',
      listPriceEur: '75000',
      discountPct: '20',
      termMonths: '12',
      endDate: '',
      renewalDate: '2027-03-31',
      autoRenew: 'no',
    })
    expect(parseDealUpdateForm(form(values), { hasPredecessor: false }).ok).toBe(true)
  })

  it('turns an account into the edit form values', () => {
    expect(
      toAccountFormValues({
        id: 'a',
        name: 'Acme GmbH',
        region: null,
        country_code: 'DE',
        segment: 'Enterprise',
        industry: null,
        created_at: '',
        updated_at: '',
      }),
    ).toEqual({
      name: 'Acme GmbH',
      region: '',
      countryCode: 'DE',
      segment: 'Enterprise',
      industry: '',
    })
  })
})
