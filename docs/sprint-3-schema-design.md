# Sprint 3 Schema Design — AI Revenue Deal Desk (MVP)

> **SUPERSEDED — historical record only. Do not implement from this document.**
>
> This design targeted a separate Sprint 3 Supabase project ("project #2"),
> which no longer exists in the plan. Sprint 3 now uses the canonical
> `gtm-stack-fit` Supabase database (Domain Index, U15 revised), and every
> migration for it lives in `gtm-stack-fit/supabase/migrations/`.
>
> The **canonical persistence design** — table list, columns, ownership, RLS,
> grants, shared utilities and migration authority — is
> **`gtm-stack-fit/docs/platform-persistence-design.md`**. It carries over
> decisions C1–C8 below, with these adjustments: the target project;
> `default auth.uid()` on the `user_id` of `accounts` and `deals`; explicit
> grants to `authenticated` and none to `anon`; one shared
> `public.set_updated_at()`; the C8 version check run against the canonical
> project.
>
> The table count in §3 was miscounted as "11 domain tables + 2 join tables =
> 13". The twelve tables specified here are 10 domain tables + 2 join tables =
> **12**; the canonical database holds **13** tables in total, including the
> existing GTM Stack Fit table `saved_assessments`.
>
> Where this document and the canonical design differ, the canonical design
> wins.

Original status: **proposal, decisions C1–C8 settled.** No SQL has been written and no
migration exists. This document turns `docs/sprint-3-domain-index.md` into a
table-level design for Supabase project #2. It follows `CLAUDE.md` and the
Supabase Postgres best practices (`(select auth.uid())` in policies, indexed FK
and policy columns, `timestamptz`, `numeric` for money, `text` + check
constraints for enumerations).

Original target *(superseded — Sprint 3 now uses the canonical `gtm-stack-fit`
database)*: **Supabase project #2 only.** Project #1 (Sprint 2) is not touched, and
none of the NoteSpace tables (`notes`, `collections`, `tags`, `note_tags`)
exist in this schema.

---

## 1. Design principles

1. **Single-user tenancy with the NoteSpace ownership pattern (U1, C1).**
   - **Ownership roots:** `accounts` and `deals` are the only tables with a
     `user_id uuid not null references auth.users(id) on delete cascade`.
     **The Deal is the ownership root** for everything attached to it.
   - **Every other table derives its ownership** through its `deal_id`. It
     stores no `user_id`.
   - `user_id` on a new root row comes from `requireUserId()` on the server,
     never from client input.
2. **Every deal child carries `deal_id` directly**, including rows that also
   hang off another child (an excerpt carries both `evidence_item_id` and
   `deal_id`). Two rules keep that `deal_id` honest:
   - Each child table that is referenced by another has `unique (id, deal_id)`.
   - Every reference *between* children is a **composite foreign key**
     `(x_id, deal_id) → x(id, deal_id)`.

   The database therefore rejects any row that points at a record on a
   different deal. Since a deal has exactly one owner, a row can never reach
   another user's data. Every child policy is then one hop: *"my deal"*.
3. **UUID primary keys** (`uuid default gen_random_uuid()`), matching the
   NoteSpace convention and the uuid validation already in the action layer.
4. **Enumerations are `text` with a `check` constraint**, not Postgres enum
   types, so a later migration can extend them without `alter type`.
5. **Money is `numeric(14,2)` in EUR, and columns carry the unit in their name**
   (`arr_eur`). There is no currency column, because EUR is the only currency
   (U11).
6. **Source records are immutable.** Evidence, excerpts, citations and Decisions
   have no update policy. A correction is a new row.
7. **AI output and human records live in different tables.** Nothing in
   `ai_findings` is a Decision, and nothing in `decisions` is AI output.
8. **Rules are code (U3).** No table; rows reference a rule by `rule_key` and
   `rule_version`.
9. **Column-list `on delete set null (column)`** is used wherever a composite
   FK is optional, so deleting the referenced row nulls only the reference and
   never `deal_id` (C8).

### 1.1 RLS model

