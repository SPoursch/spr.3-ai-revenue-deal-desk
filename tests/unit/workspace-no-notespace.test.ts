import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * /workspace is the Sprint 3 AI Revenue Deal Desk. CLAUDE.md: the inherited
 * NoteSpace product is reference material only and does not appear in the
 * Sprint 3 UI, and no NoteSpace table exists in the canonical database — so a
 * NoteSpace query from this route can only fail.
 *
 * The test reads the route's source rather than rendering it, so it needs no
 * browser and no database. It covers every file under app/workspace/, the
 * layout included, and fails if any of them reaches NoteSpace data access or
 * a NoteSpace component, or names the old product.
 */

// Vitest runs from the repository root.
const ROOT = process.cwd()
const WORKSPACE = join(ROOT, 'app', 'workspace')

/** The NoteSpace data-access functions, as exported from app/lib/db. */
const NOTESPACE_DATA_ACCESS = [
  'listNotes',
  'listCollections',
  'listTags',
  'listTagsByNote',
  'listTagsForNote',
  'getNote',
  'createNote',
  'updateNote',
  'deleteNote',
]

/** The NoteSpace components in app/components/. */
const NOTESPACE_COMPONENTS = [
  'CollectionSidebar',
  'NoteList',
  'NoteCard',
  'SelectedNote',
  'TagFilter',
  'HelpLauncher',
  'BrandHeader',
  'NewNoteForm',
  'NoteForm',
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

const files = sourceFiles(WORKSPACE).map((path) => ({
  path: relative(ROOT, path).split(sep).join('/'),
  source: readFileSync(path, 'utf8'),
}))

function offenders(pattern: RegExp): string[] {
  return files.filter(({ source }) => pattern.test(source)).map(({ path }) => path)
}

describe('/workspace does not depend on NoteSpace', () => {
  it('has a page and a layout to check', () => {
    expect(files.map(({ path }) => path).sort()).toEqual(
      expect.arrayContaining(['app/workspace/layout.tsx', 'app/workspace/page.tsx']),
    )
  })

  it.each(NOTESPACE_DATA_ACCESS)('never calls %s', (name) => {
    expect(offenders(new RegExp(`\\b${name}\\b`))).toEqual([])
  })

  it.each(NOTESPACE_COMPONENTS)('never renders %s', (name) => {
    expect(offenders(new RegExp(`\\b${name}\\b`))).toEqual([])
  })

  it('does not import the NoteSpace workspace URL helpers or action state', () => {
    expect(offenders(/lib\/workspace-url|note-action-state|actions\/(notes|collections|tags)/)).toEqual(
      [],
    )
  })

  it('does not name the old product', () => {
    expect(offenders(/NoteSpace/)).toEqual([])
  })

  it('identifies the product as the AI Revenue Deal Desk', () => {
    expect(offenders(/AI Revenue Deal Desk/)).toContain('app/workspace/page.tsx')
  })
})
