import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  createAnonymousClient,
  signInTestUser,
  signOutTestUser,
  type SignedInTestUser,
  type TestClient,
} from '../support/supabase-clients'

/**
 * Integration tests for the Feature 6 data layer (AI Deal Copilot V1),
 * against the hosted canonical database, run as real users:
 *
 * - retrieveDealExcerpts (app/lib/db/evidence.ts): the excerpts of one deal
 *   the Copilot may send. Every excerpt when the deal has no more than `cap`;
 *   otherwise a full-text OR search on `content_tsv` (english), bounded to
 *   MAX_RETRIEVAL_CANDIDATES. Excerpts of superseded evidence are never
 *   returned. Each carries its evidence title, type, date and executed flag.
 * - addAiFindingExcerpts (app/lib/db/ai-findings.ts): a finding's excerpt
 *   citations, in one insert — all or none. The composite keys keep every
 *   citation on the finding's own deal.
 * - createCopilotAnswer (app/lib/db/ai-findings.ts): one `answer` finding
 *   and its excerpt citations in one transaction (the database function
 *   create_copilot_answer) — all or nothing, so a failed citation leaves no
 *   answer behind and a retry stores exactly one.
 * - listCopilotAnswers (app/lib/db/ai-findings.ts): a deal's `answer`
 *   findings, newest first, at most 10, with their citations.
 *
 * Everything runs as the caller under row level security; only client
 * construction is replaced (J3). Test data carries RUN_PREFIX and is deleted
 * with its accounts in `afterAll`.
 */

const current = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('../../app/lib/supabase', () => ({
  getSupabaseClient: () => {
    if (!current.client) throw new Error('No test client selected: call actAs().')
    return current.client
  },
}))

// Imported after vi.mock is registered (vi.mock is hoisted above imports).
import {
  addAiFindingExcerpts,
  createAccount,
  createAiFinding,
  createCopilotAnswer,
  createDeal,
  createEvidenceExcerpts,
  createEvidenceItem,
  DealDeskDatabaseError,
  listCopilotAnswers,
  retrieveDealExcerpts,
} from '../../app/lib/db'
import { MAX_RETRIEVAL_CANDIDATES } from '../../app/lib/deal-desk/copilot'
import type { AiFinding, Deal, EvidenceExcerpt } from '../../app/lib/deal-desk/domain'

const RUN_PREFIX = `[deal-desk-test ${randomUUID().slice(0, 8)}]`
const CAP = 8

let userA: SignedInTestUser
let userB: SignedInTestUser

/** Three excerpts: fewer than the cap. */
let smallDeal: Deal
/** Twelve excerpts, four about liability, one about data residency. */
let largeDeal: Deal
/** Sixty excerpts, all about liability. */
let hugeDeal: Deal
/** An item superseded by a later one. */
let supersededDeal: Deal
/** Another deal of user A, for cross-deal citations. */
let otherDeal: Deal

const excerptsOf = new Map<string, EvidenceExcerpt[]>()

function actAs(client: TestClient) {
  current.client = client
}

function testName(label: string) {
  return `${RUN_PREFIX} ${label}`
}

async function dealOn(accountId: string, label: string): Promise<Deal> {
  return createDeal({
    account_id: accountId,
    name: testName(label),
    deal_type: 'new_business',
    stage: 'negotiation',
    arr_eur: 60000,
  })
}

/** One evidence item with one excerpt per paragraph, as the app stores them. */
async function evidence(
  deal: Deal,
  title: string,
  paragraphs: string[],
  extra: { supersedes_evidence_id?: string; document_date?: string; is_executed?: boolean } = {},
) {
  const body = paragraphs.join('\n\n')
  const item = await createEvidenceItem({
    deal_id: deal.id,
    title: testName(title),
    evidence_type: 'msa',
    body_text: body,
    author: null,
    version_label: null,
    document_date: extra.document_date ?? '2026-01-15',
    is_executed: extra.is_executed ?? true,
    supersedes_evidence_id: extra.supersedes_evidence_id ?? null,
  })
  let offset = 0
  const excerpts = await createEvidenceExcerpts(
    paragraphs.map((content, ordinal) => {
      const start = body.indexOf(content, offset)
      offset = start + content.length
      return {
        evidence_item_id: item.id,
        deal_id: deal.id,
        ordinal,
        start_offset: start,
        end_offset: start + content.length,
        section_label: null,
        content,
      }
    }),
  )
  excerptsOf.set(item.id, excerpts)
  return { item, excerpts }
}

