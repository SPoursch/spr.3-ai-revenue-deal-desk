import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { AccountForm } from '@/app/components/deal-desk/AccountForm'
import { CARD_CLASS, PAGE_CLASS, TEXT_LINK_CLASS } from '@/app/components/deal-desk/styles'
import { isUuid, toAccountFormValues } from '@/app/lib/deal-desk/forms'
import { getAccount, getAuthenticatedUser } from '@/app/lib/db'

/**
 * Edit an account. Read as the signed-in user, so an account that does not
 * exist and one that is not theirs both render the account not-found page.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Edit account · AI Revenue Deal Desk' }

export default async function EditAccountPage({
  params,
}: PageProps<'/workspace/accounts/[accountId]/edit'>) {
  if (!(await getAuthenticatedUser())) {
    redirect('/login')
  }

  const { accountId } = await params

  if (!isUuid(accountId)) {
    notFound()
  }

  const account = await getAccount(accountId)

  if (!account) {
    notFound()
  }

  return (
    <main aria-label="Edit account" className={PAGE_CLASS}>
      <Link href="/workspace/accounts" className={`${TEXT_LINK_CLASS} text-[14px]`}>
        ← All accounts
      </Link>
      <h1 className="mt-4 text-[28px] font-bold tracking-tight">Edit account</h1>
      <div className={`${CARD_CLASS} mt-8 p-6`}>
        <AccountForm edit={{ accountId: account.id, initial: toAccountFormValues(account) }} />
      </div>
    </main>
  )
}
