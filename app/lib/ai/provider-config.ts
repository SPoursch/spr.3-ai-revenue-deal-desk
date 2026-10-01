/**
 * Where Copilot model requests go, and with which key and model.
 *
 * Read from the server environment only, never from a request:
 * - OPENROUTER_API_KEY, the provider key. Server-only: never NEXT_PUBLIC_,
 *   never logged, never sent anywhere but the provider.
 * - OPENROUTER_MODEL, the one pinned model.
 *
 * The provider is OpenRouter. The end-to-end tests replace it with a local
 * fake through COPILOT_PROVIDER_BASE_URL, which is honoured only for a plain
 * http address on localhost or 127.0.0.1, only outside production, and never
 * on Vercel, so the production default cannot be redirected.
 *
 * Pure: the caller passes the environment, so the rules can be tested.
 */

export const DEFAULT_PROVIDER_BASE_URL = 'https://openrouter.ai/api/v1'

export type ProviderEnv = Record<string, string | undefined>

export type ProviderConfig = {
  baseUrl: string
  apiKey: string | null
  model: string | null
}

function present(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** The local test provider's address, when this environment may use one. */
function localOverride(env: ProviderEnv): string | null {
  if (env.NODE_ENV === 'production' || present(env.VERCEL)) return null

  const raw = present(env.COPILOT_PROVIDER_BASE_URL)
  if (!raw) return null

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:') return null
  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return null
  return raw
}

export function resolveProviderConfig(env: ProviderEnv): ProviderConfig {
  return {
    baseUrl: localOverride(env) ?? DEFAULT_PROVIDER_BASE_URL,
    apiKey: present(env.OPENROUTER_API_KEY),
    model: present(env.OPENROUTER_MODEL),
  }
}
