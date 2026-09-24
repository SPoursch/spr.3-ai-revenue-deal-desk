import { getSupabaseClient } from '../supabase'
import { requireUserId } from './auth'
import { NotesDatabaseError } from './errors'

/**
 * NoteSpace data access: the `notes`, `collections`, `tags` and `note_tags`
 * tables inherited from Sprint 2.
 *
 * Reference material for patterns only (see CLAUDE.md, "Current state"). It is
 * not extended, and none of these tables exists in the canonical database.
 *
 * Ownership (Part 8). Every row belongs to one account, and row level security
 * is what enforces that — see supabase/migrations/20260918120000_add_per_user_
 * ownership.sql. The split of responsibilities here is deliberate:
 *
 * - Writes name their owner. The three create functions read the id from the
 *   verified session via `requireUserId()` and send it explicitly. No function
 *   in this module accepts a user id as an argument, so ownership cannot be
 *   supplied by a caller.
 * - Reads do not filter by user. They do not need to: the `authenticated`
 *   policies restrict every statement to the caller's own rows, so a bare
 *   `select` already returns only their data. Repeating the filter here would
 *   add a session lookup to each read and duplicate the boundary in a second
 *   place, where the two could disagree. The database is the single authority.
 * - Updates and deletes target a row by id and are narrowed by the same
 *   policies, so a row belonging to another account matches nothing. The
 *   existing "no row matched" return values already describe that outcome.
 *
 * The consequence worth stating plainly: if those policies were ever dropped,
 * this module would stop isolating accounts. That is the intended design — one
 * enforcement point, in the database — not an oversight.
 *
 * Query patterns follow the official supabase-js documentation:
 *   https://supabase.com/docs/reference/javascript/select
 *   https://supabase.com/docs/reference/javascript/insert
 */

const NOTES_TABLE = 'notes'
const COLLECTIONS_TABLE = 'collections'
const TAGS_TABLE = 'tags'
const NOTE_TAGS_TABLE = 'note_tags'

/**
 * The columns every `notes` query selects, defined once.
 *
 * Kept as a single constant so that adding a column cannot be applied to some
 * queries and missed in others: because results are asserted with `as Note`
 * rather than validated, a missing column would surface as an `undefined`
 * field at runtime instead of a compile error.
 */
const NOTE_COLUMNS = 'id, title, body, created_at, updated_at, collection_id'

/** The columns every `collections` query selects. See NOTE_COLUMNS. */
const COLLECTION_COLUMNS = 'id, name, created_at'

/** The columns every `tags` query selects. See NOTE_COLUMNS. */
const TAG_COLUMNS = 'id, name, created_at'

/**
 * Tag columns as an embedded resource on a `note_tags` row. PostgREST resolves
 * the `tags` relationship through the `note_tags.tag_id` foreign key.
 */
const EMBEDDED_TAG_COLUMNS = `tag_id, tags (${TAG_COLUMNS})`

/**
 * A row of the `notes` table, matching the schema verified in
 * docs/supabase-schema.md.
 *
 * `created_at` is `not null` with a database default. `updated_at` is null
 * until the row is first updated, when a database trigger sets it — so null
 * means "never edited". Titles and bodies are independently optional.
 *
 * `collection_id` is null when the note sits outside any collection, which is
 * the default for a newly created note. The foreign key uses `on delete set
 * null`, so deleting a collection moves its notes here rather than removing
 * them.
 */
export type Note = {
  id: string
  title: string | null
  body: string | null
  created_at: string
  updated_at: string | null
  collection_id: string | null
}

/**
 * A row of the `collections` table, matching the schema verified in
 * docs/supabase-schema.md. Every column is `not null`; `id` and `created_at`
 * have database defaults.
 *
 * There is no `updated_at`: renaming a collection is not part of Step 2, so
 * the column and its trigger were deliberately not created.
 */
export type Collection = {
  id: string
  name: string
  created_at: string
}

/**
 * A row of the `tags` table, matching the schema in docs/supabase-schema.md.
 * Every column is `not null`; `id` and `created_at` have database defaults.
 *
 * `name` has no unique constraint, so two tags may share a name.
 */
export type Tag = {
  id: string
  name: string
  created_at: string
}

/** Fields a caller may supply when creating a note. */
export type CreateNoteInput = {
  title?: string | null
  body?: string | null
  /** Omitted or null leaves the note outside every collection. */
  collection_id?: string | null
}

/** Fields a caller may supply when updating a note. Omitted keys are left alone. */
export type UpdateNoteInput = {
  title?: string | null
  body?: string | null
}

/**
 * Lists notes, newest first.
 *
 * Ordered by `created_at`, which is `not null`, rather than `updated_at`, which
 * is null for any note that has never been edited.
 *
 * Note: if row level security is enabled on `notes` without a matching policy,
 * this resolves to an empty array rather than an error.
 */
