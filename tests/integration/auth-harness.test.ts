import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { requireTestEnv } from '../support/env'
import {
  createAnonymousClient,
  signInTestUser,
  signOutTestUser,
  type SignedInTestUser,
} from '../support/supabase-clients'

/**
 * Smoke test for the integration-test harness itself, against the hosted
 * canonical database. It proves the three clients later tests rely on are
 * what they claim to be. It writes no application data and does not test
 * RLS behaviour; that belongs to the Accounts and Deals integration tests.
 *
 * Emails are compared as booleans so a failure never prints one.
 */
describe('integration harness: canonical Supabase auth', () => {
  let userA: SignedInTestUser
  let userB: SignedInTestUser

  beforeAll(async () => {
    userA = await signInTestUser('A')
    userB = await signInTestUser('B')
  })

  afterAll(async () => {
    await Promise.all([userA, userB].filter(Boolean).map(signOutTestUser))
  })

  it('the anonymous client has no session and no verified claims', async () => {
    const anonymous = createAnonymousClient()

    const { data: sessionData } = await anonymous.auth.getSession()
    expect(sessionData.session).toBeNull()

    const { data, error } = await anonymous.auth.getClaims()
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it.each(['A', 'B'] as const)(
    'test user %s authenticates with verified claims',
    async (label) => {
      const user = label === 'A' ? userA : userB

      const { data, error } = await user.client.auth.getClaims()
      expect(error).toBeNull()

      const claims = data?.claims
      expect(claims?.role).toBe('authenticated')
      expect(claims?.is_anonymous).toBe(false)
      expect(claims?.sub).toBe(user.userId)

      const expectedEmail = requireTestEnv(
        `DEAL_DESK_TEST_USER_${label}_EMAIL`,
      ).toLowerCase()
      expect(claims?.email?.toLowerCase() === expectedEmail).toBe(true)
    },
  )

  it('test users A and B are different accounts', () => {
    expect(userA.userId === userB.userId).toBe(false)
  })
})
