import { describe, expect, it, vi } from 'vitest'

// The OpenRouter adapter is server-only; in Node tests that marker is inert.
vi.mock('server-only', () => ({}))

import { askCopilot, type CopilotProvider } from '../../app/lib/ai/copilot'
import { createOpenRouterProvider, getCopilotProvider } from '../../app/lib/ai/openrouter'
import {
  DEFAULT_PROVIDER_BASE_URL,
  resolveProviderConfig,
} from '../../app/lib/ai/provider-config'
import {
  buildCopilotPrompt,
  buildCopilotSources,
  type CopilotSourcesInput,
} from '../../app/lib/deal-desk/copilot'
import type { Deal } from '../../app/lib/deal-desk/domain'

/**
 * Feature 6: AI Deal Copilot V1 — the provider boundary.
 *
 * - provider-config.ts decides where model requests go. The default is
 *   OpenRouter. A local fake (http on localhost / 127.0.0.1) may replace it
 *   only outside production: never when NODE_ENV is 'production' and never
 *   on Vercel, so the production default cannot be redirected.
 * - openrouter.ts is the only caller of the provider, server-only. It pins
 *   the model with no fallback routing, asks providers not to collect the
 *   data, bounds the output and the wait, and reports the model the provider
 *   says it used. Its key never appears in an error.
 * - copilot.ts runs one question against an injected provider — the tests
 *   pass a fake function, with no environment flag — and validates the
 *   output. It touches no database.
 */

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const KEY = 'sk-or-test-secret-key'

describe('resolveProviderConfig', () => {
  const base = { OPENROUTER_API_KEY: KEY, OPENROUTER_MODEL: 'anthropic/claude-sonnet-5.5' }

  it('defaults to OpenRouter with the key and pinned model from the environment', () => {
    expect(DEFAULT_PROVIDER_BASE_URL).toBe('https://openrouter.ai/api/v1')
    expect(resolveProviderConfig({ ...base, NODE_ENV: 'production' })).toEqual({
      baseUrl: DEFAULT_PROVIDER_BASE_URL,
      apiKey: KEY,
      model: 'anthropic/claude-sonnet-5.5',
    })
  })

  it('accepts a local fake provider outside production', () => {
    for (const url of ['http://127.0.0.1:4010/api/v1', 'http://localhost:4010/api/v1']) {
      expect(
        resolveProviderConfig({ ...base, NODE_ENV: 'development', COPILOT_PROVIDER_BASE_URL: url }).baseUrl,
      ).toBe(url)
      expect(
        resolveProviderConfig({ ...base, NODE_ENV: 'test', COPILOT_PROVIDER_BASE_URL: url }).baseUrl,
      ).toBe(url)
    }
  })

  it('production default cannot be redirected: the override is ignored in production', () => {
    expect(
      resolveProviderConfig({
        ...base,
        NODE_ENV: 'production',
        COPILOT_PROVIDER_BASE_URL: 'http://127.0.0.1:4010/api/v1',
      }).baseUrl,
    ).toBe(DEFAULT_PROVIDER_BASE_URL)
  })

  it('production default cannot be redirected: the override is ignored on Vercel, in any environment', () => {
    for (const NODE_ENV of ['development', 'test', 'production']) {
      expect(
        resolveProviderConfig({
          ...base,
          NODE_ENV,
          VERCEL: '1',
          COPILOT_PROVIDER_BASE_URL: 'http://127.0.0.1:4010/api/v1',
        }).baseUrl,
      ).toBe(DEFAULT_PROVIDER_BASE_URL)
    }
  })

  it('ignores an override that is not a local http address', () => {
    for (const url of [
      'https://evil.example/api/v1',
      'http://evil.example/api/v1',
      'https://127.0.0.1:4010/api/v1',
      'http://127.0.0.1.evil.example/api/v1',
      'not a url',
    ]) {
      expect(
        resolveProviderConfig({ ...base, NODE_ENV: 'development', COPILOT_PROVIDER_BASE_URL: url }).baseUrl,
      ).toBe(DEFAULT_PROVIDER_BASE_URL)
    }
  })

  it('reports a missing key or model as null rather than inventing one', () => {
    expect(resolveProviderConfig({ NODE_ENV: 'production' })).toEqual({
      baseUrl: DEFAULT_PROVIDER_BASE_URL,
      apiKey: null,
      model: null,
    })
    expect(resolveProviderConfig({ OPENROUTER_API_KEY: '  ', OPENROUTER_MODEL: '' })).toMatchObject({
      apiKey: null,
      model: null,
    })
  })
})