export async function listNotes(): Promise<Note[]> {
  const { data, error } = await getSupabaseClient()
    .from(NOTES_TABLE)
    .select(NOTE_COLUMNS)
    .order('created_at', { ascending: false })

  if (error) {
    throw new NotesDatabaseError('select', NOTES_TABLE, error)
  }

  return (data ?? []) as Note[]
}

/**
 * Reads a single note by id, or null when no such row is visible.
 *
 * Uses `.maybeSingle()` so a missing row is a null result rather than an error.
 */
export async function getNote(id: string): Promise<Note | null> {
  const { data, error } = await getSupabaseClient()
    .from(NOTES_TABLE)
    .select(NOTE_COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new NotesDatabaseError('select single', NOTES_TABLE, error)
  }

  return (data as Note | null) ?? null
}

/**
 * Creates a note and returns the stored row.
 *
 * Timestamps are left entirely to the database: `created_at` takes its `now()`
 * default and `updated_at` stays null until the first update. `.select()
 * .single()` is chained because supabase-js returns no rows from an insert
 * otherwise.
 */
export async function createNote(input: CreateNoteInput = {}): Promise<Note> {
  // Ownership is taken from the session, not from `input`: CreateNoteInput has
  // no user_id field, so a caller cannot supply one even by mistake.
  const userId = await requireUserId()

  const { data, error } = await getSupabaseClient()
    .from(NOTES_TABLE)
    .insert({
      title: input.title ?? null,
      body: input.body ?? null,
      collection_id: input.collection_id ?? null,
      user_id: userId,
    })
    .select(NOTE_COLUMNS)
    .single()

  if (error) {
    throw new NotesDatabaseError('insert', NOTES_TABLE, error)
  }

  return data as Note
}

/**
 * Updates a note and returns the stored row, or null when no row matched.
 *
 * `updated_at` is refreshed by a database trigger, not here. Keys omitted from
 * `input` are not sent, leaving those columns untouched; an input with no keys
 * at all is not an edit, so the row is returned unchanged.
 */
export async function updateNote(
  id: string,
  input: UpdateNoteInput,
): Promise<Note | null> {
  const patch: Record<string, string | null> = {}

  if ('title' in input) {
    patch.title = input.title ?? null
  }

  if ('body' in input) {
    patch.body = input.body ?? null
  }

  if (Object.keys(patch).length === 0) {
    return getNote(id)
  }

  const { data, error } = await getSupabaseClient()
    .from(NOTES_TABLE)
    .update(patch)
    .eq('id', id)
    .select(NOTE_COLUMNS)
    .maybeSingle()

  if (error) {
    throw new NotesDatabaseError('update', NOTES_TABLE, error)
  }

  return (data as Note | null) ?? null
}

/**
 * Deletes a note and returns the row that was removed, or null when no row
 * matched. `.select()` is chained so the caller can tell the two apart.
 */
export async function deleteNote(id: string): Promise<Note | null> {
  const { data, error } = await getSupabaseClient()
    .from(NOTES_TABLE)
    .delete()
    .eq('id', id)
    .select(NOTE_COLUMNS)
    .maybeSingle()

  if (error) {
    throw new NotesDatabaseError('delete', NOTES_TABLE, error)
  }

  return (data as Note | null) ?? null
}

/**
 * Lists collections alphabetically by name.
 *
 * Ordered by `name` rather than `created_at` because the sidebar presents them
 * as a browsable list; `name` is `not null`, so no null ordering applies.
 *
 * Note: as with `listNotes`, row level security without a matching policy
 * resolves to an empty array rather than an error.
 */
export async function listCollections(): Promise<Collection[]> {
  const { data, error } = await getSupabaseClient()
    .from(COLLECTIONS_TABLE)
    .select(COLLECTION_COLUMNS)
    .order('name', { ascending: true })

  if (error) {
    throw new NotesDatabaseError('select', COLLECTIONS_TABLE, error)
  }

  return (data ?? []) as Collection[]
}

/**
 * Creates a collection and returns the stored row.
 *
 * `id` and `created_at` are left to their database defaults. The name is
 * passed through as given: validation belongs to the calling Server Action,
 * matching how note content is handled.
 */
export async function createCollection(name: string): Promise<Collection> {
  const userId = await requireUserId()

  const { data, error } = await getSupabaseClient()
    .from(COLLECTIONS_TABLE)
    .insert({ name, user_id: userId })
    .select(COLLECTION_COLUMNS)
    .single()

  if (error) {
    throw new NotesDatabaseError('insert', COLLECTIONS_TABLE, error)
  }

  return data as Collection
}

/**
 * Assigns a note to a collection, or removes it from any collection when
 * `collectionId` is null. Returns the stored row, or null when no note matched.
 *
 * `collectionId` is a required parameter rather than an optional field on
 * `UpdateNoteInput` deliberately. An optional property cannot distinguish
 * "absent" from "present and undefined" unless `exactOptionalPropertyTypes` is
 * enabled, which it is not, so an accidental `undefined` would silently clear
 * the column. A required parameter makes both intents explicit: a string
 * assigns, null unassigns.
 *
 * Note that the `notes_set_updated_at` trigger fires on this update like any
 * other, so assigning a collection marks the note as edited.
 */
