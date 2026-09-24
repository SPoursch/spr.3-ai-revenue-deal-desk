# Supabase Schema

> **Sprint 2 history — not the Sprint 3 schema.** This document describes the
> frozen Sprint 2 NoteSpace Supabase project (`notes-app-collections-search`)
> as it stood at the end of Sprint 2. It was carried into this repository with
> the NoteSpace code and is kept as reference for the ownership and RLS
> patterns only. None of these tables exists in the canonical `gtm-stack-fit`
> database that Sprint 3 uses, and neither this document nor
> `supabase/migrations/20260918120000_add_per_user_ownership.sql` may be
> applied to it. The Sprint 3 schema is defined in
> `gtm-stack-fit/docs/platform-persistence-design.md`.

Current state of the database for **Turing College BAI Sprint 2 — Notes App
with Collections and Search**, through Part 5 (schema), Part 6 (authentication)
and Part 8 (per-user ownership).

Every statement here has been verified against the live database. The ownership
columns, policies and indexes come from
`supabase/migrations/20260918120000_add_per_user_ownership.sql`.

## References

Official documentation used for the schema and database work in this project:

- Supabase — Tables and Data: https://supabase.com/docs/guides/database/tables
- Supabase — Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- supabase-js — JavaScript client reference: https://supabase.com/docs/reference/javascript/introduction
- supabase-js — Fetch data (`select`): https://supabase.com/docs/reference/javascript/select

Per CLAUDE.md, Supabase-specific queries are written against the official Supabase
documentation rather than from memory.

## Project

| | |
|---|---|
| Supabase project name | `notes-app-collections-search` |
| Access method | `supabase-js` |
| Supabase MCP server | Not configured — schema changes are applied by hand in the Supabase SQL editor / dashboard |

## Tables created so far

### `notes`

Stores each note document. Verified against the Supabase dashboard.

| Column | Type | Default | Nullable | Notes |
|---|---|---|---|---|
| `id` | `uuid` | `gen_random_uuid()` | no | Primary key |
| `title` | `text` | — | yes | Note title |
| `body` | `text` | — | yes | Note content |
| `created_at` | `timestamptz` | `now()` | no | Set by the database on insert |
| `updated_at` | `timestamptz` | — | yes | Null until the first update; set by the `notes_set_updated_at` trigger |
| `collection_id` | `uuid` | — | yes | `notes_collection_id_fkey` → `collections(id)` `on delete set null`. Null means the note sits outside every collection |
| `user_id` | `uuid` | `auth.uid()` | **no** | Owner. `notes_user_id_fkey` → `auth.users(id)` `on delete cascade`. Added in Part 8 |

This satisfies core requirement 2, which asks for a `notes` table storing at
minimum `id`, `title`, `body`, `created_at` and `updated_at`.

### Timestamp ownership

Postgres owns both timestamps. The application never writes either one.

- `created_at` is `not null` with a `now()` default, set on insert.
- `updated_at` is null until the row is first updated. A `before update` trigger
  sets it to `now()`, so a null value means "never edited" and both timestamps
  come from the same clock.

```sql
create or replace function public.notes_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger notes_set_updated_at
  before update on public.notes
  for each row
  execute function public.notes_set_updated_at();
```

An earlier revision of `app/lib/db.ts` wrote `updated_at` from the application
on both insert and update. That put the application clock and the database clock
into the same row, and because `updated_at` was then populated at creation time
its presence no longer indicated an edit — so the UI had to compare the two
timestamps against a two-second tolerance to guess. That comparison was wrong in
both skew directions: a fast application clock labelled every new note "Edited",
a slow one labelled real edits "Created". Moving both timestamps onto the
database clock removes the comparison entirely.

When this change was applied, `updated_at` was set back to null for all existing
rows. Those were Part 5 CRUD test notes and are deliberately treated as never
edited; the old column value did not distinguish edited from unedited rows, so
it carried nothing worth preserving.

## Ownership

Added in Part 8 by `supabase/migrations/20260918120000_add_per_user_ownership.sql`.

