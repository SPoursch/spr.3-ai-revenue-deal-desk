import { PostgrestError } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

// Imported from the module file, not the db/ index: the index also pulls in
// app/lib/supabase.ts and with it `next/headers`, which a unit test does not
// need.
import {
  classifyPostgrestError,
  DealDeskDatabaseError,
  DecisionValidationError,
  NotesDatabaseError,
} from '../../app/lib/db/errors'

function postgrestError(code: string, message = 'boom'): PostgrestError {
  return new PostgrestError({ message, details: '', hint: '', code })
}

describe('classifyPostgrestError', () => {
  it.each([
    ['23502', 'not-null violation'],
    ['23503', 'foreign-key violation'],
    ['23505', 'unique violation'],
    ['23514', 'check violation'],
    ['22P02', 'invalid text representation'],
    ['22003', 'numeric value out of range'],
    ['22007', 'invalid datetime format'],
    ['22008', 'datetime field overflow'],
  ])('classifies %s (%s) as invalid_input', (code) => {
    expect(classifyPostgrestError(postgrestError(code))).toBe('invalid_input')
  })

  it('classifies 42501 (insufficient privilege or RLS) as not_permitted', () => {
    expect(classifyPostgrestError(postgrestError('42501'))).toBe(
      'not_permitted',
    )
  })

  it.each(['08006', '57014', 'PGRST301', 'PGRST116', ''])(
    'classifies %j as unexpected',
    (code) => {
      expect(classifyPostgrestError(postgrestError(code))).toBe('unexpected')
    },
  )
})

describe('DealDeskDatabaseError', () => {
  it('carries the operation, table, classification and cause', () => {
    const cause = postgrestError('23514', 'violates check constraint')
    const error = new DealDeskDatabaseError('insert', 'deals', cause)

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('DealDeskDatabaseError')
    expect(error.operation).toBe('insert')
    expect(error.table).toBe('deals')
    expect(error.kind).toBe('invalid_input')
    expect(error.cause).toBe(cause)
    expect(error.message).toBe(
      'Supabase insert on "deals" failed (23514): violates check constraint',
    )
  })

  it('is not a NotesDatabaseError, so NoteSpace handlers do not catch it', () => {
    const error = new DealDeskDatabaseError(
      'select',
      'accounts',
      postgrestError('08006'),
    )

    expect(error).not.toBeInstanceOf(NotesDatabaseError)
  })
})

describe('DecisionValidationError', () => {
  it('carries the field-level problems, so a form need not parse the message', () => {
    const problems = [
      { field: 'rationale', message: 'Explain the decision.' },
      { field: 'conditions', message: 'State the conditions of the approval.' },
    ] as const
    const error = new DecisionValidationError(problems)

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(DealDeskDatabaseError)
    expect(error.name).toBe('DecisionValidationError')
    expect(error.problems).toEqual(problems)
    expect(error.message).toBe(
      'Decision not recorded: invalid rationale, conditions.',
    )
  })
})