All policies are `to authenticated`; `anon` gets nothing. RLS is enabled in the
same migration that creates each table. No `security definer` function and no
service-role key is used anywhere in a request path.

**Root tables (`accounts`, `deals`)** — the NoteSpace owner check:

- `select` / `delete`: `using ((select auth.uid()) = user_id)`
- `insert`: `with check ((select auth.uid()) = user_id)`
- `update`: both `using` and `with check` as above
- Indexed on `user_id`.
- The references between roots (`deals.account_id`,
  `deals.predecessor_deal_id`) are composite FKs on `(…, user_id)`, because both
  roots own a `user_id`. That replaces the Sprint 2 `with check (exists …)`
  re-validation of an FK target, which exists because FK checks bypass RLS.

**Deal children (every other table)** — ownership derived through the deal:

- `select` / `delete`: `using (deal_id in (select id from public.deals where user_id = (select auth.uid())))`
- `insert`: the same expression as `with check`
- `update` (only on tables marked mutable): the same expression as both `using`
  and `with check`
- Indexed on `deal_id` (or a composite index starting with it).

The `deal_id in (select …)` form is used rather than a correlated `exists`, so
the planner can evaluate the caller's deal ids once per statement and use the
`deal_id` index. It is the same derived-ownership idea as the Sprint 2
`note_tags` policy, applied through one hop. The composite same-deal FKs are
what make one hop sufficient.

### 1.2 Shared column conventions

- `created_at timestamptz not null default now()` on every table.
- `updated_at timestamptz not null default now()` plus the `updated_at` trigger
  **on mutable tables only**. The trigger function is re-created in the Sprint 3
  migration with `set search_path = ''`, following the Sprint 2 pattern.

---

## 2. Tables

### 2.1 `accounts` — ownership root

**Purpose.** The customer organisation a deal is with. It holds the facts that
outlive a single deal.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, `default gen_random_uuid()` |
| `user_id` | `uuid not null` | **Owner**; FK `auth.users(id) on delete cascade` |
| `name` | `text not null` | `check (length(btrim(name)) between 1 and 200)` |
| `region` | `text` | e.g. `EU`, `US`, `APAC`; nullable |
| `country_code` | `text` | ISO 3166-1 alpha-2; `check (country_code ~ '^[A-Z]{2}$')`; nullable |
| `segment` | `text` | nullable, free text for the demo |
| `industry` | `text` | nullable, free text for the demo |
| `created_at`, `updated_at` | `timestamptz` | mutable table |

- **PK:** `id`. **Unique:** `(id, user_id)` (target for the deal FK);
  `(user_id, lower(name))`, so one user cannot create "Acme" twice.
- **Indexes:** the `(user_id, lower(name))` unique index also serves `user_id`
  lookups.
- **RLS:** root policies; mutable; delete allowed (cascades to the account's
  deals).

### 2.2 `deals` — ownership root