| Table | Ownership column | Foreign key | On delete | Index |
|---|---|---|---|---|
| `collections` | `user_id uuid not null default auth.uid()` | `collections_user_id_fkey` → `auth.users(id)` | `cascade` | `collections_user_id_idx` |
| `notes` | `user_id uuid not null default auth.uid()` | `notes_user_id_fkey` → `auth.users(id)` | `cascade` | `notes_user_id_idx` |
| `tags` | `user_id uuid not null default auth.uid()` | `tags_user_id_fkey` → `auth.users(id)` | `cascade` | `tags_user_id_idx` |
| `note_tags` | **none — derived** | — | — | — |

`on delete cascade` means deleting an account removes its data rather than
leaving rows pointing at a user that no longer exists.

The `default auth.uid()` is a backstop, not the mechanism. The application sends
`user_id` explicitly — `createNote`, `createCollection` and `createTag` in
`app/lib/db.ts` read it from the verified session through `requireUserId()`. The
default only means a write path that forgot would still produce a correctly
owned row instead of a constraint violation. It cannot be used to forge
ownership, because the `with check` clauses below reject any row whose `user_id`
is not the caller.

The indexes exist because every policy filters on `user_id` and Postgres does
not index a foreign key column automatically; without them each read would be a
sequential scan with the policy applied per row.

### Why `note_tags` has no `user_id`

A pairing's owner is already a fact about its note and its tag. Storing it a
third time would be duplicated state that can drift out of agreement with the
rows it describes — a pairing whose `user_id` disagreed with its note's would be
both possible and meaningless. The policy derives ownership instead.

### Existing data

The Part 5/6 rows had no owner. Rather than assign them to an arbitrary account,
they were deleted before ownership was enforced — they were disposable CRUD
scratch data, and deleting them left no ambiguity about who owns what. The
migration's guard block raises and rolls the whole migration back if any row
still lacks an owner when it runs, so a half-applied ownership model cannot be
left behind. All four tables were empty immediately after the migration.

## Row Level Security

RLS is **enabled** on all four tables — `public.collections`, `public.notes`,
`public.tags` and `public.note_tags`.

### Policies in place

Exactly one policy per table. There are no other policies — no additional
permissive policies, and no restrictive ones. All four are `for all` and apply
to the **`authenticated`** role.

Postgres applies `using` to SELECT, UPDATE and DELETE, and `with check` to
INSERT and UPDATE, so a single `for all` policy covers all four operations:

| Operation | Clause | Effect |
|---|---|---|
| SELECT | `using` | only your rows are visible |
| INSERT | `with check` | the new row must be yours |
| UPDATE | both | you may only change your rows, and may not reassign one to another account |
| DELETE | `using` | you may only delete your rows |

| Table | Policy | `USING` | `WITH CHECK` |
|---|---|---|---|
| `collections` | `collections are private to their owner` | `(select auth.uid()) = user_id` | same |
| `notes` | `notes are private to their owner` | `(select auth.uid()) = user_id` | owner **and** the collection is yours |
| `tags` | `tags are private to their owner` | `(select auth.uid()) = user_id` | same |
| `note_tags` | `note_tags follow the ownership of their note` | the note is yours | the note **and** the tag are yours |

`(select auth.uid())` rather than a bare `auth.uid()`: the subquery form is
evaluated once per statement instead of once per row.

```sql
create policy "collections are private to their owner"
  on public.collections
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
```

### The `notes.collection_id` ownership constraint

`notes` carries a second condition on `with check`. `collection_id` is a foreign
key, and **foreign key validation does not consult RLS**, so without this a user
could file their own note inside another user's collection by supplying that id.
The `exists` runs under the collections policy above, so it can only ever see
collections the caller owns.

```sql
create policy "notes are private to their owner"
  on public.notes
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (
      collection_id is null
      or exists (
        select 1
        from public.collections c
        where c.id = notes.collection_id
          and c.user_id = (select auth.uid())
      )
    )
  );
```

### How `note_tags` ownership is enforced

`using` follows the note: its owner owns the pairing, so reading a note's tags
and removing one both follow note ownership. `with check` additionally requires
owning the tag, so a user cannot attach someone else's tag to their own note.

