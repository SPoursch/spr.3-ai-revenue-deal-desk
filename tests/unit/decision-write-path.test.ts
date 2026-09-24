import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Guards the single human write path for Decisions (CLAUDE.md: the AI must
 * never create a Decision; platform-persistence-design.md: "enforced by
 * separate tables, a single human-submitted write path, the AI module never
 * importing it, and an automated test").
 *
 * The test reads the application source rather than importing it, so it
 * needs no database and catches a new caller before it ever runs. Every file
 * that names `recordDecision` or inserts into `decisions` must be on the
 * allow-list below. Adding a caller — the Server Action behind the decision
 * form, for example — means adding it here deliberately; no AI module file
 * may ever be added.
 */

// Vitest runs from the repository root.
const ROOT = process.cwd()
const APP = join(ROOT, 'app')

/** The files allowed to reach the Decision write path. */
const ALLOWED_CALLERS = ['app/lib/db/decisions.ts', 'app/lib/db/index.ts']

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

describe('the Decision write path', () => {
  it('is reached only from the allow-listed files', () => {
    const callers = files
      .filter(({ source }) => /\brecordDecision\b/.test(source))
      .map(({ path }) => path)
      .sort()

    expect(callers).toEqual([...ALLOWED_CALLERS].sort())
  })

  it('is the only place that queries the decisions table', () => {
    const queriers = files
      .filter(({ source }) =>
        /from\(\s*(['"`])decisions\1\s*\)|DECISIONS_TABLE\s*=/.test(source),
      )
      .map(({ path }) => path)

    expect(queriers).toEqual(['app/lib/db/decisions.ts'])
  })
})