export async function setNoteCollection(
  noteId: string,
  collectionId: string | null,
): Promise<Note | null> {
  const { data, error } = await getSupabaseClient()
    .from(NOTES_TABLE)
    .update({ collection_id: collectionId })
    .eq('id', noteId)
    .select(NOTE_COLUMNS)
    .maybeSingle()

  if (error) {
    throw new NotesDatabaseError('update', NOTES_TABLE, error)
  }

  return (data as Note | null) ?? null
}

/**
 * Lists every tag alphabetically by name.
 *
 * Note: as with the other list functions, row level security without a
 * matching policy resolves to an empty array rather than an error.
 */
export async function listTags(): Promise<Tag[]> {
  const { data, error } = await getSupabaseClient()
    .from(TAGS_TABLE)
    .select(TAG_COLUMNS)
    .order('name', { ascending: true })

  if (error) {
    throw new NotesDatabaseError('select', TAGS_TABLE, error)
  }

  return (data ?? []) as Tag[]
}

/**
 * Lists the tags carried by one note, alphabetically.
 *
 * Reads through `note_tags` and embeds the joined `tags` row, so this is one
 * round trip rather than a lookup per pairing.
 */
export async function listTagsForNote(noteId: string): Promise<Tag[]> {
  const { data, error } = await getSupabaseClient()
    .from(NOTE_TAGS_TABLE)
    .select(EMBEDDED_TAG_COLUMNS)
    .eq('note_id', noteId)

  if (error) {
    throw new NotesDatabaseError('select', NOTE_TAGS_TABLE, error)
  }

  const rows = (data ?? []) as unknown as { tags: Tag | null }[]

  return rows
    .map((row) => row.tags)
    .filter((tag): tag is Tag => tag !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Lists every note-to-tag pairing at once, keyed by note id.
 *
 * Requirement 9 puts tags on every row of the list pane, so the alternative is
 * one `listTagsForNote` call per note. This keeps that to a single query, the
 * same reason notes are grouped by collection in memory rather than queried
 * per collection.
 */
export async function listTagsByNote(): Promise<Map<string, Tag[]>> {
  const { data, error } = await getSupabaseClient()
    .from(NOTE_TAGS_TABLE)
    .select(`note_id, ${EMBEDDED_TAG_COLUMNS}`)

  if (error) {
    throw new NotesDatabaseError('select', NOTE_TAGS_TABLE, error)
  }

  const rows = (data ?? []) as unknown as {
    note_id: string
    tags: Tag | null
  }[]
  const byNote = new Map<string, Tag[]>()

  for (const row of rows) {
    if (row.tags === null) {
      continue
    }

    const tags = byNote.get(row.note_id) ?? []
    tags.push(row.tags)
    byNote.set(row.note_id, tags)
  }

  for (const tags of byNote.values()) {
    tags.sort((a, b) => a.name.localeCompare(b.name))
  }

  return byNote
}

/**
 * Creates a tag and returns the stored row.
 *
 * `id` and `created_at` are left to their database defaults. The name is
 * passed through as given: validation belongs to the calling Server Action,
 * matching how note content and collection names are handled.
 */
export async function createTag(name: string): Promise<Tag> {
  const userId = await requireUserId()

  const { data, error } = await getSupabaseClient()
    .from(TAGS_TABLE)
    .insert({ name, user_id: userId })
    .select(TAG_COLUMNS)
    .single()

  if (error) {
    throw new NotesDatabaseError('insert', TAGS_TABLE, error)
  }

  return data as Tag
}

/**
 * Pairs a tag with a note.
 *
 * `upsert` rather than `insert` so that re-adding a tag the note already has
 * succeeds quietly instead of failing on the composite primary key. The
 * pairing is the desired end state either way.
 */
export async function addTagToNote(
  noteId: string,
  tagId: string,
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from(NOTE_TAGS_TABLE)
    .upsert(
      { note_id: noteId, tag_id: tagId },
      { onConflict: 'note_id,tag_id', ignoreDuplicates: true },
    )

  if (error) {
    throw new NotesDatabaseError('insert', NOTE_TAGS_TABLE, error)
  }
}

/**
 * Removes a tag from a note, leaving both the note and the tag itself intact.
 *
 * Returns whether a pairing was actually removed, so a caller can tell "no
 * longer tagged" from "was never tagged".
 */
export async function removeTagFromNote(
  noteId: string,
  tagId: string,
): Promise<boolean> {
  const { data, error } = await getSupabaseClient()
    .from(NOTE_TAGS_TABLE)
    .delete()
    .eq('note_id', noteId)
    .eq('tag_id', tagId)
    .select('note_id')

  if (error) {
    throw new NotesDatabaseError('delete', NOTE_TAGS_TABLE, error)
  }

  return (data ?? []).length > 0
}
