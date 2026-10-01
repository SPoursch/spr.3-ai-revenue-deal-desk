import 'server-only'

import type { CopilotProvider } from './copilot'
import { resolveProviderConfig, type ProviderEnv } from './provider-config'

/**
 * The OpenRouter adapter: the only code that calls the model provider
 * (Feature 6). Server-only, so importing it from client code fails the build.
 *
 * One chat completion per question, with:
 * - the pinned model and no fallback routing to another model or provider;
 * - providers asked not to collect the data;
 * - a JSON-object reply, no tools, a bounded output and a bounded wait.
 *
 * It reports the model the provider says it used. Its errors carry the HTTP
 * status at most: never the key, the prompt or the reply. Nothing is logged.
 */

/** The answer is at most MAX_CLAIMS short claims; this leaves room for JSON. */
const MAX_OUTPUT_TOKENS = 1200
const REQUEST_TIMEOUT_MS = 30_000

type OpenRouterConfig = { baseUrl: string; apiKey: string; model: string }

function readReply(body: unknown, requestedModel: string): { model: string; content: string } {
  const data = body as { model?: unknown; choices?: { message?: { content?: unknown } }[] } | null
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content === '') {
    throw new Error('The model provider returned no message content.')
  }
  return { model: typeof data?.model === 'string' ? data.model : requestedModel, content }
}

export function createOpenRouterProvider(
  config: OpenRouterConfig,
  fetchImpl: typeof fetch = fetch,
): CopilotProvider {
  return async ({ system, user }) => {
    const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
        provider: { allow_fallbacks: false, data_collection: 'deny' },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(`The model provider request failed with status ${response.status}.`)
    }

    return readReply(await response.json(), config.model)
  }
}

/**
 * The configured provider and its pinned model, or null when the key or the
 * model is not set — the Copilot then reports that it cannot answer.
 */
export function getCopilotProvider(
  env: ProviderEnv = process.env,
): { provider: CopilotProvider; model: string } | null {
  const { baseUrl, apiKey, model } = resolveProviderConfig(env)
  if (!apiKey || !model) return null
  return { provider: createOpenRouterProvider({ baseUrl, apiKey, model }), model }
}