Keeping the tag check out of `using` is deliberate — it means a pairing is
always removable by the note's owner, rather than leaving a row that no one can
delete.

```sql
create policy "note_tags follow the ownership of their note"
  on public.note_tags
  for all
  to authenticated
  using (
    exists (
      select 1 from public.notes n
      where n.id = note_tags.note_id and n.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.notes n
      where n.id = note_tags.note_id and n.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.tags t
      where t.id = note_tags.tag_id and t.user_id = (select auth.uid())
    )
  );
```

### Where enforcement lives

The database, not the application. `app/lib/db.ts` names the owner on insert but
does **not** filter reads by user: the policies restrict every statement to the
caller's rows, so a bare `select` already returns only their data. Repeating the
filter in application code would duplicate the boundary in a second place where
the two could disagree.

The consequence, stated plainly: if these policies were dropped, the application
would stop isolating accounts. That is the intended design — one enforcement
point — not an oversight.

### Keys and secrets

`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` carries the `NEXT_PUBLIC_` prefix, which
marks a variable as client-exposed. At present nothing in client code references
it — both variables are read only by `app/lib/supabase.ts`, which is reached
solely from server code — so the key is not currently in the browser bundle.

A publishable (anon) key is designed to be public and is safe to expose,
provided RLS constrains what it can do. Since the `anon` role has no policy on
any of these tables, the key on its own now reaches no rows at all. A secret or
`service_role` key bypasses RLS completely and must **never** be placed in a
`NEXT_PUBLIC_` variable, or in any value reachable from client code.

## Scope of this document

**All four tables exist.** `collections`, `notes`, `tags` and `note_tags` are
created, carry ownership where it applies, and are covered by RLS.

| Table | Columns | Ownership |
|---|---|---|
| `collections` | `id`, `name`, `created_at`, `user_id` | own `user_id` |
| `notes` | `id`, `title`, `body`, `created_at`, `updated_at`, `collection_id`, `user_id` | own `user_id` |
| `tags` | `id`, `name`, `created_at`, `user_id` | own `user_id` |
| `note_tags` | `note_id`, `tag_id` | derived from the note and the tag |

Relationships between them:

- A collection contains many notes; a note belongs to zero or one collection,
  through `notes.collection_id` (`on delete set null`, so deleting a collection
  moves its notes out rather than deleting them).
- A note has many tags and a tag applies to many notes, through `note_tags`.
  Its composite primary key `(note_id, tag_id)` makes a duplicate pairing
  impossible, and both foreign keys cascade, so deleting a note or a tag removes
  only the pairings.
- Every collection, note and tag belongs to exactly one `auth.users` row.

This document is updated as each schema change lands.

## Tags

