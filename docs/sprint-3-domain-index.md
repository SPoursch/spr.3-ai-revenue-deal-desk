# Sprint 3 Domain Index — AI Revenue Deal Desk

Status: **Index stage.** This document precedes schema design. It contains no
SQL, and nothing in it is a table definition. Where it names an entity, that is
a domain concept, not a commitment to a table.

This Index is the authority on the **domain meaning** of Revenue / Deal
Intelligence, one of two bounded domains of the Revenue Operating Intelligence
platform. The **persistence** of that domain — tables, ownership, RLS and
migrations — is defined in the canonical
`gtm-stack-fit/docs/platform-persistence-design.md`, on the canonical
`gtm-stack-fit` Supabase database (see U15).

Development rule this document serves:

> Understand → **Index / domain model** → Schema → Implement → Automated
> functional test → Verify → PR → Review → Merge

Sources:

- The Sprint 3 product brief (North Star, product boundary, the eight domain
  concepts, the three representative AI behaviours).
- A read-only architecture review of the existing NoteSpace code, done by a
  planning subagent and spot-checked afterwards.
- Standard revenue-operations practice. Anything drawn from that rather than the
  brief is marked *(inferred)* and has to be confirmed.

---

## 0. North Star and boundary

**North Star.** An AI-powered revenue decision workspace. It consolidates the
commercial context of a deal, identifies exceptions and risks, and helps revenue
teams understand what requires attention and why.

**The atomic business object is the Deal.** Every other concept either
describes a deal, is attached to a deal, or is derived from a deal.

| It is | It is not |
|---|---|
| A decision workspace around a Deal | A CRM replacement (no pipeline management, no contact database) |
| A reader and explainer of commercial evidence | A CLM (no contract drafting, redlining, e-signature or clause library authoring) |
| An AI that **understands → detects → explains → prepares** | A generic chatbot |
| A system in which humans make every consequential decision | A system that approves deals, discounts or terms |

**The AI authority line.** AI output is always a *proposal*, *finding* or
*explanation*. It is never a Decision. The system has to make an AI-made
Decision structurally impossible, not merely discouraged (see §6, Risk 3).

---

## 1. Core entities

| Entity | What it is | Status |
|---|---|---|
| **Deal** | The atomic object: one commercial transaction (new business, renewal, expansion or amendment) with its terms, value and dates. | Core, from the brief |
| **Account** | The customer organisation a deal is with ("Acme"). It holds the facts that outlive a single deal, such as region, industry and segment. | Core *(inferred)* |
| **Evidence item** | A source artefact attached to a deal: a contract, order form, amendment, email, call note or pricing sheet. | Core |
| **Evidence excerpt (chunk)** | An addressable span of an evidence item, which is what retrieval returns and what claims cite. | Core, required by RAG |
| **Provision** | A commercial or legal term as it appears in a deal, such as liability cap, data residency, payment terms, auto-renewal, termination or discount. | Core |
| **Rule** | A policy statement of what counts as standard, such as "liability cap ≥ 12 months' fees" or "discount > 20 % needs VP approval". | Core |
| **Exception** | A detected deviation of a deal's facts or provisions from a rule, or a risk signal. | Core |
| **Decision** | A human's recorded judgement on an exception or deal (approve, reject, approve with conditions, accept risk, request change, dismiss as false positive; see DECISION) with a rationale. | Core |
| **Action** | A prepared or assigned next step: a task, a drafted email, an approval request, an escalation. | Core |
| **Outcome** | What actually happened afterwards: signed, renewed, churned, renegotiated, and at what value. | Core |
| **User / team member** | A person working deals: an account executive, deal desk, finance, legal. | Reused from auth; roles are new |
| **AI finding / explanation** | Output of the AI (a detected exception, a summary, an answer) with its citations and model metadata. | Core, kept apart from Decision |

## 2. Relationships

- An **Account** has many **Deals**. A renewal deal usually succeeds an earlier
  deal on the same account *(inferred: deal lineage)*.
- A **Deal** has many **Evidence items**, and an evidence item has many
  **excerpts**.
