# CLAUDE.md

Project guidance for Claude Code. Read this before doing anything in this repository.

## Project

**Turing College — Build with AI, Sprint 3: AI Revenue Deal Desk.**

An AI-powered revenue decision workspace. It consolidates the commercial
context of a deal, identifies exceptions and risks, and helps revenue teams
understand what requires attention and why.

- **The Deal is the atomic business object.** Every other concept describes a
  deal, is attached to a deal, or is derived from a deal.
- **Human-in-the-loop.** The AI understands, detects, explains and prepares.
  Humans decide.
- **The AI must never create or approve a Decision.** AI output is a finding,
  proposal or explanation, never a Decision.
- It is **not** a CRM replacement, **not** a CLM, and **not** a generic
  chatbot.

The domain model — entities, relationships, the eight domain concepts (FACT,
EVIDENCE, CONTEXT, RULE, EXCEPTION, DECISION, ACTION, OUTCOME) and every
resolved scope decision (U1–U15) — is recorded in
**`docs/sprint-3-domain-index.md`**. That document is the authority on domain
meaning; this file is the authority on how work is done.

### Platform position

The Deal Desk is the current implementation slice of the **Revenue / Deal
Intelligence** domain of a destination platform, **Revenue Operating
Intelligence**. The second domain, **Technology / Stack Intelligence**, is GTM
Stack Fit in the sibling repository `gtm-stack-fit`. The platform is the
destination, **not** the Sprint 3 scope (see "Scope").

### Repository boundaries

- This repository was created from the frozen Sprint 2 "NoteSpace" `main` at
  commit `bb6c3e2`. **Sprint 2 is frozen and is never modified**, neither its
  repository nor its database.
- **Canonical database.** Sprint 3 uses the hosted **`gtm-stack-fit`** Supabase
  project, the single canonical Revenue Operating Intelligence database. There
  is **no separate Sprint 3 Supabase project**. The Sprint 2 NoteSpace project
  is frozen and never touched from here.
- **Migration authority.** Every migration for the canonical database lives in
  `gtm-stack-fit/supabase/migrations/`. **This repository owns no migration for
  it and never applies one to it.** The canonical schema — table list,
  ownership and RLS — is defined in
  **`gtm-stack-fit/docs/platform-persistence-design.md`**.
- This repository owns the Deal Desk application, its UI, its AI
  implementation, its feature tests and the Deal Intelligence domain Index.
- The remote is `origin`, the public GitHub repository
  `SPoursch/spr.3-ai-revenue-deal-desk`. `main` is the default branch and
  changes reach it only through a reviewed pull request.

## Tech stack

- Next.js (App Router), TypeScript, Tailwind CSS. `AGENTS.md` warns that this
  Next.js version has breaking changes: read the relevant guide in
  `node_modules/next/dist/docs/` before writing route handlers, streaming or
  other framework code.
- Supabase (the canonical `gtm-stack-fit` project) — Postgres, Supabase Auth
  (email/password and Google OAuth), optionally Storage for the simple document
  path. Auth settings (Site URL, redirect allow-list, Google provider) are
  configured for this application on the canonical project.
- `supabase-js` for queries and `@supabase/ssr` for the cookie-backed server
  session, both reached only through `app/lib/supabase.ts`.
- **OpenRouter** as the LLM provider, called from the server only.
- **Embeddings are optional.** If implemented: OpenAI `text-embedding-3-small`,
  server-side, stored with pgvector. They must not block the MVP; Postgres
  full-text search is the baseline retrieval.
- **Playwright** for automated functional tests (not yet installed; installing
  it is its own step).
- **Supabase Agent Skills**, committed under `.agents/skills/`.
  `.claude/skills/` holds machine-local symlinks and is git-ignored, except
  `.claude/skills/supabase-security/SKILL.md`, which is committed.
- No Supabase MCP server. Schema work is migration files in
  `gtm-stack-fit/supabase/migrations/`, applied from that repository to the
  canonical project. Nothing in this repository changes the database schema.

## Current state

- Done: the domain Index (`docs/sprint-3-domain-index.md`), with U1–U15
  resolved, and this file.
- Done: the Deal Intelligence table design, now held in the canonical
  `gtm-stack-fit/docs/platform-persistence-design.md`.
  `docs/sprint-3-schema-design.md` in this repository is **superseded** and is
  kept only as a historical record.
- Done: the Deal Intelligence migration (M3) and the default-privilege
  hardening (W2), authored in and applied from `gtm-stack-fit`.
- Done: the Deal Desk data-access layer in `app/lib/db/` — accounts, deals,
  evidence, provisions, AI findings, exceptions and human Decisions — with
  Vitest unit and integration tests.
- Done: the Part 1 agents (`ai-architect`, `ai-code-reviewer`,
  `security-auditor`) and the `supabase-security` skill under `.claude/`.