describe('getCopilotProvider', () => {
  it('is unavailable without a key or a model', () => {
    expect(getCopilotProvider({ OPENROUTER_MODEL: 'm' })).toBeNull()
    expect(getCopilotProvider({ OPENROUTER_API_KEY: KEY })).toBeNull()
  })

  it('is available with both, and names the pinned model', () => {
    expect(getCopilotProvider({ OPENROUTER_API_KEY: KEY, OPENROUTER_MODEL: 'm/one' })).toMatchObject({
      model: 'm/one',
      provider: expect.any(Function),
    })
  })
})

describe('createOpenRouterProvider', () => {
  const config = { baseUrl: 'https://openrouter.ai/api/v1', apiKey: KEY, model: 'pinned/model' }
  const prompt = { system: 'system text', user: 'user text' }

  function okResponse(body: unknown) {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  it('posts one chat completion with the pinned model, no fallbacks and data collection denied', async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse({ model: 'pinned/model-2026', choices: [{ message: { content: '{"status":"out_of_scope"}' } }] }),
    )

    const result = await createOpenRouterProvider(config, fetchImpl)(prompt)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${KEY}`)
    expect(init.signal).toBeInstanceOf(AbortSignal)

    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('pinned/model')
    expect(body.models).toBeUndefined()
    expect(body.messages).toEqual([
      { role: 'system', content: 'system text' },
      { role: 'user', content: 'user text' },
    ])
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.provider).toMatchObject({ allow_fallbacks: false, data_collection: 'deny' })
    expect(body.max_tokens).toBeGreaterThan(0)
    expect(body.max_tokens).toBeLessThanOrEqual(1500)
    expect(body.tools).toBeUndefined()

    // The model the provider says it used, not only the one requested.
    expect(result).toEqual({ model: 'pinned/model-2026', content: '{"status":"out_of_scope"}' })
  })

  it('throws on a failed request without the key in the error', async () => {
    const fetchImpl = vi.fn(async () => new Response(`bad key ${KEY}`, { status: 401 }))

    const error = await createOpenRouterProvider(config, fetchImpl)(prompt).then(
      () => null,
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).message)).not.toContain(KEY)
  })

  it('throws when the response carries no message content', async () => {
    const fetchImpl = vi.fn(async () => okResponse({ model: 'pinned/model', choices: [] }))

    await expect(createOpenRouterProvider(config, fetchImpl)(prompt)).rejects.toBeInstanceOf(Error)
  })
})

describe('askCopilot', () => {
  const deal: Deal = {
    id: '33333333-3333-4333-8333-333333333333',
    account_id: '11111111-1111-4111-8111-111111111111',
    predecessor_deal_id: null,
    name: 'Acme 2026',
    deal_type: 'new_business',
    stage: 'negotiation',
    arr_eur: 60000,
    tcv_eur: null,
    list_price_eur: null,
    discount_pct: 25,
    term_months: null,
    start_date: null,
    end_date: null,
    renewal_date: null,
    notice_period_days: null,
    auto_renew: null,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
  }
  const sourcesInput: CopilotSourcesInput = {
    deal,
    account: null,
    predecessor: null,
    provisions: [],
    exceptions: [],
    excerpts: [],
  }
  const sources = buildCopilotSources(sourcesInput)
  const ARR = sources.find((s) => s.ref === 'deal.arr_eur')!.alias

  it('sends exactly the built prompt to the injected provider and returns the validated answer', async () => {
    const provider: CopilotProvider = vi.fn(async () => ({
      model: 'reported/model',
      content: JSON.stringify({ status: 'answered', claims: [{ text: 'The ARR is €60,000.00.', refs: [ARR] }] }),
    }))

    const result = await askCopilot({ question: 'What is the ARR?', sources, provider })

    expect(provider).toHaveBeenCalledTimes(1)
    expect(provider).toHaveBeenCalledWith(buildCopilotPrompt({ question: 'What is the ARR?', sources }))
    expect(JSON.stringify(vi.mocked(provider).mock.calls[0])).not.toMatch(UUID_PATTERN)
    expect(result).toMatchObject({
      ok: true,
      model: 'reported/model',
      answer: { status: 'answered', claims: [{ supported: true }] },
    })
  })

  it('reports malformed output as such', async () => {
    const provider: CopilotProvider = async () => ({ model: 'reported/model', content: 'not json' })

    expect(await askCopilot({ question: 'What is the ARR?', sources, provider })).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })

  it('reports a provider failure without throwing', async () => {
    const provider: CopilotProvider = async () => {
      throw new Error('network down')
    }

    expect(await askCopilot({ question: 'What is the ARR?', sources, provider })).toEqual({
      ok: false,
      reason: 'provider_error',
    })
  })
})