- A **Deal** has many **Provisions**. Each provision is *evidenced by* one or
  more excerpts. A provision without evidence is an unsupported claim.
- A **Rule** applies to a *kind* of provision or fact (discount, liability, data
  residency, payment terms) and possibly only to some deals (region, segment,
  deal type).
- An **Exception** links one **Deal** to one **Rule**. It is triggered by
  specific facts or provisions and supported by specific excerpts.
- A **Decision** is made by one **User** about one **Exception**, or about the
  deal as a whole. It is based on a view of the evidence at that moment.
- An **Action** follows a Decision or an Exception. It is assigned to a User and
  may be *prepared* by the AI.
- An **Outcome** belongs to a **Deal**, and can later be related back to the
  decisions and exceptions on it (closing the learning loop).
- An **AI finding** references the deal, the excerpts it cites and the rules it
  applied. It may *propose* an Exception or an Action, never a Decision.

```
Account 1─* Deal 1─* Evidence item 1─* Excerpt
                │                          ▲
                ├─* Provision ─evidenced by┘
                ├─* Exception *─1 Rule
                │      ├─* Decision (human only) ─* Action
                │      └─ proposed by AI finding (cites excerpts)
                └─* Outcome
```

## 3. The eight domain concepts

### FACT — structured, authoritative attributes

Facts are values that can be stated without interpretation once recorded.

- Deal: type (new / renewal / expansion / amendment), stage, owner, ARR or ACV,
  total contract value, currency, list price vs net price, discount %, term
  length, start date, end date, **renewal date**, notice period, auto-renew
  flag.
- Account: name, region or country, segment, industry.
- Provisions *once extracted and confirmed*: liability cap (as an amount or a
  multiple of fees), data-residency region, payment terms (net days), governing
  law.

A fact has a **source**. It was either entered by a human, imported from a
system of record, or extracted by the AI from evidence. An extracted fact is
not authoritative until a human confirms it (see §8, uncertainty U4).

### EVIDENCE — the documents that support facts

| Evidence type | Typical content |
|---|---|
| Master agreement / MSA | Liability, indemnity, data protection, governing law, termination |
| Order form / quote | Price, discount, term, products, quantities, start and end dates |
| Amendment / addendum | Changes that supersede earlier terms |
| Data processing agreement (DPA) | Data residency, sub-processors, security obligations |
| Email thread | Negotiation history, side commitments, "what we agreed" |
| Call / meeting note | Verbal commitments, stated risks, stakeholder positions |
| Pricing / approval record | Earlier discount approvals and their justification |
| Security questionnaire | Customer requirements that may create obligations |

Evidence needs provenance: its type, source, author, date, version, and whether
it is the *executed* version. Later evidence can supersede earlier evidence (an
amendment overrides the MSA).

### CONTEXT — what changes the meaning of a fact

- **Deal context:** type (a renewal is judged against the prior contract), stage,
  size band, strategic flag.
- **Account context:** region (data-residency expectations), segment or
  industry (regulated sectors), relationship history.
- **Temporal context:** fiscal quarter, time until renewal or notice deadline,
  whether a term has already been superseded.
- **Policy context:** which version of which rule was in force when the deal
  was negotiated.
- **Decision context:** what was approved before for this account, or for
  similar deals (precedent).

### RULE — what "standard" means

Example rules *(illustrative, not yet agreed)*:

- Discount above X % requires approval from role Y.
- Liability cap below 12 months' fees is non-standard.
- Uncapped liability is always an exception.
- Data residency outside the standard regions (for example EU / US) is
  non-standard.
- Payment terms longer than net 30 are non-standard.
- Auto-renewal missing, or notice period above N days, is non-standard.
- Renewal with a price decrease is flagged.

A rule has two parts that must stay separate. The **condition** is
deterministic where possible (`discount_pct > 20`). Some conditions can only be
**judged**, such as "is this liability wording equivalent to our standard?",
and those need LLM reasoning.

### EXCEPTION — a deviation that needs attention