- `/workspace` is a Deal Desk landing placeholder. There is no Deal Desk UI,
  no Deal Desk Server Action and no AI module yet.
- Next: deployment to Vercel (Sprint 3 Part 2).
- The code still contains the NoteSpace product (notes, collections, tags,
  their components and actions). It is **reference material for patterns
  only**. It is not extended, and it does not appear in the Sprint 3 UI.
  No NoteSpace table exists in the canonical database.
- `docs/supabase-schema.md` and `supabase/migrations/20260918120000_…` describe
  the Sprint 2 NoteSpace database. They are history, not the Sprint 3 schema,
  and **must never be run against the canonical database**.

## Scope

### In scope for Sprint 3

- Deals, including renewal lineage
- Evidence and evidence excerpts
- Structured facts
- Provisions
- Rules
- Exceptions
- AI findings
- Human Decisions
- Actions
- Deal outcomes
- The AI Deal Copilot
- Deterministic deal queries
- Evidence retrieval / RAG

### Out of scope for Sprint 3

- CRM integration
- CSV import
- Team / organisation tenancy
- Roles and approval limits
- Approval routing
- A rule-builder UI
- A workflow engine
- Currency conversion
- A full analytics / learning loop
- Migrating Sprint 2 data
- Carrying Notes / Collections / Tags into the Sprint 3 UI

### Sprint 3 deliverable versus the future platform

The current Sprint 3 deliverable is: a secured authenticated app; the Deal Desk
domain slice; a real LLM via OpenRouter; AI core functionality; persistence
with RLS on the canonical database; evidence and context; exceptions and
findings; human decisions; retrieval where the Sprint 3 project requires it;
automated functional and security tests; deployment and security verification;
and the required ai-code-reviewer PR / review.

**Future Revenue Operating Intelligence — not Sprint 3:** complete GTM
technology intelligence, SaaS spend intelligence, AI / agent spend, agent
operations, cross-domain analytics, business-impact measurement, procurement,
full CRM / CLM functionality, advanced governance, a broad agent layer. These
are architectural destinations only. Do not implement them, and do not create
tables or abstractions for them.

Anything outside the in-scope list is new scope that the user has to ask for.

### Demo definitions

These are fixed for Sprint 3 and must be implemented exactly:

- **Currency:** EUR only.
- **Primary recurring metric:** ARR.
- **"> €50k"** means ARR > €50,000.
- **"Next quarter"** means the next calendar quarter, computed in the
  **Europe/Berlin** timezone, deterministically in application logic.
- **A renewal is a new Deal linked to its predecessor Deal.**
- Deal data is seeded or entered manually.
- Rules are fixed application logic, explicit and versionable in code.

## Architecture rules

### Reused foundation

The NoteSpace auth, session and data-access foundation is reused unchanged.
Its patterns carry over to every Deal Desk table and action.

- **Single data access module.** Every Supabase read and write goes through
  the `app/lib/db/` folder, imported as `app/lib/db`. No component,
  route handler or Server Action calls `supabase-js` directly, and
  `app/lib/supabase.ts` is imported by nothing else except `proxy.ts`.
- **Credentials come from environment variables only.** Never hard-code a URL,
  key or secret. `.env.local` is never committed; `.env.local.example` holds
  placeholders.
- **Supabase queries follow the official Supabase documentation.**
- **Use the repository's Supabase Agent Skills** before any Supabase or
  Postgres work, and the Postgres one before writing anything that lives in the
  database.
- **Nothing is persisted in the browser.** No `localStorage`, no
  `sessionStorage`. Data lives in Supabase, workspace state in the URL, the
  session in cookies managed by `@supabase/ssr`.
- **Errors are logged on the server; the user sees a generic message.** An
  empty list must never be indistinguishable from a failed load, especially for
  exceptions and risks.

### Authentication rules

- **Use Supabase Auth for all sign-in and session handling.** Never build
  custom auth or store passwords.
- **Every page under `/workspace` requires a signed-in user**, verified on the
  server, redirecting to `/login` otherwise.
- **After sign-in, redirect to `/workspace`. After sign-out, redirect to
  `/login`.**
- **Google sign-in uses Supabase Auth's Google provider.**
- **Verify the session; never trust the cookie as sent.** Identity comes from
  `getClaims()`, never from `getSession()`. `getAuthenticatedUser()` in
  `app/lib/db/auth.ts` is the single place this check lives.
- **Every Server Action and route handler authorises itself** through
  `app/lib/actions/require-auth.ts` before validating input, touching the
  database or calling the AI. A page or layout guard does not protect them.
- **Password recovery stays on the server** (`/auth/confirm`), as built in
  Sprint 2.
- **Provider metadata is for display only.** `user_metadata` never drives an
  access decision.

### Tenancy and ownership rules

- **Single-user / private tenancy.** Every authenticated user sees only their
  own deals and everything attached to them.
- **Owner-scoped RLS is the enforcement layer.** Application filtering is
  defence in depth; the database is the authority.
