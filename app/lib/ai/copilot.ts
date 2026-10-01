import {
  buildCopilotPrompt,
  validateCopilotOutput,
  type CopilotAnswer,
  type CopilotPrompt,
  type CopilotSource,
} from '../deal-desk/copilot'

/**
 * Runs one Copilot question against a model provider (Feature 6).
 *
 * The provider is passed in: openrouter.ts supplies the real one on the
 * server, and tests pass a fake function, with no environment flag. This
 * module touches no database and no network of its own, and keeps nothing:
 * it builds the prompt from the sources it is given, makes one call, and
 * validates the reply against those same sources.
 */

export type { CopilotPrompt }

/** One model call: the prompt in; the model the provider reports using and its reply out. */
export type CopilotProvider = (prompt: CopilotPrompt) => Promise<{ model: string; content: string }>

export type CopilotResult =
  | { ok: true; model: string; answer: CopilotAnswer }
  | { ok: false; reason: 'provider_error' | 'malformed' }

export async function askCopilot({
  question,
  sources,
  provider,
}: {
  question: string
  sources: CopilotSource[]
  provider: CopilotProvider
}): Promise<CopilotResult> {
  const prompt = buildCopilotPrompt({ question, sources })

  let reply: Awaited<ReturnType<CopilotProvider>>
  try {
    reply = await provider(prompt)
  } catch {
    // The cause stays here: it may echo the request.
    return { ok: false, reason: 'provider_error' }
  }

  const validation = validateCopilotOutput(reply.content, sources)
  if (!validation.ok) return { ok: false, reason: 'malformed' }

  return { ok: true, model: reply.model, answer: validation.answer }
}