An exception is always `deal × rule × evidence`:

- Its **kind**: non-standard provision, threshold breach, missing evidence,
  conflicting evidence (the email says one thing, the contract another),
  timing risk (renewal notice deadline close), commercial risk (price erosion).
- Its **severity** and a short **why**.
- Its **origin**: detected deterministically, or proposed by the AI.
- Its **citations**: the excerpts and facts that support it.
- Its **status**: open, under review, decided or dismissed.

### DECISION — human judgement, recorded

- Made by an identified human, never by the AI.
- Types: approve, reject, approve with conditions, accept risk, request
  change, dismiss as false positive. These are exactly the canonical schema's
  `decision_type` values, which are the source of truth. *Escalate* remains a
  domain concept but is not a Sprint 3 Decision type: it implies approval
  routing, which is out of scope (U1, U9; schema decision C3).
- Carries a **rationale**, a timestamp, and the evidence or AI explanation
  that was in view.
- **Conditions** belong to *approve with conditions* only: that type must
  state them, and every other type must not carry any. The database enforces
  the first half; the application enforces both, so a rejection can never be
  recorded with what reads as approval conditions.
- Should be immutable once recorded. A change of mind is a new decision.

### ACTION — preparing the next step

- Types: approval request, escalation, task (e.g. "get legal review"), drafted
  customer email, drafted internal summary, reminder before a notice deadline.
- The AI may **draft or prepare** an action. A human sends, assigns or
  executes it.
- Carries an assignee, a due date and a status.

### OUTCOME — what happened

- Deal outcome: closed-won, closed-lost, renewed, churned, downgraded,
  renegotiated, with the final value.
- Exception outcome: whether an accepted risk later materialised.
- Purpose: to learn which exceptions matter. This is reporting and learning,
  not a real-time feature, and is the weakest-specified concept (see §8).

---

## 4. Deterministic vs retrieval vs LLM reasoning

| Layer | What belongs here | Example | Why this layer |
|---|---|---|---|
| **Deterministic / structured** | Facts, dates, amounts, statuses, rule conditions that are numeric or categorical, filters, sorting, counts, deadlines | "Which deals renew next quarter?", "ARR > €50k", "discount > 20 %", "notice deadline within 30 days" | Must be exact, repeatable and auditable. **The LLM must not answer these**; it may only translate a question into a structured filter, which the database executes. |
| **Retrieval (RAG)** | Finding the excerpts relevant to a question inside the evidence of the deals the user may see | "What did we agree with Acme about liability?" | The answer lives in unstructured text. Retrieval returns cited excerpts; nothing is stated without a source. |
| **LLM reasoning** | Classifying a provision as standard or non-standard, comparing wording with a rule, reconciling conflicting evidence, summarising, explaining *why* something needs attention, drafting actions | "Is this liability clause non-standard?", "Explain the risk on this renewal" | Requires judgement over text. Output is a *finding* with citations and is never authoritative on its own. |

### The three representative behaviours

1. **"Which deals renew next quarter?"** → deterministic only. A filter on
   renewal date within the next fiscal quarter, over deals the user can see. No
   retrieval, no LLM answer.