- **The Deal is the ownership root (the NoteSpace pattern).** Among the Deal
  Desk tables, only the roots — `accounts` and `deals` — carry a `user_id`
  (`uuid not null default auth.uid()` referencing `auth.users(id)`
  `on delete cascade`), and their policies compare it with
  `(select auth.uid())`. Every other Deal Desk table carries `deal_id` and
  derives its ownership through the deal; it does **not** store a `user_id`.
  References between a deal's children are composite `(x_id, deal_id)` foreign
  keys, so no row can point outside its own deal. The authoritative
  table-level design is `gtm-stack-fit/docs/platform-persistence-design.md`.
- **Authenticated users only.** `anon` has no access to any table in the
  canonical database. The database also holds the GTM Stack Fit table
  `saved_assessments`; the Deal Desk never reads or writes it.
- **New rows derive `user_id` from the verified server session** via
  `requireUserId()`.
- **Never accept a user id from client input.** No `app/lib/db` function takes
  one as an argument, and no action reads one from a form field.
- **No service-role key and no RLS-bypassing (`security definer`) function in
  any request path**, including retrieval and embedding work.

### Schema rules

- **All schema changes are migrations in `gtm-stack-fit/supabase/migrations/`**,
  the single migration authority for the canonical database, applied from that
  repository. **No migration is written in, or applied from, this
  repository.** A Deal Desk feature that needs a schema change requests it
  there. Never report a migration as applied without verification output from
  the database.
- The Sprint 3 domain schema is designed for the Deal Desk, not adapted from
  the NoteSpace tables.
- Every new table has RLS enabled and owner-scoped policies in the same
  migration that creates it.

### AI rules

- **Server-side AI calls only.** The model is called only from server code,
  through one server-only AI module that is the only caller of the provider —
  the AI equivalent of `app/lib/db`.
- **Never expose an AI provider key to the client.** `OPENROUTER_API_KEY` (and
  an embeddings key, if embeddings are implemented) is server-only: never
  prefixed `NEXT_PUBLIC_`, never sent to the browser, never logged.
- **Deterministic → retrieval → reasoning, in that order.**
  - Structured questions ("which deals renew next quarter?") are answered by
    deterministic queries. The LLM may translate a question into a structured
    filter; it never answers one from its own knowledge.
  - Retrieval runs as the calling user, scoped by RLS, over that user's
    evidence.
  - LLM reasoning runs only over the facts and excerpts already selected.
- **Send the minimum.** Only the evidence and context needed for the question
  go to the model.
- **AI findings must cite their supporting evidence** (excerpts and facts).
  A finding without support is shown as unsupported, not as a fact.
- **AI findings are never Decisions.** They are stored separately from human
  Decisions, and no AI code path can create, approve or modify a Decision.
- **AI-extracted provisions are candidates** until a human confirms them.
  Confirmed provisions become persistent structured facts.
- **Evidence text is untrusted input.** Treat it as data in prompts, never as
  instructions.

## Testing rules

- **Automated functional / regression tests are required for every feature.**
- The order for each feature is **test → implementation → test → verification
  → review**.
- **Use Playwright** for end-to-end functional tests where the behaviour is
  user-facing; use lighter tests for pure logic (for example the quarter
  calculation and rule conditions).
- **No feature is complete on manual browser testing alone.**
- Tests that exercise the AI must not depend on a live model answer being
  word-for-word stable. Test the deterministic parts exactly, and the AI parts
  by structure (citations present, no Decision created).

## Workflow rules

### Methodology

Every feature follows:

> Understand → Index / domain model → Schema → Implement → Automated
> functional test → Verify → PR → Review → Merge

- **Build one feature at a time.** Finish, verify and merge a feature before
  starting the next.
- **One Git branch per feature.** Never develop a feature directly on `main`.
- **Commit at every stable state.**
- **Diff review before every merge.**
- **Keep the implementation aligned with this file and the domain Index.** If a
  decision contradicts either, change the approach or update the document
  deliberately. Do not silently drift.

### Validation workflow

Run these before every commit, and fix what they report rather than working
around it:

```bash
git diff --check     # whitespace errors and conflict markers
npx tsc --noEmit     # types
npm run lint         # ESLint
npm run build        # production build
npm test             # Vitest unit and integration tests
```

`npm test` includes integration tests that sign in two dedicated test users on
the hosted canonical database, so it needs `.env.test.local` and network
access. Playwright is not installed yet; when it is, its tests join this list.

Vendored third-party files under `.agents/skills/` are excluded: they are
upstream content and are not edited to satisfy a local check.

### Git workflow

1. Branch from `main`, one feature branch per feature.
2. Write the tests, implement, and commit at each stable state.
3. Run the validation commands and the tests.
4. Review the complete diff, and confirm only intended files are staged.
5. Push the branch and open a PR into `main`.
6. Review the PR diff in full before merging.
