# AI Revenue Deal Desk — Sprint 3

Turing College *Build with AI*, Sprint 3.

An AI-powered revenue decision workspace. It consolidates the commercial
context of a deal, identifies exceptions and risks, and helps revenue teams
understand what requires attention and why. The Deal is the atomic business
object; the AI understands, detects, explains and prepares, and **humans make
every decision**. It is not a CRM, not a CLM and not a generic chatbot.

## Status

**The Deal Desk data foundation is implemented; the Deal Desk UI is not yet.**
Done so far:

- the domain Index — [`docs/sprint-3-domain-index.md`](docs/sprint-3-domain-index.md)
- the engineering guide — [`CLAUDE.md`](CLAUDE.md)
- the Deal Intelligence table design, held in the canonical platform
  persistence design (see below)
- the Deal Desk data-access layer (`app/lib/db/`): accounts, deals, evidence,
  provisions, AI findings, exceptions and human Decisions, with unit and
  integration tests
- a Deal Desk landing page at `/workspace`

There is no Deal Desk UI, Server Action or AI module yet. The inherited Sprint 2
NoteSpace code (notes, collections, tags) is still in the repository as
reference material for patterns only; it is not reachable from `/workspace`.

## Where this fits

The Deal Desk is the current, bounded implementation slice of the
**Revenue / Deal Intelligence** domain of a destination platform,
**Revenue Operating Intelligence**. The platform's other domain,
**Technology / Stack Intelligence**, is GTM Stack Fit in the sibling
`gtm-stack-fit` repository. The broader platform (SaaS spend, agent
operations, cross-domain analytics, procurement, …) is future architecture
and is **not** being built in Sprint 3.

## Database

- Sprint 3 uses the hosted **`gtm-stack-fit`** Supabase project, the single
  canonical database of the platform. There is no separate Sprint 3 Supabase
  project.
- **Every migration for that database lives in
  `gtm-stack-fit/supabase/migrations/`.** This repository owns no migration for
  it and never applies one.
- Canonical schema, ownership and RLS:
  `gtm-stack-fit/docs/platform-persistence-design.md`.
- The Sprint 2 NoteSpace Supabase project is frozen and is not used or
  modified by Sprint 3.
- [`docs/supabase-schema.md`](docs/supabase-schema.md) and
  `supabase/migrations/20260918120000_add_per_user_ownership.sql` are Sprint 2
  history. [`docs/sprint-3-schema-design.md`](docs/sprint-3-schema-design.md)
  is a superseded proposal kept as a record.

## Sprint 3 deliverable

- A secured, authenticated application
- The Deal Desk domain slice: accounts, deals (with renewal lineage),
  evidence and excerpts, provisions, exceptions, AI findings, human decisions,
  actions, outcomes
- A real LLM through OpenRouter, called server-side only
- AI core functionality with cited evidence, and retrieval where required
- Persistence with owner-scoped row level security
- Automated functional and security tests
- Deployment and security verification
- The required ai-code-reviewer PR / review

## Inherited foundation (from Sprint 2)

Reused unchanged for the Deal Desk:

- Supabase Auth: email and password, self-service sign-up, Google sign-in,
  password reset, a profile menu with sign-out
- Server-verified sessions (`getClaims()`), a server-side guard on every
  `/workspace` page, and a self-authorising check in every Server Action
- A single data-access module (`app/lib/db/`) and a per-request server
  client
- Ownership taken from the verified session only; row level security as the
  enforcement layer; nothing persisted in the browser

## Tech stack

- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4
- Supabase — Postgres and Supabase Auth, via `@supabase/supabase-js` and
  `@supabase/ssr`
- OpenRouter (planned, server-side)
- Playwright for functional tests (planned; not installed yet)

## Local setup

```bash
npm install
cp .env.local.example .env.local   # then fill in the two values below
npm run dev
```

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL of the canonical `gtm-stack-fit` Supabase project |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Its **publishable** key |

Use the publishable key only; never put a secret or `service_role` key in a
`NEXT_PUBLIC_` variable. `.env.local` is git-ignored and never committed.

After sign-in, `/workspace` shows the Deal Desk landing page; it reads no
table. Sign-in additionally depends on the canonical project's Auth settings
(Site URL, `/auth/callback` and `/auth/confirm` in the redirect allow-list,
Google provider) being configured for this application.

Other scripts: `npm run build`, `npm run start`, `npm run lint`, and
`npm test` (Vitest). The integration tests sign in two test users on the
hosted canonical database, so `npm test` also needs `.env.test.local` with
`DEAL_DESK_TEST_USER_A_EMAIL`, `DEAL_DESK_TEST_USER_A_PASSWORD` and the same
two for user B, plus network access.

## Project notes

- [`CLAUDE.md`](CLAUDE.md) — how work is done: scope, architecture, auth,
  tenancy, AI, testing and workflow rules
- [`docs/sprint-3-domain-index.md`](docs/sprint-3-domain-index.md) — Deal
  Intelligence domain model and resolved decisions U1–U15
- [`REFLECTION.md`](REFLECTION.md) — the Sprint 2 Part 8 reflection (no
  Sprint 3 reflection yet)
- [`docs/part5-review-evidence.md`](docs/part5-review-evidence.md),
  [`docs/part8-password-reset-validation.md`](docs/part8-password-reset-validation.md)
  — Sprint 2 evidence