2. **"What did we agree with Acme about liability?"** → structured scoping
   (Acme's deals) → retrieval over those deals' evidence for liability content →
   the LLM composes an answer **only from the retrieved excerpts**, citing each
   one, and says so when the evidence is silent or contradictory.
3. **"Renewals next quarter with non-standard data-residency or liability
   provisions and ARR > €50k"** →
   1. deterministic filter: renewal date next quarter, ARR > €50k;
   2. per remaining deal, retrieve data-residency and liability excerpts;
   3. the LLM judges each against the relevant rule, with citations;
   4. return a list of deals with the exception and *why*, for a human to act on.

   Filter first, then retrieve, then reason. This order keeps cost down and
   keeps the numeric conditions exact.

An important design consequence: provisions that are asked about often
(liability cap, data residency, payment terms) can be **extracted once**, confirmed
by a human and stored as facts. Behaviour 3 then becomes mostly deterministic
over time. Decided: confirmed provisions are stored as facts (§8, U4).

---

## 5. A / B / C separation

### A. Reusable NoteSpace infrastructure (keep as-is)

- **Single data-access module.** The `app/lib/db/` folder, imported as
  `app/lib/db`, is the only code that calls `supabase-js`, and
  `app/lib/supabase.ts` is imported only by it (and by `proxy.ts` for session
  refresh). Deal, evidence and retrieval queries go there too.
- **Per-request SSR client** using the publishable key only, never cached
  across requests.
- **Identity:** `getAuthenticatedUser()` verifies the session with
  `getClaims()`. `requireUserId()` takes the owner from the session, never from
  input.
- **Guard in depth:**
  - the `/workspace` layout guard;
  - the page re-checking the session before its first query;
  - `app/lib/actions/require-auth.ts` called first in every Server Action.

  Every AI-invoking action or route must follow the same order.
- **Action contract:** a uniform success/failure state. Errors are logged on the
  server and the user gets a generic message. Input is validated (uuid checks,
  trimming, length caps).
- **The whole auth surface:** email/password, Google OAuth, `/auth/callback`,
  `/auth/confirm`, password reset, user menu, sign-out.
- **RLS patterns** from `supabase/migrations/20260918120000_add_per_user_ownership.sql`
  (a Sprint 2 history file, used here as a pattern reference only; it is never
  applied to the canonical database):
  - `(select auth.uid())` so the check runs once per statement;
  - a `with check` that re-validates a foreign-key target, because FK checks
    bypass RLS;
  - ownership derived through relationships instead of stored twice;
  - indexes on the ownership column;
  - a migration that refuses to run until someone decides what happens to
    legacy rows.
- **URL as workspace state** (`app/lib/workspace-url.ts`), e.g. selected deal,
  filters, query.
- **Process:** the four validation commands before every commit. *(Revised:
  migrations are no longer written or applied here. They are versioned files in
  `gtm-stack-fit/supabase/migrations/`, the single migration authority for the
  canonical database — see U15.)*

### B. Domain concepts to transform (not duplicate)

| NoteSpace concept | Becomes | Mapping strength and caveat |
|---|---|---|
| Collection (named container) | **Account**, with **Deal** as the working container | Weak. A collection is only a name; Account → Deal is a real hierarchy with its own facts. The container pattern and the RLS FK cross-check carry over; the table does not. |
| Note (title + body, editable) | **Evidence item** | Medium. CRUD and the editor pane fit, but evidence needs provenance, versioning or immutability (the `updated_at` "edited" behaviour would overwrite a source of record), and chunking for large documents. The 10k-character body cap is a note limit, not a document limit. |
| Tag + `note_tags` | **Classification** of evidence and provisions (liability, data residency, payment terms; standard vs non-standard) | Medium. The many-to-many join and derived ownership carry over. Tags are free text with no unique name; classifications need a controlled vocabulary, plus who assigned them (human or AI) and a confidence. |
| In-memory title/body search | **Three query layers** (§4): structured filters, retrieval, orchestrated reasoning | Weak. The current code loads every row per request and filters with `includes()`, which does not scale and has no retrieval. |
| Tag filter (AND over tags) | **Structured deal filters** (type, quarter, ARR band, exception kind) | Pattern reusable; the implementation is not. |
| Per-user ownership (`user_id`) | **Team or organisation visibility** of deals | Resolved by U1: stays per-user for Sprint 3; team or organisation visibility is a future extension. |
| Static Help / Q&A panel | Stays static help for the Deal Desk | Must not drift into a chatbot. |
| Note-shaped names in shared code (`NotesDatabaseError`, `NoteActionState`, `[notes]` log prefixes, `WorkspaceState.collection/tags/note`) and the NoteSpace branding | Renamed to neutral or deal-oriented names | Mechanical, but it should happen before new code builds on those names. |

### C. New Sprint 3 concepts (no NoteSpace precedent)

- Deal facts: money, currency, dates, renewal and notice logic, fiscal quarters.
- Evidence excerpts with stable identifiers for citation.
- Retrieval (lexical and/or vector) that respects row level security.
- Provisions as extracted, confirmable facts.
- Rules as data, with deterministic conditions and judged conditions kept apart.
- Exceptions with kind, severity, origin, citations and status.
- Decisions as an immutable, human-only record with rationale.
- Actions: AI-prepared, human-executed.
- Outcomes and the learning loop.
- AI findings: model output stored apart from human records, with citations and
  model metadata.
- A server-only AI module: the provider key in a server-only environment
  variable, one module that is the only caller of the model (mirroring
  `app/lib/db`), prompt-injection handling for evidence text.
- Roles (account executive, deal desk, finance, legal) and approval authority
  *(inferred)*.

---

## 6. Architectural risks

1. **Ownership model.** "Every row belongs to exactly one account" contradicts
   team visibility of deals across account executives, deal desk, finance and
   legal. Keeping `user_id` isolation means deals cannot be shared. Moving to
   an organisation or team membership model means every policy is rewritten to
   go through a membership relation. Derived policies then chain through
   deal → organisation → membership, which costs performance and is easy to get
   subtly wrong. **Decided (U1):** single-user / private tenancy for Sprint 3,
   keeping the existing owner-scoped RLS model.
2. **Retrieval that bypasses RLS, and data leaving for the model provider.**
   - Embedding jobs or vector search run with a service-role key or a
     `security definer` function would skip RLS and could put another tenant's
     evidence into a prompt. Retrieval must run as the caller, or re-check
     verified ownership.
   - Model calls run only on the server.
   - Sending contract text to a provider needs an explicit data-handling
     decision (what is sent, retention, redaction).
   - Evidence documents are untrusted input and can carry prompt injection.
3. **Provenance of AI claims, and human authority.**
   - Every AI finding or explanation must cite the specific excerpts and facts
     it rests on.
   - AI output must be stored apart from human Decisions, separated at the type
     and schema level, so no AI path can write an approval.
   - Deterministic questions must go through the structured path, never be
     answered from model memory.

Additional preconditions found in the review:

- The base NoteSpace schema cannot be rebuilt from migrations.
  `supabase/migrations/` holds only the Part 8 ownership file, and the original
  `create table` statements live in prose in `docs/supabase-schema.md`.
  *(Resolved by U15: the Deal Desk uses the canonical `gtm-stack-fit` database,
  which contains no NoteSpace table, so no NoteSpace baseline is needed. The
  Part 8 file is Sprint 2 history and is never applied to the canonical
  database.)*
- `CLAUDE.md` is still entirely Sprint 2: the 12 Part 5 requirements, the Part 8
  scope stops, the single-owner rule, the notes data model. Left in place, it
  will make agents refuse or distort Deal Desk work. *(Resolved: `CLAUDE.md`
  has been rewritten for Sprint 3.)*
- The "degrade to nothing" catch blocks in `app/workspace/page.tsx` are
  dangerous for exceptions. An empty exception list must never be
  indistinguishable from a load failure.
- `AGENTS.md` notes that this Next.js version has breaking changes. The bundled
  docs in `node_modules/next/dist/docs/` must be read before adding route
  handlers or streaming.

## 7. Invariants that must not change

- Identity comes only from `getClaims()`, never from `getSession()` or from
  `user_metadata`.
- No function accepts a user, owner or organisation id from the client.
  Tenancy is derived on the server from the verified `sub`.
- RLS is the authority, and application filtering is defence in depth. No
  service-role key in any request path.
- One data-access module. The same rule applies to the model client: one
  server-only AI module.
- Every mutating or AI-invoking action authorises itself first.
- Per-request client. Nothing persisted in the browser. Secrets only in
  environment variables, and `.env.local` never committed.
- Errors are logged on the server and the user gets a generic message.
- Migrations are versioned files in `gtm-stack-fit/supabase/migrations/`, the
  single migration authority for the canonical database, and none is reported
  as applied without verification output.
- AI never records a Decision.

---

## 8. Domain questions — Sprint 3 decisions

All fifteen questions that were open at Index stage are now decided for
Sprint 3. The original question is kept, struck through, above each decision so
the reasoning stays traceable.

| # | Question and decision | Out of scope for Sprint 3 |
|---|---|---|
| **U1** | ~~**Tenancy and visibility.** Single user, a team, or an organisation with roles? Who sees which deals?~~ **RESOLVED: single-user / private tenancy for Sprint 3.** Every authenticated user sees only their own deals and associated data. The existing owner-scoped RLS model from NoteSpace is preserved. Human Decisions remain explicitly separate from AI findings. Actions are personal actions for the authenticated user. Reason: a strict time constraint, and keeping Sprint 3 focused on the AI Revenue Deal Desk capabilities rather than on rebuilding multi-user / team infrastructure. | Team / organisation tenancy, shared deal access, roles and approval routing (future extensions). |
| **U2** | ~~**Where deal data comes from.** Manual entry, CSV import, seeded demo data, or a CRM sync?~~ **RESOLVED: seeded / manual demo data.** Reason: focus the sprint on the AI Deal Desk workflow. | CRM integration, CSV import, any external system-of-record sync. |
| **U3** | ~~**Rules: data or code?** Are rules configurable records with versions, or fixed logic for the sprint? Who owns them?~~ **RESOLVED: rules are fixed application logic**, not user-configurable records. Rule definitions are explicit and versionable in code. | Rule builder, rule-management UI, rules stored as configurable records. |
| **U4** | ~~**Extracted provisions.** Are AI-extracted provisions stored as facts after human confirmation, or re-derived at query time?~~ **RESOLVED: the AI may extract *candidate* provisions from evidence; they are not authoritative until a human confirms them.** Confirmed provisions become persistent structured facts and are not re-derived on every query. | — |
| **U5** | ~~**Evidence storage and granularity.** Paste text, upload files (PDF / DOCX) to Storage, or both? What is the chunking unit: clause, paragraph or fixed size?~~ **RESOLVED: pasted text first, plus a simple document-upload path** if the existing architecture allows it without major infrastructure work. Evidence must retain provenance and addressable excerpts. | A sophisticated file-processing pipeline. |
| **U6** | ~~**Retrieval technique.** Postgres full-text search, pgvector embeddings, or hybrid? Which embedding provider?~~ **RESOLVED: Supabase / Postgres full-text search, plus pgvector embeddings only if already practical within the Sprint 3 stack**, with hybrid retrieval where useful. If embeddings are implemented, they use OpenAI `text-embedding-3-small` through the server-side AI layer. Retrieval must not be over-engineered. | Over-engineered retrieval. |
| **U7** | ~~**Model provider and data handling.** Which LLM, and what may be sent (full documents vs excerpts, redaction)?~~ **RESOLVED: OpenRouter for the LLM, server-side only**, following the Sprint 3 course requirement. `OPENROUTER_API_KEY` is never exposed to the client. Only the minimum necessary evidence and context is sent to the model. AI outputs contain evidence citations where applicable. | Any client-side model call. |
| **U8** | ~~**Exception lifecycle.** Are exceptions stored and tracked (status, assignee), or recomputed on demand? Is a dismissed exception re-raised when evidence changes?~~ **RESOLVED: exceptions are persistent records with a status.** AI and deterministic checks may create proposals / findings; the human-facing exception lifecycle is stored. Statuses support at least *open*, *under review*, *decided* and *dismissed*. | A sophisticated workflow engine. |
| **U9** | ~~**Decision authority.** Do roles or approval limits apply (e.g. only finance approves discounts > 30 %)? Is a decision per exception, per deal, or both?~~ **RESOLVED: no roles or approval limits** (follows from U1). A Decision belongs to the authenticated user and may apply to an exception or to a deal. The AI cannot create Decisions. Decisions are recorded human actions and remain separate from AI findings. | Roles, approval limits, approval routing. |
| **U10** | ~~**Outcome scope.** Is the learning loop in scope for this sprint, or only the recording of the deal's final status?~~ **RESOLVED: record the final deal outcome / status only.** | A full analytics / learning-loop system. |
| **U11** | ~~**Currency and money.** Single currency (EUR) or multi-currency with conversion? ARR vs ACV vs TCV — which one does "> €50k" mean?~~ **RESOLVED: EUR for the Sprint 3 demo; ARR is the primary recurring-revenue metric.** The example threshold "> €50k" means ARR > €50,000. | Currency conversion, multi-currency. |
| **U12** | ~~**Fiscal calendar.** Is "next quarter" the calendar quarter or a fiscal quarter with a different start?~~ **RESOLVED: calendar quarters.** "Next quarter" means the next calendar quarter relative to the current date, calculated deterministically in application logic. | Fiscal calendars. |
| **U13** | ~~**Deal lineage.** Is a renewal a new deal linked to its predecessor, or a phase of the same deal?~~ **RESOLVED: a renewal is a new Deal linked to its predecessor Deal**, which allows comparison against the previous deal / contract. | — |
| **U14** | ~~**Fate of the NoteSpace tables and UI.** Are notes/collections/tags dropped, kept alongside, or migrated? Is a baseline migration of the existing schema needed first?~~ **RESOLVED: Sprint 3 gets a clean Deal Desk domain.** The underlying application, auth and data-access infrastructure may be reused (§5 A), but the Sprint 3 domain schema is designed for the Deal Desk. The Sprint 2 NoteSpace Supabase project remains untouched. | Carrying the NoteSpace notes / collections / tags product into the Sprint 3 UI; migrating Sprint 2 user data. |
| **U15** | ~~**Supabase project.** A new project for Sprint 3, or reuse of the Sprint 2 one?~~ ~~**RESOLVED:** Sprint 3 uses a separate Supabase project (#2). Sprint 2 remains frozen on Supabase project #1, and its database is not modified by Sprint 3.~~ **REVISED: Sprint 3 uses the canonical `gtm-stack-fit` Supabase project**, the single database of the Revenue Operating Intelligence platform. There is no separate Sprint 3 project. `gtm-stack-fit/supabase/migrations/` is the single migration authority; this repository owns and applies no migration. Deal Intelligence tables sit beside the existing GTM Stack Fit table `saved_assessments`, with no cross-domain link. Persistence design: `gtm-stack-fit/docs/platform-persistence-design.md`. The Sprint 2 NoteSpace project remains frozen and is not modified. Reason: one canonical database for the platform's two bounded domains, instead of a per-sprint project. | Any change to the Sprint 2 NoteSpace project; a separate Sprint 3 project; migrations owned by this repository. |

Safe to rely on (unchanged): Deal is the atomic object. Evidence supports facts
and is cited. Decisions are human-only and separate from AI output. The
deterministic → retrieval → reasoning split in §4, with deterministic filtering
first. The auth and data-access invariants in §7.

### Conditional decisions to confirm during schema design

Two decisions are conditional on feasibility. They are decided in principle, and
the condition is checked when the schema is designed, not before:

- **U5:** whether a simple document-upload path fits the existing architecture
  without major infrastructure work.
- **U6:** whether pgvector embeddings are practical within the Sprint 3 stack,
  or retrieval stays on full-text search alone.

---

## 9. Readiness for schema design

The Index is **ready to serve as the basis for schema design.** No domain
question blocks it: U1–U15 are all resolved, and only the two conditional
checks under §8 remain, to be settled as part of schema design itself.

Two preconditions came before the first migration:

- ~~rewrite `CLAUDE.md` for Sprint 3;~~ done;
- ~~decide how the existing schema is baselined.~~ Replaced by U15 (revised):
  there is no NoteSpace baseline in the canonical database. The remaining
  precondition is to verify, on the canonical `gtm-stack-fit` project, whether
  the existing `saved_assessments` migration has been applied, before the Deal
  Intelligence migration is written there.

Schema design has since been completed and now lives in
`gtm-stack-fit/docs/platform-persistence-design.md`.
