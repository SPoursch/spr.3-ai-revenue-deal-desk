// A local stand-in for OpenRouter, for the Feature 6 Copilot end-to-end tests.
//
// Playwright starts it (playwright.config.ts) and points the dev server at it
// through COPILOT_PROVIDER_BASE_URL, which the app honours only outside
// production and never on Vercel (app/lib/ai/provider-config.ts). It listens
// on 127.0.0.1 only and never calls the real provider.
//
// It answers POST /api/v1/chat/completions like OpenRouter's chat completion
// API, scripted by keywords in the question. It reads the prompt's
// `<source alias kind label>` and `<question>` delimiters (the format fixed by
// tests/unit/copilot.test.ts) to cite the right aliases, exactly as a model
// would. Every request is recorded — without its body — for the spec to
// check: GET /__requests, POST /__reset. GET /__health is the readiness URL.

import { createServer } from 'node:http'

const PORT = Number(process.env.FAKE_OPENROUTER_PORT ?? 4010)
const MODEL = 'fake/copilot-model'
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

let requests = []

function unescape(text) {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
}

function parsePrompt(user) {
  const sources = [...user.matchAll(/<source alias="([A-Z]\d+)" kind="(\w+)" label="([^"]*)">([\s\S]*?)<\/source>/g)].map(
    ([, alias, kind, label, text]) => ({ alias, kind, label: unescape(label), text: unescape(text) }),
  )
  const question = unescape(user.match(/<question>([\s\S]*?)<\/question>/)?.[1] ?? '')
  return { sources, question }
}

function script({ sources, question }) {
  const q = question.toLowerCase()
  const fact = (label) => sources.find((s) => s.kind === 'fact' && s.label === label)?.alias
  const excerpt = (needle) => sources.find((s) => s.kind === 'excerpt' && s.text.includes(needle))?.alias
  const arrClaim = { text: 'The deal ARR is €60,000.00.', refs: [fact('ARR')] }

  if (q.includes('malformed')) return 'This is not JSON.'
  if (q.includes('approve')) return JSON.stringify({ status: 'out_of_scope', claims: [] })
  if (q.includes('data residency')) return JSON.stringify({ status: 'insufficient_evidence', claims: [] })
  if (q.includes('unsupported')) {
    return JSON.stringify({
      status: 'answered',
      claims: [
        arrClaim,
        { text: 'The customer was promised a free upgrade.', refs: [] },
        { text: 'The discount is 45%.', refs: [fact('Discount')] },
        { text: 'Payment terms were agreed in a side letter.', refs: ['E99'] },
      ],
    })
  }
  if (q.includes('payment terms')) {
    return JSON.stringify({
      status: 'answered',
      claims: [
        {
          text: 'The evidence conflicts: the agreement says Net 30 and the email says Net 60.',
          refs: [excerpt('Net 30'), excerpt('Net 60')],
        },
      ],
    })
  }
  if (q.includes('liability')) {
    const liability = excerpt('liability cap')
    return JSON.stringify({
      status: 'answered',
      claims: [
        {
          text: 'The liability cap is 12 months of fees.',
          refs: [liability],
          quotes: { [liability]: 'liability cap is 12 months of fees' },
        },
        arrClaim,
      ],
    })
  }
  return JSON.stringify({ status: 'answered', claims: [arrClaim] })
}

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/__health') return send(response, 200, { ok: true })
  if (request.method === 'GET' && request.url === '/__requests') return send(response, 200, requests)
  if (request.method === 'POST' && request.url === '/__reset') {
    requests = []
    return send(response, 200, { ok: true })
  }
  if (request.method !== 'POST' || request.url !== '/api/v1/chat/completions') {
    return send(response, 404, { error: 'not found' })
  }

  let raw = ''
  request.on('data', (chunk) => {
    raw += chunk
  })
  request.on('end', () => {
    let body
    try {
      body = JSON.parse(raw)
    } catch {
      return send(response, 400, { error: 'bad json' })
    }
    const user = body.messages?.find((m) => m.role === 'user')?.content ?? ''
    const prompt = parsePrompt(user)
    requests.push({
      authorization: request.headers.authorization ?? null,
      model: body.model ?? null,
      provider: body.provider ?? null,
      response_format: body.response_format ?? null,
      max_tokens: body.max_tokens ?? null,
      has_uuid: UUID.test(raw),
      question: prompt.question,
      source_count: prompt.sources.length,
    })
    send(response, 200, {
      id: `fake-${requests.length}`,
      model: MODEL,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: script(prompt) } }],
    })
  })
})

server.listen(PORT, '127.0.0.1')
