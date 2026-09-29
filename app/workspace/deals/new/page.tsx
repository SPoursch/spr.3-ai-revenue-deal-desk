import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { DealForm, type AccountOption } from '@/app/components/deal-desk/DealForm'
import {
  CARD_CLASS,
  ERROR_CLASS,
  PAGE_CLASS,
  PRIMARY_LINK_CLASS,
  TEXT_LINK_CLASS,
} from '@/app/components/deal-desk/styles'
import { getAuthenticatedUser, listAccounts } from '@/app/lib/db'

/**
 * Create a deal on one of the user's accounts.
 *
 * `?accountId=` preselects an account (it is where creating an account lands).
 * It is only a default for the picker: an id that is not one of the user's
 * own accounts matches no option and is ignored, and the Server Action
 * validates whatever is finally submitted.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'New deal · AI Revenue Deal Desk' }

export default async function NewDealPage({
  searchParams,
}: PageProps<'/workspace/deals/new'>) {
  if (!(await getAuthenticatedUser())) {
    redirect('/login')
  }

  const { accountId } = await searchParams
  let accounts: AccountOption[] | null

  try {
    // Only id and name are passed to the Client Component.
    accounts = (await listAccounts()).map(({ id, name }) => ({ id, name }))
  } catch (error) {
    console.error('[deals/new] loading accounts failed:', error)
    accounts = null
  }

  const defaultAccountId =
    typeof accountId === 'string' && accounts?.some((account) => account.id === accountId)
      ? accountId
      : null

  return (
    <main aria-label="New deal" className={PAGE_CLASS}>
      <Link href="/workspace" className={`${TEXT_LINK_CLASS} text-[14px]`}>
        ← All deals
      </Link>
      <h1 className="mt-4 text-[28px] font-bold tracking-tight">New deal</h1>

      {accounts === null ? (
        <p role="alert" className={`${ERROR_CLASS} mt-8`}>
          Your accounts could not be loaded. Refresh the page to try again.
        </p>
      ) : accounts.length === 0 ? (
        <section
          aria-label="No accounts"
          className="mt-8 rounded-[var(--radius-card)] border border-dashed border-border-strong bg-pane px-6 py-10 text-center"
        >
          <h2 className="text-[20px] font-bold tracking-tight">Create an account first</h2>
          <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-muted">
            Every deal belongs to an account. Create the account, and you will
            come straight back here.
          </p>
          <div className="mt-6">
            <Link href="/workspace/accounts/new" className={PRIMARY_LINK_CLASS}>
              Create an account
            </Link>
          </div>
        </section>
      ) : (
        <>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
            Amounts are in euros. Only the account, name, type, stage and ARR are
            required.{' '}
            <Link href="/workspace/accounts/new" className={TEXT_LINK_CLASS}>
              New account
            </Link>
          </p>
          <div className={`${CARD_CLASS} mt-8 p-6`}>
            <DealForm accounts={accounts} defaultAccountId={defaultAccountId} />
          </div>
        </>
      )}
    </main>
  )
}
