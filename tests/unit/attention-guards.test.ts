import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Feature 7: Attention / Renewal Intelligence V1 — source guards for the
 * read-only, deterministic contract (docs/sprint-3-domain-index.md §10).
 *
 * Like tests/unit/copilot-guards.test.ts, these read the application source
 * rather than importing it, so a violation is caught before it runs.
 *
 * - Attention imports no AI or Copilot code: it is deterministic only.
 * - Attention names no data-layer write and writes to no table directly.
 * - No Server Action exists for Attention, and nothing in it posts a form.
 * - The pure module imports neither the data layer nor Supabase.
 */

const ROOT = process.cwd()

/** The Attention production code. */
const ATTENTION_FILES = [
  'app/lib/deal-desk/attention.ts',
  'app/workspace/attention/page.tsx',
  'app/components/deal-desk/AttentionList.tsx',
]
const PURE_MODULE = 'app/lib/deal-desk/attention.ts'

function read(path: string): string {
  const full = join(ROOT, path)
  expect(existsSync(full), `${path} exists`).toBe(true)
  return readFileSync(full, 'utf8')
}

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

/** Every module specifier a source imports, statically or dynamically. */
function specifiersOf(source: string): string[] {
  return [
    ...source.matchAll(/import\s+(?:type\s+)?[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/(?:import\s*\(|^\s*import\s+)['"]([^'"]+)['"]/gm),
  ].map((match) => match[1])
}

/**
 * The data layer's write functions, read from its own exports, so a write
 * added there later is guarded here too.
 */
function dataLayerWrites(): string[] {
  const index = read('app/lib/db/index.ts')
  const names = [...index.matchAll(/^\s+(\w+),?$/gm)].map((match) => match[1])
  return names.filter((name) => /^(create|update|delete|add|remove|record|upsert)[A-Z]/.test(name))
}

describe('Attention is deterministic: no AI', () => {
  it('imports no AI or Copilot code', () => {
    for (const path of ATTENTION_FILES) {
      const reached = specifiersOf(read(path)).filter((s) => /(^|\/)lib\/ai(\/|$)|(^|\/)ai\/|copilot/i.test(s))
      expect(reached, path).toEqual([])
    }
  })

  it('names no model provider or provider key', () => {
    for (const path of ATTENTION_FILES) {
      expect(read(path), path).not.toMatch(/openrouter|OPENROUTER_|COPILOT_|askCopilot|getCopilotProvider/i)
    }
  })
})

describe('Attention is read-only', () => {
  it('names no data-layer write', () => {
    const writes = dataLayerWrites()
    // The guard is only meaningful if it found the data layer's writes.
    expect(writes).toEqual(expect.arrayContaining(['createDeal', 'updateDeal', 'createException', 'recordDecision']))

    for (const path of ATTENTION_FILES) {
      const source = read(path)
      for (const name of writes) {
        expect(new RegExp(`\\b${name}\\b`).test(source), `${path} names ${name}`).toBe(false)
      }
    }
  })

  it('writes to no table directly and reaches no Supabase client', () => {
    for (const path of ATTENTION_FILES) {
      const source = read(path)
      expect(source, path).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/)
      expect(source, path).not.toMatch(/getSupabaseClient|createClient|service_role/)
    }
  })

  it('has no Server Action and posts no form', () => {
    for (const path of ATTENTION_FILES) {
      const source = read(path)
      expect(source, path).not.toMatch(/^\s*['"]use server['"]/m)
      expect(source, path).not.toMatch(/<form\b|formAction|useActionState/)
    }
    // No Server Action module reaches Attention.
    const actions = sourceFiles(join(ROOT, 'app/lib/actions')).map((path) => ({
      path: repoPath(path),
      source: readFileSync(path, 'utf8'),
    }))
    expect(actions.length).toBeGreaterThan(0)
    for (const { path, source } of actions) {
      expect(specifiersOf(source).some((s) => /deal-desk\/attention|AttentionList|workspace\/attention/.test(s)), path).toBe(
        false,
      )
    }
  })
})

describe('the pure attention module', () => {
  it('imports neither the data layer nor Supabase, only domain types', () => {
    const specifiers = specifiersOf(read(PURE_MODULE))
    expect(specifiers.filter((s) => /(^|\/)db(\/|$)|supabase|server-only/.test(s))).toEqual([])
    expect(specifiers).toEqual(['./domain'])
  })

  it('never reads the clock itself: the current time is passed in', () => {
    const source = read(PURE_MODULE)
    expect(source).not.toMatch(/new Date\(\s*\)|Date\.now\(/)
  })
})