**Purpose.** The atomic business object: one commercial transaction with its
structured facts. Everything below derives its owner from here.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid not null` | **Owner** |
| `account_id` | `uuid not null` | Composite FK `(account_id, user_id)` → `accounts(id, user_id)` `on delete cascade` |
| `predecessor_deal_id` | `uuid` | Composite FK `(predecessor_deal_id, user_id)` → `deals(id, user_id)` `on delete set null (predecessor_deal_id)`; nullable |
| `name` | `text not null` | length check 1–200 |
| `deal_type` | `text not null` | `check in ('new_business','renewal','expansion','amendment')` |
| `stage` | `text not null` | `check in ('discovery','negotiation','contracting','closed')` (C2) |
| `arr_eur` | `numeric(14,2) not null` | `check (arr_eur >= 0)`; the primary metric (U11) |
| `tcv_eur` | `numeric(14,2)` | nullable, `>= 0` |
| `list_price_eur` | `numeric(14,2)` | nullable, `>= 0` |
| `discount_pct` | `numeric(5,2)` | nullable, `check (discount_pct between 0 and 100)` |
| `term_months` | `integer` | nullable, `> 0` |
| `start_date` | `date` | nullable |
| `end_date` | `date` | nullable, `check (end_date is null or start_date is null or end_date >= start_date)` |
| `renewal_date` | `date` | nullable; drives "renews next quarter" |
| `notice_period_days` | `integer` | nullable, `>= 0` |
| `auto_renew` | `boolean` | nullable (unknown ≠ false) |
| `created_at`, `updated_at` | `timestamptz` | mutable table |

- **PK:** `id`. **Unique:** `(id, user_id)`.
- **Constraints:**
  - `check (predecessor_deal_id is null or predecessor_deal_id <> id)`
  - `check (deal_type <> 'renewal' or predecessor_deal_id is not null)` — a
    renewal must link to its predecessor (U13). A predecessor with a live
    renewal therefore cannot be deleted on its own; lineage is not silently
    lost.
- **Indexes:**
  - `(user_id, renewal_date)` — behaviour 1, and the renewal-date part of
    behaviour 3.
  - `(user_id, arr_eur)` — the ARR threshold in behaviour 3.
  - `(account_id)`, `(predecessor_deal_id)` — FK indexes.
- **RLS:** root policies; mutable; delete allowed (cascades to all children).

### 2.3 `evidence_items`

**Purpose.** A source artefact attached to a deal, with provenance. Immutable.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `deal_id` | `uuid not null` | FK `deals(id) on delete cascade` — **ownership via deal** |
| `evidence_type` | `text not null` | `check in ('msa','order_form','amendment','dpa','email','call_note','pricing_record','security_questionnaire','other')` |
| `title` | `text not null` | length check 1–300 |
| `source_kind` | `text not null` | `check in ('pasted','uploaded')` (U5) |
| `body_text` | `text not null` | the full text that excerpts point into; `length > 0` |
| `storage_path` | `text` | private Storage object path; uploads only |
| `original_filename` | `text` | uploads only |
| `mime_type` | `text` | uploads only; `check in ('text/plain','text/markdown')` when set (C6) |
| `author` | `text` | provenance; nullable |
| `document_date` | `date` | provenance; nullable |
| `version_label` | `text` | provenance, e.g. "v3 executed"; nullable |
| `is_executed` | `boolean not null default false` | whether this is the executed version |
| `supersedes_evidence_id` | `uuid` | Composite FK `(supersedes_evidence_id, deal_id)` → `evidence_items(id, deal_id)` `on delete set null (supersedes_evidence_id)`; nullable |
| `created_at` | `timestamptz` | immutable: no `updated_at` |

- **PK:** `id`. **Unique:** `(id, deal_id)`.
- **Constraints:**
  - `check (source_kind <> 'uploaded' or storage_path is not null)`
  - `check (supersedes_evidence_id is null or supersedes_evidence_id <> id)`
- **Indexes:** `(deal_id)` — the policy column (the `(id, deal_id)` unique
  index leads with `id`, so it does not serve `deal_id` lookups);
  `(supersedes_evidence_id)`.
- **RLS:** deal-child policies; **no update policy** (immutable); delete
  allowed.
- **Storage (uploads, C6):** one **private** bucket. Object paths start with the
  owner's id taken from the verified session
  (`{auth.uid}/{evidence_id}/{filename}`). Storage policies compare the first
  path segment with `(select auth.uid())::text`. Only plain-text and Markdown
  files are accepted; the server reads their text into `body_text`.

### 2.4 `evidence_excerpts`

**Purpose.** An addressable span of an evidence item. It is what retrieval
returns and what findings and provisions cite. Immutable.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK — the stable citation identifier |
| `evidence_item_id` | `uuid not null` | part of the composite FK below |
| `deal_id` | `uuid not null` | **ownership via deal**; also scopes retrieval without a join |
| `ordinal` | `integer not null` | position within the item, `>= 0` |
| `start_offset` | `integer not null` | character offset into `evidence_items.body_text`, `>= 0` |
| `end_offset` | `integer not null` | `check (end_offset > start_offset)` |
| `section_label` | `text` | e.g. "§ 9 Limitation of liability"; nullable |
| `content` | `text not null` | the excerpt text, `length > 0` |
| `content_tsv` | `tsvector` | `generated always as (to_tsvector('english', content)) stored` (C5) |
| `created_at` | `timestamptz` | immutable |

- **PK:** `id`. **Unique:** `(id, deal_id)`; `(evidence_item_id, ordinal)`.
- **FK:** composite `(evidence_item_id, deal_id)` → `evidence_items(id, deal_id)`
  `on delete cascade`. This guarantees the excerpt's `deal_id` is its item's
  deal.
- **Indexes:**
  - GIN on `content_tsv` — full-text retrieval (U6 baseline).
  - `(deal_id)` — the policy column, and scoping retrieval to the deals a
    structured filter selected.
  - `(evidence_item_id, ordinal)` — the unique index covers the item FK.
- **RLS:** deal-child policies; **no update policy**; no delete policy
  (excerpts go with their item by cascade).
- **Embeddings are not in the MVP migration.** If the U6 check says pgvector is
  practical, a *separate, later* migration enables the `vector` extension and
  adds `embedding vector(1536)` (the `text-embedding-3-small` dimension) with an
  HNSW index. Nothing in the MVP depends on it.

### 2.5 `provisions`

**Purpose.** A **confirmed** commercial or legal term of a deal, stored as a
structured fact (U4). AI candidates are *not* stored here; they are
`ai_findings` of type `provision_candidate` until a human confirms them.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `deal_id` | `uuid not null` | FK `deals(id) on delete cascade` — **ownership via deal** |
| `provision_type` | `text not null` | `check in ('liability_cap','data_residency','payment_terms','auto_renewal','termination','discount','governing_law')` |
| `value_text` | `text not null` | human-readable confirmed value, e.g. "12 months of fees", "EU only" |
| `value_numeric` | `numeric` | nullable machine value, e.g. `12`, `30` |
| `value_unit` | `text` | nullable, `check in ('months_of_fees','eur','days','percent','region')` |
| `source` | `text not null` | `check in ('human_entered','ai_confirmed')` |
| `source_finding_id` | `uuid` | Composite FK `(source_finding_id, deal_id)` → `ai_findings(id, deal_id)` `on delete set null (source_finding_id)` |
| `confirmed_at` | `timestamptz not null default now()` | |
| `created_at`, `updated_at` | `timestamptz` | mutable (a human may correct it) |

- **PK:** `id`. **Unique:** `(id, deal_id)`; `(deal_id, provision_type)` — one
  current value per provision type per deal (C4). Several regions go in
  `value_text` ("EU and CH").
- **Constraints:**
  - `check (source <> 'ai_confirmed' or source_finding_id is not null)` —
    *note:* the column-list `set null` would violate this if the finding were
    deleted. Findings have no delete policy and only disappear with their deal,
    which also removes the provision, so the case does not arise.
  - `check ((value_numeric is null) = (value_unit is null))`
- **Indexes:** `(deal_id, provision_type)` (unique; also the policy index);
  `(source_finding_id)`.
- **RLS:** deal-child policies; mutable; delete allowed.
- **Evidence:** through `provision_excerpts` (2.6).

### 2.6 `provision_excerpts` (join)

**Purpose.** "Each provision is *evidenced by* one or more excerpts."

| Column | Type | Notes |
|---|---|---|
| `provision_id` | `uuid not null` | Composite FK `(provision_id, deal_id)` → `provisions(id, deal_id)` `on delete cascade` |
| `excerpt_id` | `uuid not null` | Composite FK `(excerpt_id, deal_id)` → `evidence_excerpts(id, deal_id)` `on delete cascade` |
| `deal_id` | `uuid not null` | **ownership via deal**; forces provision and excerpt onto the same deal |
| `created_at` | `timestamptz` | |

- **PK:** `(provision_id, excerpt_id)`.
- **Indexes:** `(excerpt_id)`; `(deal_id)`.
- **RLS:** deal-child policies; no update; delete allowed.
- A provision with zero rows here is an **unsupported claim**. The application
  shows it as such; the schema does not force at least one row.

### 2.7 Rules — **no table**

Rules are fixed application logic (U3). A code registry holds, per rule:

- a stable `rule_key` (e.g. `liability_cap_min_12m`) and a `rule_version`;
- the provision type or fact it applies to;
- a deterministic condition, or a judged-condition prompt;
- a default severity.

Rows that apply a rule store `rule_key text` and `rule_version text`, with a
format check (`rule_key ~ '^[a-z][a-z0-9_]{2,63}$'`). Validity of the key is
checked in application code against the registry. That gives "which version of
which rule" traceability without a rule-builder model.

### 2.8 `exceptions`

**Purpose.** A persistent, human-facing deviation of a deal from a rule, with a
lifecycle (U8).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `deal_id` | `uuid not null` | FK `deals(id) on delete cascade` — **ownership via deal** |
| `rule_key` | `text not null` | from the code registry |
| `rule_version` | `text not null` | |
| `kind` | `text not null` | `check in ('non_standard_provision','threshold_breach','missing_evidence','conflicting_evidence','timing_risk','commercial_risk')` |
| `severity` | `text not null` | `check in ('low','medium','high')` |
| `title` | `text not null` | short label |
| `why` | `text not null` | the explanation shown to the user |
| `origin` | `text not null` | `check in ('deterministic','ai')` |
| `source_finding_id` | `uuid` | Composite FK `(source_finding_id, deal_id)` → `ai_findings(id, deal_id)`; the proposing finding |
| `provision_id` | `uuid` | Composite FK `(provision_id, deal_id)` → `provisions(id, deal_id)` `on delete set null (provision_id)`; nullable |
| `status` | `text not null default 'open'` | `check in ('open','under_review','decided','dismissed')` |
| `status_changed_at` | `timestamptz not null default now()` | |
| `created_at`, `updated_at` | `timestamptz` | mutable (status only, in practice) |

- **PK:** `id`. **Unique:** `(id, deal_id)` (target for Decisions and Actions).
- **Constraints:**
  - `check (origin <> 'ai' or source_finding_id is not null)` — an AI-origin
    exception always points at the finding that proposed it, and so at its
    citations.
  - **Partial unique index** `(deal_id, rule_key) where status in ('open','under_review')`,
    so re-running checks cannot pile up duplicate live exceptions.
- **Indexes:** `(deal_id, status)` — the policy index, which also serves the
  "needs attention" list across the caller's deals; `(source_finding_id)`;
  `(provision_id)`.
- **RLS:** deal-child policies; mutable; delete not granted (dismiss instead).
- **Citations:** via `source_finding_id` → `ai_finding_excerpts` for AI origin;
  via `provision_id` → `provision_excerpts`, or the deal's facts, for
  deterministic origin.
- **AI proposals (C7):** the server creates an AI-proposed exception directly
  as `open`, with `origin = 'ai'` and the proposing finding linked. It gains
  visibility, not authority; the human's Decision or dismissal is what counts.
- **Application rule:** the status becomes `decided` only in the same server
  operation that records a Decision on it. Covered by a functional test.

### 2.9 `ai_findings`

**Purpose.** Everything the model produces that is kept: provision candidates,
exception proposals, explanations, deal summaries, Copilot answers about a
deal. Never a Decision.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `deal_id` | `uuid not null` | FK `deals(id) on delete cascade` — **ownership via deal** |
| `finding_type` | `text not null` | `check in ('provision_candidate','exception_proposal','risk_explanation','deal_summary','answer')` |
| `content` | `text not null` | the explanation / answer text |
| `payload` | `jsonb` | structured part, e.g. a candidate provision's type and value; nullable |
| `rule_key`, `rule_version` | `text` | nullable; set when the finding judged a rule |
| `model` | `text not null` | the OpenRouter model id used |
| `prompt_version` | `text not null` | version of the prompt template in code |
| `status` | `text not null default 'proposed'` | `check in ('proposed','accepted','rejected','superseded')` |
| `created_at` | `timestamptz` | |

- **PK:** `id`. **Unique:** `(id, deal_id)`.
- **Constraints:**
  - `check ((rule_key is null) = (rule_version is null))`
  - `check (finding_type <> 'provision_candidate' or payload is not null)`
- **Indexes:** `(deal_id, created_at desc)` (policy index and the per-deal
  timeline); `(deal_id, finding_type)`.
- **RLS:** deal-child policies. **Update is limited to the `status` column**
  using column-level privileges (`revoke update … ; grant update (status) … to authenticated`)
  alongside the policy, so the model's content cannot be rewritten later. No
  delete policy (cascades with the deal).
- **Citations:** `ai_finding_excerpts` (2.10). A finding with zero citations is
  displayed as *unsupported*.

### 2.10 `ai_finding_excerpts` (join)

**Purpose.** The evidence a finding cites.

| Column | Type | Notes |
|---|---|---|
| `finding_id` | `uuid not null` | Composite FK `(finding_id, deal_id)` → `ai_findings(id, deal_id)` `on delete cascade` |
| `excerpt_id` | `uuid not null` | Composite FK `(excerpt_id, deal_id)` → `evidence_excerpts(id, deal_id)` `on delete cascade` |
| `deal_id` | `uuid not null` | **ownership via deal**; forces finding and excerpt onto the same deal |
| `quote` | `text` | optional exact sub-span the model relied on |
| `created_at` | `timestamptz` | |

- **PK:** `(finding_id, excerpt_id)`. **Indexes:** `(excerpt_id)`; `(deal_id)`.
- **RLS:** deal-child policies; insert and select only (citations are
  immutable).
- **Application rule:** the server keeps only citations whose `excerpt_id` was
  actually in the retrieved set sent to the model. An id the model invents is
  dropped, not stored.

### 2.11 `decisions`

**Purpose.** A recorded human judgement on an exception or on a deal. Human
only, immutable.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `deal_id` | `uuid not null` | FK `deals(id) on delete cascade` — **ownership via deal**. Under single-user tenancy, the deal's owner is the decider. |
| `exception_id` | `uuid` | Composite FK `(exception_id, deal_id)` → `exceptions(id, deal_id)` `on delete cascade`; null = a deal-level decision |
| `decision_type` | `text not null` | `check in ('approve','reject','approve_with_conditions','accept_risk','request_change','dismiss_false_positive')` (C3) |
| `rationale` | `text not null` | `check (length(btrim(rationale)) > 0)` |
| `conditions` | `text` | required for `approve_with_conditions` |
| `considered_finding_id` | `uuid` | Composite FK `(considered_finding_id, deal_id)` → `ai_findings(id, deal_id)`; the AI explanation in view, if any |
| `created_at` | `timestamptz` | immutable |

- **PK:** `id`. **Unique:** `(id, deal_id)` (target for Actions).
- **Constraints:**
  `check (decision_type <> 'approve_with_conditions' or conditions is not null)`.
- **Indexes:** `(deal_id)`; `(exception_id)`; `(considered_finding_id)`.
- **RLS:** deal-child policies; **insert and select only**, with no update and
  no delete. A change of mind is a new Decision.
- **"AI cannot create Decisions" — how it is enforced.** The database cannot
  tell server code acting for the AI from server code acting for the human:
  both use the same verified user session. Enforcement is therefore:
  1. separate tables, with no column in `ai_findings` that means approval;
  2. one `db.ts` function creates a Decision, and it is called only from a
     Server Action submitted by the user;
  3. the server-only AI module never imports it;
  4. an automated test asserts that no AI flow produces a `decisions` row.

### 2.12 `actions`

**Purpose.** A personal next step for the authenticated user, possibly prepared
by the AI. There is no assignee column: under U1 the deal's owner is the only
possible assignee.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `deal_id` | `uuid not null` | FK `deals(id) on delete cascade` — **ownership via deal** |
| `exception_id` | `uuid` | Composite FK `(exception_id, deal_id)` → `exceptions(id, deal_id)` `on delete set null (exception_id)` |
| `decision_id` | `uuid` | Composite FK `(decision_id, deal_id)` → `decisions(id, deal_id)` `on delete set null (decision_id)` |
| `action_type` | `text not null` | `check in ('task','draft_customer_email','draft_internal_summary','notice_reminder')` (C3) |
| `title` | `text not null` | |
| `body` | `text` | the drafted text, if any |
| `prepared_by` | `text not null` | `check in ('human','ai')` |
| `source_finding_id` | `uuid` | Composite FK `(source_finding_id, deal_id)` → `ai_findings(id, deal_id)`; set when AI-prepared |
| `status` | `text not null` | `check in ('proposed','open','done','cancelled')` |
| `due_date` | `date` | nullable |
| `completed_at` | `timestamptz` | nullable |
| `created_at`, `updated_at` | `timestamptz` | mutable |

- **PK:** `id`.
- **Constraints:**
  - `check (prepared_by <> 'ai' or source_finding_id is not null)`
  - `check ((status = 'done') = (completed_at is not null))`
  - AI-prepared actions start as `proposed`; only the user moves them on
    (application rule, tested).
- **Indexes:** `(deal_id, status, due_date)` (policy index and the to-do list);
  `(exception_id)`; `(decision_id)`; `(source_finding_id)`.
- **RLS:** deal-child policies; mutable; delete allowed.
- **Nothing is sent from here.** A drafted email is text the user copies; there
  is no outbound mail integration.

### 2.13 `deal_outcomes`

**Purpose.** The final outcome of a deal — status only, no analytics (U10).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `deal_id` | `uuid not null` | FK `deals(id) on delete cascade` — **ownership via deal** |
| `outcome` | `text not null` | `check in ('closed_won','closed_lost','renewed','churned','downgraded','renegotiated')` |
| `final_arr_eur` | `numeric(14,2)` | nullable, `>= 0` |
| `outcome_date` | `date not null` | |
| `note` | `text` | nullable |
| `created_at`, `updated_at` | `timestamptz` | mutable |

- **PK:** `id`. **Unique:** `(deal_id)` — one outcome per deal; the unique
  index is also the policy and FK index.
- **RLS:** deal-child policies; mutable; delete allowed.

---

## 3. Relationships

```
auth.users 1─* accounts          (user_id — ownership root)
auth.users 1─* deals             (user_id — ownership root)

