# Reflection — Sprint 2 Part 8

> **Scope of this file.** This is the Sprint 2 Part 8 reflection, carried into
> this repository with the NoteSpace code. It describes the Sprint 2 NoteSpace
> database, which is frozen. No Sprint 3 reflection has been written yet.
>
> Persistence has changed since: Sprint 3 does not use the NoteSpace database
> or a Sprint 3-specific Supabase project. It uses the canonical `gtm-stack-fit`
> Supabase database of the Revenue Operating Intelligence platform, whose
> migrations live only in the `gtm-stack-fit` repository
> (`gtm-stack-fit/docs/platform-persistence-design.md`). The ownership and RLS
> reasoning below carries over to that design.

The Part 5 review evidence that used to live in this file has moved to
[`docs/part5-review-evidence.md`](docs/part5-review-evidence.md).

## 1. Persistent storage: what I consulted on, and what I built

Authentication turned storage from a settled question into an ownership one.
That reframing is the decision. `localStorage` and `sessionStorage` suit
browser-only state; IndexedDB adds room and offline reads. But all leave the
data on one device, with no account attached and nothing a server can verify
when deciding whose rows are whose. Notes that must survive reloads and reach
the signed-in user anywhere belong server-side. Nothing is persisted in the
browser: notes live in Postgres, workspace state in the URL, the session in
cookies.

That left enforcement. I asked Claude Code to weigh filtering every query by the
signed-in user's id in application code against making the database enforce it,
and chose the database. The migration adds `user_id` to `collections`, `notes`
and `tags`, each referencing `auth.users(id)` with `on delete cascade`, and a
row level security policy on each compares it against `auth.uid()`. Application
code names the owner on insert only — the create functions in `app/lib/db.ts`
read the id from the verified session, never from client input — and reads carry
no user filter, since the policies restrict every statement to the caller's
rows. Isolation cannot be lost by forgetting a filter in one query. Two
decisions followed: `note_tags` got no `user_id`, a pairing's owner being
already a fact about its note and tag, and the Part 5 test rows were deleted
rather than reassigned to an arbitrary account.

## 2. An auth issue I caught and fixed

A security review of the authentication work found that the `/workspace` guard
protected rendering but not invocation. All eight mutation Server Actions —
creating notes, collections and tags, assigning a collection, adding and
removing tags — performed no identity check. A Server Action is a public POST
endpoint, not a page, so anyone holding an action id could have written data
without signing in. I added a `requireUser()` guard in
`app/lib/actions/require-auth.ts` and called it as the first statement in each
of the eight, ahead of input validation, so an unauthenticated caller reaches
neither the database nor the validation messages.

## 3. A prompt that was misread, and the redirection

I asked for the ownership migration as a script I could paste into the Supabase
SQL Editor. Claude Code returned it wrapped in explanatory prose, I copied the
whole reply, and Postgres answered `ERROR: 42601: syntax error at or near
"Here"`. The instruction had been read as "include the script in the response"
rather than "make the copyable block in the response be exactly the script". I
reported the error, and it was reissued as a single fenced block with every
explanation moved outside it. The lesson I took is that when output is meant to
be executed verbatim, the prompt has to say so — otherwise the helpful
surrounding commentary becomes part of what gets run.
