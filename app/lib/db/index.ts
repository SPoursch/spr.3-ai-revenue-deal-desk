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
 * - accounts.ts  Deal Desk accounts (an ownership root)
 * - deals.ts     Deal Desk deals (the other ownership root)
 * - auth.ts      Supabase Auth: the verified user, sign-in/up/out, recovery
 * - errors.ts    the errors thrown when a table query fails
 * - notespace.ts the inherited NoteSpace tables (reference material only)
 */

export {
  createAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  updateAccount,
} from './accounts'

export {
  createDeal,
  deleteDeal,
  getDeal,
  listDeals,
  updateDeal,
} from './deals'

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
export { DealDeskDatabaseError, NotesDatabaseError } from './errors'

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
