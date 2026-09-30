import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The server-controlled fields of the provision Server Actions (Contract /
 * Document Intelligence V1).
 *
 * A provision is always human-entered, and its confirmation time is set once
 * by the database: the canonical schema grants the client INSERT on `source`
 * and `source_finding_id` and UPDATE on `confirmed_at`, so only the actions
 * keep them out of a request. These tests pin exactly what reaches the data
 * layer. The E2E and integration suites cover the rest of the workflow.
 *
 * The auth guard, the data layer and Next's navigation are stubs; the actions
 * and the form parsing are the real ones.
 */

const db = vi.hoisted(() => ({
  addProvisionExcerpts: vi.fn(),
  createProvision: vi.fn(),
  getDeal: vi.fn(),
  getProvision: vi.fn(),
  listDealExcerptsByItem: vi.fn(),
  updateProvision: vi.fn(),
}))

const guard = vi.hoisted(() => ({ requireUser: vi.fn() }))

const navigation = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`)
  }),
}))

vi.mock('../../app/lib/db', async () => ({
  ...(await vi.importActual<object>('../../app/lib/db/errors')),
  ...db,
}))
vi.mock('../../app/lib/actions/require-auth', () => guard)
vi.mock('next/navigation', () => navigation)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createProvisionAction, updateProvisionAction } from '../../app/lib/actions/provisions'
import { initialDealDeskActionState } from '../../app/lib/actions/deal-desk-action-state'

const DEAL_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_DEAL_ID = '66666666-6666-4666-8666-666666666666'
const PROVISION_ID = '44444444-4444-4444-8444-444444444444'
const FINDING_ID = '55555555-5555-4555-8555-555555555555'

/** Fields a tampered submission adds to take over what the server controls. */
const SMUGGLED = {
  deal_id: OTHER_DEAL_ID,
  user_id: 'someone-else',
  source: 'ai_confirmed',
  source_finding_id: FINDING_ID,
  confirmed_at: '2000-01-01T00:00:00Z',
  confirmedAt: '2000-01-01T00:00:00Z',
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

beforeEach(() => {
  guard.requireUser.mockResolvedValue(null)
  db.getDeal.mockResolvedValue({ id: DEAL_ID })
  db.listDealExcerptsByItem.mockResolvedValue([])
  db.createProvision.mockResolvedValue({ id: PROVISION_ID, deal_id: DEAL_ID })
  db.addProvisionExcerpts.mockResolvedValue([])
  db.getProvision.mockResolvedValue({
    id: PROVISION_ID,
    deal_id: DEAL_ID,
    provision_type: 'liability_cap',
  })
  db.updateProvision.mockResolvedValue({ id: PROVISION_ID, deal_id: DEAL_ID })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('createProvisionAction', () => {
  it("always creates a human-entered provision on the verified deal, whatever the form says", async () => {
    await expect(
      createProvisionAction(
        initialDealDeskActionState,
        form({
          dealId: DEAL_ID,
          provisionType: 'governing_law',
          valueText: 'German law',
          ...SMUGGLED,
        }),
      ),
    ).rejects.toThrow(`NEXT_REDIRECT /workspace/deals/${DEAL_ID}/provisions/${PROVISION_ID}`)

    expect(db.getDeal).toHaveBeenCalledWith(DEAL_ID)
    expect(db.createProvision.mock.calls[0][0]).toMatchObject({
      deal_id: DEAL_ID,
      source: 'human_entered',
    })
  })

  it('never sends a confirmation time, a source finding or any other client field', async () => {
    await expect(
      createProvisionAction(
        initialDealDeskActionState,
        form({
          dealId: DEAL_ID,
          provisionType: 'liability_cap',
          valueText: '12 months of fees',
          valueNumeric: '12',
          valueUnit: 'months_of_fees',
          ...SMUGGLED,
        }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT')

    // Exactly these keys: confirmed_at is left to the database default.
    expect(db.createProvision.mock.calls[0][0]).toEqual({
      deal_id: DEAL_ID,
      provision_type: 'liability_cap',
      value_text: '12 months of fees',
      value_numeric: 12,
      value_unit: 'months_of_fees',
      source: 'human_entered',
    })
  })
})

describe('updateProvisionAction', () => {
  it('updates only the value fields, never the type, provenance or confirmation time', async () => {
    await expect(
      updateProvisionAction(
        initialDealDeskActionState,
        form({
          provisionId: PROVISION_ID,
          valueText: '6 months of fees',
          valueNumeric: '6',
          valueUnit: 'months_of_fees',
          provisionType: 'discount',
          ...SMUGGLED,
        }),
      ),
    ).rejects.toThrow(`NEXT_REDIRECT /workspace/deals/${DEAL_ID}/provisions/${PROVISION_ID}`)

    expect(db.getProvision).toHaveBeenCalledWith(PROVISION_ID)
    expect(db.updateProvision).toHaveBeenCalledWith(PROVISION_ID, {
      value_text: '6 months of fees',
      value_numeric: 6,
      value_unit: 'months_of_fees',
    })
  })
})