async function answerOn(deal: Deal, question: string): Promise<AiFinding> {
  return createAiFinding({
    deal_id: deal.id,
    finding_type: 'answer',
    content: `Answer to ${question}`,
    payload: { question, status: 'answered', claims: [], facts: [] },
    model: 'openrouter/test-model',
    prompt_version: 'copilot-v1',
  })
}

let smallExcerpts: EvidenceExcerpt[]
let largeExcerpts: EvidenceExcerpt[]
let oldItemId: string
let newExcerpts: EvidenceExcerpt[]
let otherExcerpts: EvidenceExcerpt[]

beforeAll(async () => {
  userA = await signInTestUser('A')
  userB = await signInTestUser('B')

  actAs(userA.client)
  const account = await createAccount({ name: testName('copilot account') })
  smallDeal = await dealOn(account.id, 'small deal')
  largeDeal = await dealOn(account.id, 'large deal')
  hugeDeal = await dealOn(account.id, 'huge deal')
  supersededDeal = await dealOn(account.id, 'superseded deal')
  otherDeal = await dealOn(account.id, 'other deal')

  smallExcerpts = (
    await evidence(smallDeal, 'small msa', [
      'Nothing about the topic here.',
      'Payment terms are Net 30.',
      'The governing law is German law.',
    ])
  ).excerpts

  largeExcerpts = (
    await evidence(largeDeal, 'large msa', [
      'The liability cap is 12 months of fees.',
      'Introductory paragraph one.',
      'Introductory paragraph two.',
      'Liabilities of either party are limited.',
      'Introductory paragraph three.',
      'Customer data stays in the EU under the data residency clause.',
      'Introductory paragraph four.',
      'Indirect liability is excluded.',
      'Introductory paragraph five.',
      'Introductory paragraph six.',
      'The liability cap does not apply to gross negligence.',
      'Introductory paragraph seven.',
    ])
  ).excerpts

  await evidence(
    hugeDeal,
    'huge msa',
    Array.from({ length: 60 }, (_, i) => `Liability clause number ${i + 1} limits the cap.`),
  )

  const old = await evidence(supersededDeal, 'old msa', [
    'Old: the liability cap is 6 months of fees.',
    'Old: payment terms are Net 90.',
  ])
  oldItemId = old.item.id
  newExcerpts = (
    await evidence(
      supersededDeal,
      'new msa',
      ['New: the liability cap is 12 months of fees.', 'New: payment terms are Net 30.'],
      { supersedes_evidence_id: old.item.id },
    )
  ).excerpts

  otherExcerpts = (await evidence(otherDeal, 'other msa', ['The liability cap is 24 months of fees.'])).excerpts
})

afterAll(async () => {
  try {
    for (const user of [userA, userB].filter(Boolean)) {
      const { error } = await user.client.from('accounts').delete().like('name', `${RUN_PREFIX}%`)
      if (error) throw new Error(`Cleanup delete failed (${error.code}).`)
    }
  } finally {
    await Promise.all([userA, userB].filter(Boolean).map(signOutTestUser))
  }
})

