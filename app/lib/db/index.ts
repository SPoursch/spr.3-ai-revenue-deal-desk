/**
 * Centralised data-access layer.
 *
 * Per CLAUDE.md, every Supabase read and write goes through this folder. No
 * component, route handler or server action may call supabase-js directly: if a
 * new query is needed, add a function to the relevant module here and export it
 * below.
 *
 * Callers import from `app/lib/db`, which resolves to this file. The exports are
 * listed explicitly so that the public surface is visible in one place and a
 * module-internal helper — `requireUserId()` in auth.ts — cannot leak out
 * through a wildcard re-export.
 *
 * - accounts.ts    Deal Desk accounts (an ownership root)
 * - ai-findings.ts Deal Desk AI findings (content immutable; never Decisions)
 * - auth.ts        Supabase Auth: the verified user, sign-in/up/out, recovery
 * - deals.ts       Deal Desk deals (the other ownership root)
 * - decisions.ts   Deal Desk human Decisions on exceptions (immutable; never AI)
 * - errors.ts      the errors thrown when a table query fails
 * - evidence.ts    Deal Desk evidence items and excerpts (immutable)
 * - exceptions.ts  Deal Desk exceptions (status is the only mutable column)
 * - notespace.ts   the inherited NoteSpace tables (reference material only)
 * - provisions.ts  Deal Desk provisions and their excerpt citations
 */

export {
  createAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  updateAccount,
} from './accounts'

export {
  createAiFinding,
  getAiFinding,
  listAiFindings,
  updateAiFindingStatus,
} from './ai-findings'

export {
  createDeal,
  deleteDeal,
  getDeal,
  listDeals,
  updateDeal,
} from './deals'

export {
  getDecision,
  listDecisions,
  listExceptionDecisions,
  recordDecision,
} from './decisions'

export {
  createEvidenceExcerpt,
  createEvidenceItem,
  getEvidenceExcerpt,
  getEvidenceItem,
  listEvidenceExcerpts,
  listEvidenceItems,
} from './evidence'

export {
  createException,
  getException,
  listExceptions,
  updateExceptionStatus,
} from './exceptions'

export {
  addProvisionExcerpt,
  createProvision,
  deleteProvision,
  getProvision,
  listProvisionExcerpts,
  listProvisions,
  removeProvisionExcerpt,
  updateProvision,
} from './provisions'

export type { AuthResult, AuthUser, EmailTokenType } from './auth'
export {
  exchangeAuthCode,
  getAuthenticatedUser,
  sendPasswordResetEmail,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  startGoogleSignIn,
  updatePassword,
  verifyEmailToken,
} from './auth'

export type { DatabaseErrorKind } from './errors'
export {
  DealDeskDatabaseError,
  DecisionValidationError,
  NotesDatabaseError,
} from './errors'

export type {
  Collection,
  CreateNoteInput,
  Note,
  Tag,
  UpdateNoteInput,
} from './notespace'
export {
  addTagToNote,
  createCollection,
  createNote,
  createTag,
  deleteNote,
  getNote,
  listCollections,
  listNotes,
  listTags,
  listTagsByNote,
  listTagsForNote,
  removeTagFromNote,
  setNoteCollection,
  updateNote,
} from './notespace'