**Status: created and verified in Supabase.** The statements below were run by
hand in the Supabase SQL Editor (no MCP server is configured) and the result was
verified against the live database: both tables were reachable by `anon` at the
time (access is now restricted to each row's owner — see "Row Level Security"),
`id` and `created_at` take their defaults, `tags.name` rejects null (`23502`), the
composite primary key rejects a duplicate pairing (`23505`), an unknown
`tag_id` is rejected (`23503`), and both `on delete cascade` rules were
confirmed in each direction — deleting a tag or a note removes only the pairing
rows, never the row on the other side.

These satisfy core requirement 5: a `tags` table of names, and a `note_tags`
join table where each row connects one note to one tag.

### DDL to execute

```sql
-- 1. tags — names only, same column conventions as collections.
create table public.tags (
  id         uuid        not null default gen_random_uuid(),
  name       text        not null,
  created_at timestamptz not null default now(),
  constraint tags_pkey primary key (id)
);

-- 2. note_tags — one row per (note, tag) pair.
-- The composite primary key makes a duplicate pairing impossible at the
-- database level, so the application never has to de-duplicate.
-- Both foreign keys cascade: deleting a note or a tag removes only the
-- pairings, never the row on the other side.
create table public.note_tags (
  note_id uuid not null,
  tag_id  uuid not null,
  constraint note_tags_pkey primary key (note_id, tag_id),
  constraint note_tags_note_id_fkey foreign key (note_id)
    references public.notes (id) on delete cascade,
  constraint note_tags_tag_id_fkey foreign key (tag_id)
    references public.tags (id) on delete cascade
);

-- 3. Row Level Security. Tables created through the SQL Editor do not get RLS
-- enabled automatically, unlike dashboard-created tables, so this is explicit.
alter table public.tags      enable row level security;
alter table public.note_tags enable row level security;

-- 4. One permissive anon policy per table, matching notes and collections.
create policy "anon full access to tags"
  on public.tags
  for all
  to anon
  using (true)
  with check (true);

create policy "anon full access to note_tags"
  on public.note_tags
  for all
  to anon
  using (true)
  with check (true);
```

The two `create policy` statements above are the Part 5 originals, kept as the
record of what was executed at the time. **They no longer exist.** Part 6 moved
them from `anon` to `authenticated`, and Part 8 dropped them by name and
replaced them with the ownership policies. See "Row Level Security" above for
the current state, which is what the live database now has. The `create table`
statements are still accurate apart from the `user_id` column added in Part 8.

### Verification queries

```sql
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name in ('tags', 'note_tags')
order by table_name, ordinal_position;

select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('tags', 'note_tags');

select conname, contype, confdeltype
from pg_constraint
where conrelid = 'public.note_tags'::regclass;
```

Expect: four columns on `tags` (`user_id` was added in Part 8) and two on
`note_tags`, all `not null`; exactly one `ALL`/`{authenticated}` policy per
table, now comparing `auth.uid()` rather than `true`; and on `note_tags` a
primary key plus two foreign keys with `confdeltype = 'c'` (cascade).

### Notes on this design

- `tags.name` has **no unique constraint**. Requirement 5 does not ask for one,
  and adding it would make "create a tag that already exists" a database error
  the UI would have to translate. Duplicate names are therefore possible.
- No index beyond the two primary keys. The `note_tags` primary key already
  indexes `(note_id, tag_id)`, which covers looking a note's tags up; the
  reverse direction (tag to notes) is unindexed and would matter only for the
  tag filtering in requirement 10.
- Tags are per-user, so two accounts may each have a tag of the same name
  without either seeing the other's. Combined with the missing unique
  constraint, one account can also hold two tags of the same name.
- `note_tags` needs no index for ownership: its policy looks rows up by
  `notes.id` and `tags.id`, both primary keys.

## Tag filtering and search add no schema

Core requirements 10 (tag filtering) and 11 (search) are implemented without any
database change — no columns, no indexes, no full-text search configuration.

Both operate in memory in `app/workspace/page.tsx` on rows that request has already
loaded: `listNotes()`, `listCollections()`, `listTags()` and `listTagsByNote()`
run once per request, and the collection filter, the AND-combined tag filter and
the search are then applied to those arrays. Selected filters live in the URL
(`collection`, `tag`, `q`), so no query runs per keystroke and no query runs per
note.

Search covers a note's **title, its body, and each of its tag names**. Tag names
are included as the project's optional feature: it means one box finds a note
either by what it says or by how it is labelled, without having to locate the
tag in the sidebar filter. Requirement 11 asks only for titles and bodies, so
this is a superset of it, and the sidebar filter remains the precise way to
narrow by tag because it combines selected tags with AND.

Each field is matched separately rather than concatenated into one string. A
joined haystack would report a match for a query that merely spans the boundary
between two fields — "test reference" hitting a note whose body ends "test" and
whose first tag is "reference", a phrase present in neither. Matching per field
keeps substring search inside each value.

This is deliberate at this project's scale. It would stop being appropriate once
the note count outgrows a single request payload, at which point the honest
alternatives are `ilike` or `textSearch` filters pushed into Postgres for
requirement 11, an index on `note_tags(tag_id)` for the tag-to-notes direction,
and pagination. None of that is warranted yet, and adding it now would be
speculative.

## Not yet decided

- Indexes are recorded here once they are deliberately chosen. None have been added
  beyond the primary keys.