describe('retrieveDealExcerpts', () => {
  it('returns every excerpt, in item and ordinal order, when the deal has no more than the cap', async () => {
    actAs(userA.client)
    const result = await retrieveDealExcerpts({ dealId: smallDeal.id, terms: ['liability'], cap: CAP })

    expect(result.mode).toBe('all')
    expect(result.excerpts.map((e) => e.id)).toEqual(smallExcerpts.map((e) => e.id))
  })

  it('carries each excerpt with its evidence title, type, document date and executed flag', async () => {
    actAs(userA.client)
    const [first] = (await retrieveDealExcerpts({ dealId: smallDeal.id, terms: [], cap: CAP })).excerpts

    expect(first).toEqual({
      id: smallExcerpts[0].id,
      deal_id: smallDeal.id,
      evidence_item_id: smallExcerpts[0].evidence_item_id,
      ordinal: 0,
      content: 'Nothing about the topic here.',
      evidence_title: testName('small msa'),
      evidence_type: 'msa',
      document_date: '2026-01-15',
      is_executed: true,
    })
  })

  it('above the cap, searches the deal by any of the terms, with english stemming', async () => {
    actAs(userA.client)
    const result = await retrieveDealExcerpts({
      dealId: largeDeal.id,
      terms: ['liabilities', 'residency'],
      cap: CAP,
    })

    expect(result.mode).toBe('search')
    expect(new Set(result.excerpts.map((e) => e.content))).toEqual(
      new Set([
        'The liability cap is 12 months of fees.',
        'Liabilities of either party are limited.',
        'Customer data stays in the EU under the data residency clause.',
        'Indirect liability is excluded.',
        'The liability cap does not apply to gross negligence.',
      ]),
    )
    expect(result.excerpts.every((e) => e.deal_id === largeDeal.id)).toBe(true)
  })

  it('above the cap, finds nothing without terms', async () => {
    actAs(userA.client)
    expect(await retrieveDealExcerpts({ dealId: largeDeal.id, terms: [], cap: CAP })).toEqual({
      mode: 'search',
      excerpts: [],
    })
  })

  it(`is bounded: a search returns at most ${MAX_RETRIEVAL_CANDIDATES} candidates`, async () => {
    expect(MAX_RETRIEVAL_CANDIDATES).toBe(40)
    actAs(userA.client)
    const result = await retrieveDealExcerpts({ dealId: hugeDeal.id, terms: ['liability'], cap: CAP })

    expect(result.mode).toBe('search')
    expect(result.excerpts).toHaveLength(MAX_RETRIEVAL_CANDIDATES)
  })

  it('never returns excerpts of superseded evidence', async () => {
    actAs(userA.client)
    for (const terms of [[], ['liability', 'payment']]) {
      const result = await retrieveDealExcerpts({ dealId: supersededDeal.id, terms, cap: CAP })

      expect(result.excerpts.map((e) => e.id)).toEqual(newExcerpts.map((e) => e.id))
      expect(result.excerpts.some((e) => e.evidence_item_id === oldItemId)).toBe(false)
    }
    // Counted after excluding superseded evidence: one excerpt over the cap
    // of one is a search, two are not.
    const searched = await retrieveDealExcerpts({ dealId: supersededDeal.id, terms: ['liability'], cap: 1 })
    expect(searched.mode).toBe('search')
    expect(searched.excerpts.map((e) => e.content)).toEqual(['New: the liability cap is 12 months of fees.'])
  })

  it("returns nothing to user B for user A's deal, in either mode", async () => {
    actAs(userB.client)
    for (const dealId of [smallDeal.id, largeDeal.id]) {
      const result = await retrieveDealExcerpts({ dealId, terms: ['liability'], cap: CAP })
      expect(result.excerpts).toEqual([])
    }
  })

  it('throws on a failed read rather than returning no evidence', async () => {
    actAs(userA.client)
    const error = await retrieveDealExcerpts({ dealId: 'not-a-uuid', terms: ['liability'], cap: CAP }).then(
      () => null,
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(DealDeskDatabaseError)
  })
})

describe('addAiFindingExcerpts', () => {
  it("stores citations of the finding's own deal, with an optional quote", async () => {
    actAs(userA.client)
    const finding = await answerOn(largeDeal, 'cite own deal')

    await addAiFindingExcerpts(finding.id, largeDeal.id, [
      { excerpt_id: largeExcerpts[0].id, quote: 'liability cap is 12 months' },
      { excerpt_id: largeExcerpts[3].id, quote: null },
    ])

    const { data, error } = await userA.client
      .from('ai_finding_excerpts')
      .select('excerpt_id, quote, deal_id')
      .eq('finding_id', finding.id)
      .order('excerpt_id')
    expect(error).toBeNull()
    expect(data).toEqual(
      [
        { excerpt_id: largeExcerpts[0].id, quote: 'liability cap is 12 months', deal_id: largeDeal.id },
        { excerpt_id: largeExcerpts[3].id, quote: null, deal_id: largeDeal.id },
      ].sort((a, b) => a.excerpt_id.localeCompare(b.excerpt_id)),
    )
  })

  it("rejects a citation of another deal's excerpt, and stores none of the batch", async () => {
    actAs(userA.client)
    const finding = await answerOn(largeDeal, 'cite other deal')

    const error = await addAiFindingExcerpts(finding.id, largeDeal.id, [
      { excerpt_id: largeExcerpts[0].id, quote: null },
      { excerpt_id: otherExcerpts[0].id, quote: null },
    ]).then(
      () => null,
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(DealDeskDatabaseError)
    expect((error as DealDeskDatabaseError).kind).toBe('invalid_input')
    const { data } = await userA.client.from('ai_finding_excerpts').select('excerpt_id').eq('finding_id', finding.id)
    expect(data).toEqual([])
  })

  it("rejects attaching a finding to another deal than its own", async () => {
    actAs(userA.client)
    const finding = await answerOn(largeDeal, 'wrong deal id')

    await expect(
      addAiFindingExcerpts(finding.id, otherDeal.id, [{ excerpt_id: otherExcerpts[0].id, quote: null }]),
    ).rejects.toBeInstanceOf(DealDeskDatabaseError)
  })

  it("does not let user B cite on user A's finding", async () => {
    actAs(userA.client)
    const finding = await answerOn(largeDeal, 'user B cites')

    actAs(userB.client)
    const error = await addAiFindingExcerpts(finding.id, largeDeal.id, [
      { excerpt_id: largeExcerpts[0].id, quote: null },
    ]).then(
      () => null,
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(DealDeskDatabaseError)
    expect((error as DealDeskDatabaseError).kind).toBe('not_permitted')
  })

  it('citations are immutable and not independently deletable', async () => {
    actAs(userA.client)
    const finding = await answerOn(largeDeal, 'immutable citations')
    await addAiFindingExcerpts(finding.id, largeDeal.id, [{ excerpt_id: largeExcerpts[0].id, quote: null }])

    // No UPDATE or DELETE privilege exists on the table (canonical §6.4).
    const update = await userA.client
      .from('ai_finding_excerpts')
      .update({ quote: 'rewritten' })
      .eq('finding_id', finding.id)
    expect(update.error).not.toBeNull()

    const removal = await userA.client.from('ai_finding_excerpts').delete().eq('finding_id', finding.id)
    expect(removal.error).not.toBeNull()

    const { data } = await userA.client.from('ai_finding_excerpts').select('quote').eq('finding_id', finding.id)
    expect(data).toEqual([{ quote: null }])
  })
})

describe('createCopilotAnswer: the answer and its citations, all or nothing', () => {
  const payload = { question: 'atomic?', status: 'answered', claims: [], facts: [] }

  function answerInput(deal: Deal, content: string) {
    return { deal_id: deal.id, content, payload, model: 'openrouter/test-model', prompt_version: 'copilot-v1' }
  }

  /** User A's findings with this (run-unique) content. */
  async function findingsWithContent(content: string) {
    const { data, error } = await userA.client.from('ai_findings').select('id').eq('content', content)
    if (error) throw new Error(`Read of ai_findings failed (${error.code}).`)
    return data
  }

  async function citationsOf(findingId: string) {
    const { data, error } = await userA.client
      .from('ai_finding_excerpts')
      .select('excerpt_id, quote, deal_id')
      .eq('finding_id', findingId)
      .order('excerpt_id')
    if (error) throw new Error(`Read of ai_finding_excerpts failed (${error.code}).`)
    return data
  }

  it('stores a proposed answer and all its citations together', async () => {
    actAs(userA.client)
    const content = testName('atomic answer stored')

    const finding = await createCopilotAnswer(answerInput(largeDeal, content), [
      { excerpt_id: largeExcerpts[0].id, quote: 'liability cap is 12 months' },
      { excerpt_id: largeExcerpts[3].id, quote: null },
    ])

    expect(finding).toMatchObject({
      deal_id: largeDeal.id,
      finding_type: 'answer',
      status: 'proposed',
      content,
      payload,
      rule_key: null,
      rule_version: null,
      model: 'openrouter/test-model',
      prompt_version: 'copilot-v1',
    })
    expect(await citationsOf(finding.id)).toEqual(
      [
        { excerpt_id: largeExcerpts[0].id, quote: 'liability cap is 12 months', deal_id: largeDeal.id },
        { excerpt_id: largeExcerpts[3].id, quote: null, deal_id: largeDeal.id },
      ].sort((a, b) => a.excerpt_id.localeCompare(b.excerpt_id)),
    )
  })

  it('stores an answer that cites no excerpt', async () => {
    actAs(userA.client)
    const content = testName('atomic answer without citations')

    const finding = await createCopilotAnswer(answerInput(largeDeal, content), [])

    expect(await findingsWithContent(content)).toEqual([{ id: finding.id }])
    expect(await citationsOf(finding.id)).toEqual([])
  })

  it('stores nothing when a citation is rejected: no answer is left without its evidence', async () => {
    actAs(userA.client)
    const content = testName('atomic answer rejected')

    const error = await createCopilotAnswer(answerInput(largeDeal, content), [
      { excerpt_id: largeExcerpts[0].id, quote: null },
      // Another deal's excerpt: refused by the composite key.
      { excerpt_id: otherExcerpts[0].id, quote: null },
    ]).then(
      () => null,
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(DealDeskDatabaseError)
    expect((error as DealDeskDatabaseError).kind).toBe('invalid_input')
    expect(await findingsWithContent(content)).toEqual([])
  })

  it('a retry after a failed store leaves exactly one answer', async () => {
    actAs(userA.client)
    const content = testName('atomic answer retried')

    await expect(
      createCopilotAnswer(answerInput(largeDeal, content), [{ excerpt_id: otherExcerpts[0].id, quote: null }]),
    ).rejects.toBeInstanceOf(DealDeskDatabaseError)
    const finding = await createCopilotAnswer(answerInput(largeDeal, content), [
      { excerpt_id: largeExcerpts[0].id, quote: null },
    ])

    expect(await findingsWithContent(content)).toEqual([{ id: finding.id }])
    expect(await citationsOf(finding.id)).toHaveLength(1)
  })

  it("lets neither user B nor an anonymous caller store an answer on user A's deal", async () => {
    const content = testName('atomic answer by another caller')

    actAs(userB.client)
    const error = await createCopilotAnswer(answerInput(largeDeal, content), [
      { excerpt_id: largeExcerpts[0].id, quote: null },
    ]).then(
      () => null,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(DealDeskDatabaseError)
    expect((error as DealDeskDatabaseError).kind).toBe('not_permitted')

    // anon has no EXECUTE on the function at all.
    const anonymous = await createAnonymousClient().rpc('create_copilot_answer', {
      p_deal_id: largeDeal.id,
      p_content: content,
      p_payload: payload,
      p_model: 'openrouter/test-model',
      p_prompt_version: 'copilot-v1',
      p_citations: [],
    })
    expect(anonymous.error).not.toBeNull()

    expect(await findingsWithContent(content)).toEqual([])
  })
})

describe('answer findings and listCopilotAnswers', () => {
  it('stores an answer with its payload and no rule, starting as proposed, with immutable content', async () => {
    actAs(userA.client)
    const finding = await answerOn(smallDeal, 'what is the ARR?')

    expect(finding).toMatchObject({
      finding_type: 'answer',
      status: 'proposed',
      rule_key: null,
      rule_version: null,
      model: 'openrouter/test-model',
      prompt_version: 'copilot-v1',
      payload: { question: 'what is the ARR?', status: 'answered', claims: [], facts: [] },
    })

    const { error } = await userA.client.from('ai_findings').update({ content: 'rewritten' }).eq('id', finding.id)
    expect(error).not.toBeNull()
  })

  it('lists only answers, newest first, at most 10, each with its citations', async () => {
    actAs(userA.client)
    const created: AiFinding[] = []
    for (let n = 1; n <= 12; n += 1) {
      created.push(await answerOn(hugeDeal, `history question ${n}`))
    }
    await createAiFinding({
      deal_id: hugeDeal.id,
      finding_type: 'deal_summary',
      content: 'Not an answer.',
      model: 'openrouter/test-model',
      prompt_version: 'summary-v1',
    })
    const hugeExcerpts = [...excerptsOf.values()].flat().filter((e) => e.deal_id === hugeDeal.id)
    await addAiFindingExcerpts(created[11].id, hugeDeal.id, [
      { excerpt_id: hugeExcerpts[0].id, quote: 'Liability clause' },
    ])

    const answers = await listCopilotAnswers(hugeDeal.id)

    expect(answers).toHaveLength(10)
    expect(answers.map((a) => a.finding.id)).toEqual(
      created
        .slice(2)
        .reverse()
        .map((f) => f.id),
    )
    expect(answers.every((a) => a.finding.finding_type === 'answer')).toBe(true)
    expect(answers[0].citations).toEqual([
      {
        excerpt_id: hugeExcerpts[0].id,
        quote: 'Liability clause',
        content: hugeExcerpts[0].content,
        evidence_item_id: hugeExcerpts[0].evidence_item_id,
        evidence_title: testName('huge msa'),
      },
    ])
    expect(answers[1].citations).toEqual([])
  })

  it("lists nothing to user B for user A's deal", async () => {
    actAs(userB.client)
    expect(await listCopilotAnswers(hugeDeal.id)).toEqual([])
  })
})
