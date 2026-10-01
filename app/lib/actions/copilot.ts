'use server'

import { revalidatePath } from 'next/cache'

import { askCopilot } from '../ai/copilot'
import { getCopilotProvider } from '../ai/openrouter'
import {
  answerPayload,
  buildCopilotSources,
  COPILOT_ERROR_MESSAGE,
  COPILOT_PROMPT_VERSION,
  excerptCitations,
  MAX_COPILOT_EXCERPTS,
  questionTerms,
  rankExcerpts,
  statusMessage,
  validateQuestion,
  type CopilotAnswer,
  type CopilotSource,
} from '../deal-desk/copilot'
import { buildExceptionContext } from '../deal-desk/exception-context'
import { isUuid } from '../deal-desk/forms'
import {
  createCopilotAnswer,
  DealDeskDatabaseError,
  getAccount,
  getDeal,
  listExceptions,
  listProvisions,
  listRulePrecedents,
  retrieveDealExcerpts,
} from '../db'
import { failure, type DealDeskActionState } from './deal-desk-action-state'
import { requireUser } from './require-auth'

/**
 * The Server Action behind the deal page's question box (Feature 6: AI Deal
 * Copilot V1).
 *
 * In order: sign-in check, input validation, reads of this one deal as the
 * caller (row level security decides whether it is theirs), retrieval of its
 * non-superseded excerpts, one model call over exactly those sources, and
 * validation of the reply. Only a valid answer is stored: one `answer`
 * finding and its excerpt citations, in one transaction. Nothing else is
 * written — the Copilot never records or changes a Decision, an exception or
 * a provision.
 *
 * The question, the evidence and the model output are never logged.
 */

const SIGNED_OUT_MESSAGE = 'You need to be signed in.'
const INVALID_MESSAGE = 'Check the highlighted fields and try again.'
const DEAL_NOT_FOUND_MESSAGE = 'This deal no longer exists, or it is not one of yours.'

/**
 * What the server log records about a failure: metadata only, as in the
 * other Deal Desk actions. An error's message can quote the question, the
 * evidence or the model output, so neither the error nor its message is
 * logged.
 */
function safeErrorMetadata(error: unknown) {
  if (error instanceof DealDeskDatabaseError) {
    return {
      operation: error.operation,
      table: error.table,
      kind: error.kind,
      code: error.cause.code,
    }
  }

  return { kind: 'unexpected', name: error instanceof Error ? error.name : typeof error }
}

/** The finding's text: the fixed message for a non-answer, otherwise its claims. */
function answerContent(answer: CopilotAnswer): string {
  return statusMessage(answer.status) ?? answer.claims.map((claim) => claim.text).join('\n')
}

/**
 * Everything one question about one deal may draw on, read as the caller:
 * the deal's facts, account and predecessor, its provisions, its exceptions
 * with their Exception Context, and its ranked excerpts. Null when the deal
 * is missing or not the caller's; a failed read throws.
 */
async function readSources(dealId: string, terms: string[]): Promise<CopilotSource[] | null> {
  const deal = await getDeal(dealId)

  if (!deal) {
    return null
  }

  const [account, predecessor, provisions, exceptions, retrieved] = await Promise.all([
    getAccount(deal.account_id),
    deal.predecessor_deal_id ? getDeal(deal.predecessor_deal_id) : null,
    listProvisions(deal.id),
    listExceptions(deal.id),
    retrieveDealExcerpts({ dealId: deal.id, terms, cap: MAX_COPILOT_EXCERPTS }),
  ])

  const [predecessorProvisions, precedents] = await Promise.all([
    predecessor ? listProvisions(predecessor.id) : [],
    Promise.all(
      exceptions.map((exception) =>
        listRulePrecedents({
          accountId: deal.account_id,
          ruleKey: exception.rule_key,
          excludeExceptionId: exception.id,
        }),
      ),
    ),
  ])

  return buildCopilotSources({
    deal,
    account,
    predecessor,
    provisions,
    exceptions: exceptions.map((exception, index) => ({
      exception,
      context: buildExceptionContext({
        exception,
        deal,
        account,
        provisions,
        predecessor,
        predecessorProvisions,
        precedent: precedents[index],
      }),
    })),
    excerpts: rankExcerpts(terms, retrieved.excerpts, MAX_COPILOT_EXCERPTS),
  })
}

/**
 * Answers one question about one of the caller's deals and stores the
 * answer as an AI finding. A failure at any step stores nothing new and
 * shows the generic message; a malformed reply is never stored.
 */
export async function askCopilotAction(
  _state: DealDeskActionState,
  formData: FormData,
): Promise<DealDeskActionState> {
  if (await requireUser()) {
    return failure(SIGNED_OUT_MESSAGE)
  }

  const dealId = formData.get('dealId')

  if (!isUuid(dealId)) {
    return failure(DEAL_NOT_FOUND_MESSAGE)
  }

  const rawQuestion = formData.get('question')
  const checked = validateQuestion(rawQuestion)

  if (!checked.ok) {
    return failure(
      INVALID_MESSAGE,
      { question: checked.error },
      { question: typeof rawQuestion === 'string' ? rawQuestion : '' },
    )
  }

  const { question } = checked
  const configured = getCopilotProvider()

  if (!configured) {
    console.error('[copilot] no model provider is configured')

    return failure(COPILOT_ERROR_MESSAGE)
  }

  let sources: CopilotSource[] | null

  try {
    sources = await readSources(dealId, questionTerms(question))
  } catch (error) {
    console.error('[copilot] read failed', safeErrorMetadata(error))

    return failure(COPILOT_ERROR_MESSAGE)
  }

  if (!sources) {
    return failure(DEAL_NOT_FOUND_MESSAGE)
  }

  const result = await askCopilot({ question, sources, provider: configured.provider })

  if (!result.ok) {
    console.error('[copilot] no valid answer', { reason: result.reason })

    return failure(COPILOT_ERROR_MESSAGE)
  }

  // The answer and its citations are stored together or not at all, so a
  // failure leaves no answer behind and a retry stores exactly one.
  try {
    await createCopilotAnswer(
      {
        deal_id: dealId,
        content: answerContent(result.answer),
        payload: answerPayload(question, result.answer, sources),
        model: result.model,
        prompt_version: COPILOT_PROMPT_VERSION,
      },
      excerptCitations(result.answer),
    )
  } catch (error) {
    console.error('[copilot] store failed', safeErrorMetadata(error))

    return failure(COPILOT_ERROR_MESSAGE)
  }

  revalidatePath(`/workspace/deals/${dealId}`)

  return { ok: true, message: null, fieldErrors: {}, values: {}, at: Date.now() }
}
