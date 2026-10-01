import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Feature 6: AI Deal Copilot V1 — source guards for "AI never decides" and
 * for the provider key.
 *
 * Like tests/unit/decision-write-path.test.ts, these read the application
 * source rather than importing it, so a violation is caught before it runs.
 *
 * - app/lib/ai/ is the only code that talks to the model provider; its
 *   adapter is marked server-only, and no client module imports it.
 * - The provider key is server-only: never NEXT_PUBLIC_, never outside
 *   app/lib/ai/.
 * - The AI module imports nothing from the data layer.
 * - The Copilot action imports from the data layer only by name, from an
 *   allow-list of reads plus the one atomic answer write — never a namespace
 *   import, which would reach the re-exported Decision write path — and
 *   names no other mutation.
 * - The pure Copilot core imports neither the data layer nor the provider.
 */

const ROOT = process.cwd()
const APP = join(ROOT, 'app')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

function repoPath(path: string): string {
  return relative(ROOT, path).split(sep).join('/')
}

const files = sourceFiles(APP).map((path) => ({
  path: repoPath(path),
  source: readFileSync(path, 'utf8'),
}))

function read(path: string): string {
  const full = join(ROOT, path)
  expect(existsSync(full), `${path} exists`).toBe(true)
  return readFileSync(full, 'utf8')
}

const AI_DIR = 'app/lib/ai/'
const ADAPTER = 'app/lib/ai/openrouter.ts'
const ACTION = 'app/lib/actions/copilot.ts'
const CORE = 'app/lib/deal-desk/copilot.ts'

const aiFiles = () => files.filter(({ path }) => path.startsWith(AI_DIR))

/** Module specifiers that resolve to the data layer, from anywhere in app/. */
const DB_SPECIFIER = /^(@\/app\/lib\/db|(\.\.?\/)+(lib\/)?db)(\/.*)?$/

type Import = { specifier: string; names: string[]; namespace: boolean; typeOnly: boolean }

function importsOf(source: string): Import[] {
  const result: Import[] = []
  const pattern = /import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g
  for (const match of source.matchAll(pattern)) {
    const clause = match[2]
    const named = clause.match(/\{([\s\S]*)\}/)?.[1] ?? ''
    result.push({
      specifier: match[3],
      typeOnly: Boolean(match[1]),
      namespace: /\*\s+as\s+\w+/.test(clause),
      names: named
        .split(',')
        .map((n) => n.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
        .filter(Boolean),
    })
  }
  // Side-effect and dynamic imports.
  for (const match of source.matchAll(/(?:import\s*\(|^\s*import\s+)['"]([^'"]+)['"]/gm)) {
    result.push({ specifier: match[1], typeOnly: false, namespace: true, names: [] })
  }
  return result
}

const ACTION_DB_ALLOW_LIST = [
  'getDeal',
  'getAccount',
  'listProvisions',
  'listExceptions',
  'listRulePrecedents',
  'retrieveDealExcerpts',
  'createCopilotAnswer',
  'DealDeskDatabaseError',
]

const FORBIDDEN_IN_AI_PATH = [
  // The answer and its citations are stored only together (createCopilotAnswer).
  'createAiFinding',
  'addAiFindingExcerpts',
  'recordDecision',
  'recordDecisionAction',
  'createException',
  'updateExceptionStatus',
  'createProvision',
  'updateProvision',
  'deleteProvision',
  'addProvisionExcerpt',
  'addProvisionExcerpts',
  'removeProvisionExcerpt',
  'updateAiFindingStatus',
  'createEvidenceItem',
  'createEvidenceExcerpt',
  'createEvidenceExcerpts',
  'updateDeal',
  'deleteDeal',
  'getSupabaseClient',
]

describe('the provider boundary', () => {
  it('the OpenRouter adapter exists and is server-only', () => {
    expect(read(ADAPTER)).toMatch(/^\s*import\s+['"]server-only['"]/m)
  })

  it('only app/lib/ai/ names the provider or its key', () => {
    const outside = files
      .filter(({ path }) => !path.startsWith(AI_DIR))
      .filter(({ source }) => /openrouter\.ai|OPENROUTER_API_KEY|COPILOT_PROVIDER_BASE_URL/.test(source))
      .map(({ path }) => path)

    expect(aiFiles().length).toBeGreaterThan(0)
    expect(outside).toEqual([])
  })

  it('never exposes a provider setting to the browser', () => {
    const exposed = files
      .filter(({ source }) => /NEXT_PUBLIC_(OPENROUTER|COPILOT|OPENAI)/.test(source))
      .map(({ path }) => path)

    expect(exposed).toEqual([])
  })

  it('no client module imports the AI module', () => {
    const clientImporters = files
      .filter(({ source }) => /^\s*['"]use client['"]/m.test(source))
      .filter(({ source }) => importsOf(source).some((i) => /(^|\/)lib\/ai(\/|$)/.test(i.specifier)))
      .map(({ path }) => path)

    expect(clientImporters).toEqual([])
  })

  it('the AI module imports nothing from the data layer or Supabase', () => {
    expect(aiFiles().length).toBeGreaterThan(0)
    for (const { path, source } of aiFiles()) {
      const reached = importsOf(source)
        .map((i) => i.specifier)
        .filter((s) => DB_SPECIFIER.test(s) || /supabase/.test(s))

      expect(reached, path).toEqual([])
    }
  })
})

describe('the Copilot action', () => {
  it('imports from the data layer only by name, from the allow-list, never as a namespace', () => {
    const dbImports = importsOf(read(ACTION)).filter((i) => DB_SPECIFIER.test(i.specifier))

    expect(dbImports.length).toBeGreaterThan(0)
    for (const i of dbImports) {
      expect(i.namespace, `namespace import of ${i.specifier}`).toBe(false)
      if (i.typeOnly) continue
      for (const name of i.names) expect(ACTION_DB_ALLOW_LIST).toContain(name)
    }
  })

  it('authorises itself first', () => {
    const source = read(ACTION)
    expect(source).toMatch(/^\s*['"]use server['"]/m)
    expect(source).toContain('requireUser')
  })

  it('names no mutation other than the answer and its citations', () => {
    const source = read(ACTION)
    for (const name of FORBIDDEN_IN_AI_PATH) {
      expect(new RegExp(`\\b${name}\\b`).test(source), `${ACTION} names ${name}`).toBe(false)
    }
    expect(source).not.toMatch(/from\(\s*['"`]decisions['"`]\s*\)/)
  })
})

describe('the AI module and the pure core', () => {
  it('the AI module names no mutation and no Decision', () => {
    expect(aiFiles().length).toBeGreaterThan(0)
    for (const { path, source } of aiFiles()) {
      for (const name of FORBIDDEN_IN_AI_PATH) {
        expect(new RegExp(`\\b${name}\\b`).test(source), `${path} names ${name}`).toBe(false)
      }
    }
  })

  it('the pure Copilot core imports neither the data layer, Supabase nor the AI module', () => {
    const reached = importsOf(read(CORE))
      .map((i) => i.specifier)
      .filter((s) => DB_SPECIFIER.test(s) || /supabase|(^|\/)ai(\/|$)|server-only/.test(s))

    expect(reached).toEqual([])
  })

  it('no AI path renders model output as HTML', () => {
    const rendering = files
      .filter(({ source }) => /dangerouslySetInnerHTML/.test(source))
      .map(({ path }) => path)

    expect(rendering).toEqual([])
  })
})