accounts 1─* deals ─┐ predecessor_deal_id (self, renewal lineage)
                    │   composite (…, user_id) FKs between roots
deals 1─* evidence_items 1─* evidence_excerpts
  │         └─ supersedes_evidence_id (self, same deal)
  ├─* provisions *─* evidence_excerpts        (provision_excerpts)
  ├─* ai_findings *─* evidence_excerpts       (ai_finding_excerpts)
  ├─* exceptions ── source_finding_id → ai_findings, provision_id → provisions
  │      └─* decisions (exception_id nullable → deal-level decision)
  ├─* decisions ── considered_finding_id → ai_findings
  ├─* actions ── exception_id / decision_id / source_finding_id (all nullable)
  └─1 deal_outcomes

Every child carries deal_id; every child-to-child arrow is a composite
(x_id, deal_id) FK, so no reference can leave its deal.
```

**Table count:** 10 domain tables + 2 join tables = **12**. Rules have no
table. *(Corrected; originally miscounted as 11 + 2 = 13.)*

---

## 4. What stays in application logic

- **The rule registry:** keys, versions, conditions, judged-condition prompts
  and default severities (U3).
- **The quarter calculation:** the next calendar quarter in `Europe/Berlin`,
  computed in code and passed to the query as a date range. No calendar table.
- **Standard vs non-standard evaluation:** deterministic rule conditions over
  deal facts and provisions, and LLM judgement for wording.
- **Chunking** pasted or uploaded text into excerpts, and recording their
  offsets.
- **Retrieval orchestration** (deterministic filter → retrieval → reasoning),
  the Copilot's routing of a question to the right layer, and prompt templates
  (versioned in code, referenced by `prompt_version`).
- **Citation validation** (only retrieved excerpt ids are stored).
- **Lifecycle transitions:** exception → `decided` with a Decision, AI-prepared
  action `proposed` → `open` by the user.
- **The "AI cannot create Decisions" boundary** (see 2.11).

## 5. What is NOT stored yet

- Copilot conversation history, and cross-deal answers as a single record.
  Behaviour 3 is stored, if at all, as one finding per matching deal.
- Raw prompts, raw model responses, token usage and cost.
- Embeddings: they wait for the U6 feasibility check, then go in a separate
  migration.
- Exception status history. The current status is stored; Decisions are the
  history of judgement.
- A rules table, rule versions as rows, or rule configuration.
- Contacts, stakeholders, products and line items (CRM territory).
- Teams, organisations, memberships, roles, approval limits or assignees.
- A `user_id` on deal children; ownership is derived through the deal (C1).
- Currency, FX rates, fiscal calendars.
- Analytics or outcome aggregates.
- Any NoteSpace table.

---

## 6. Schema decisions

| # | Question | Decision |
|---|---|---|
| **C1** | **Ownership pattern.** | **RESOLVED: preserve the NoteSpace ownership pattern.** `user_id` is **not** added to every table. `accounts` and `deals` are user-owned roots; **the Deal is the ownership root** for everything attached to it; every other table derives its ownership through `deal_id`. RLS follows the NoteSpace owner-scoped pattern (§1.1). Ownership always comes from the verified session, never from client input. FKs and policy columns are indexed. No service-role or `security definer` bypass. |
| **C2** | Deal stage values. | **Accepted:** `'discovery','negotiation','contracting','closed'`. The final result is recorded in `deal_outcomes`. |
| **C3** | Decision and action types that imply routing. | **Accepted:** `escalate` (Decision) and `approval_request` / `escalation` (Action) are left out of the Sprint 3 check lists, since approval routing is out of scope (U1, U9, CLAUDE.md). They remain domain concepts in the Index and can be added by a one-line migration later. |
| **C4** | One provision per type per deal. | **Accepted:** `unique (deal_id, provision_type)`; several values go in `value_text`. |
| **C5** | Full-text search language. | **Accepted:** `'english'`, on the assumption that the demo evidence is English. |
| **C6** | Which uploads. | **Accepted:** plain-text and Markdown uploads only; the server reads the text into `body_text`. PDF / DOCX parsing is out. This is the simple document path U5 allows. |
| **C7** | Do AI exception proposals become exceptions automatically? | **Accepted:** yes, as `open` with `origin = 'ai'` and the proposing finding linked. Consistent with U8: the stored lifecycle is human-facing, and the proposal carries no authority. |
| **C8** | Column-list `on delete set null (column)` needs Postgres 15 or later. | **Accepted, with one check:** run `select version();` on project #2 before applying the migration. New Supabase projects run Postgres 15 or later. |

---

## 7. Readiness *(historical — superseded)*

> Not an instruction. The Deal Intelligence migration is authored and applied
> only from `gtm-stack-fit/supabase/migrations/`, as described in
> `gtm-stack-fit/docs/platform-persistence-design.md` §11. The references to
> project #2 below record the original plan.

The design was **ready to become a migration.** All of C1–C8 are decided. The
one remaining step is a check, not a design question: confirm project #2's
Postgres version (C8).

The MVP migration would contain, in order:

1. the `updated_at` trigger function;
2. the 12 tables *(corrected; originally stated as 13)* with their
   constraints, in dependency order (`ai_findings`
   before the tables that reference it);
3. indexes;
4. RLS enablement, policies, and the `ai_findings` column grant;
5. the private Storage bucket and its policies (C6).

Per CLAUDE.md, the migration is written on a feature branch, applied by the
user to project #2, and not reported as applied without verification output.
The feature that ships it includes automated tests for:

- isolation between two users on every table;
- a composite FK rejecting a cross-deal reference;
- the renewal-needs-predecessor check;
- deleting an account whose deals include a renewal and its predecessor. The
  predecessor's `set null` must not trip the renewal check during the cascade.
