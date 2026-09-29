import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { ConfirmDeleteForm } from '@/app/components/deal-desk/ConfirmDeleteForm'
import { CARD_CLASS, PAGE_CLASS } from '@/app/components/deal-desk/styles'
import { isUuid } from '@/app/lib/deal-desk/forms'
import { formatNumber } from '@/app/lib/deal-desk/format'
import { getAccount, getAuthenticatedUser, listDeals } from '@/app/lib/db'

/**
 * Confirm deleting an account. Deleting an account deletes every deal on it
 * (the database cascades), so the page names those deals before anything
 * happens. Rendered on the server; nothing is deleted until the confirmation
 * form is submitted. An account that does not exist and one that is not the
 * user's both render the account not-found page.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Delete account · AI Revenue Deal Desk' }

export default async function DeleteAccountPage({
  params,
}: PageProps<'/workspace/accounts/[accountId]/delete'>) {
  if (!(await getAuthenticatedUser())) {
    redirect('/login')
  }

  const { accountId } = await params

  if (!isUuid(accountId)) {
    notFound()
  }

  const [account, deals] = await Promise.all([getAccount(accountId), listDeals()])

  if (!account) {
    notFound()
  }

  const accountDeals = deals.filter((deal) => deal.account_id === account.id)

  return (
    <main aria-label="Delete account" className={PAGE_CLASS}>
      <h1 className="text-[28px] font-bold tracking-tight">Delete account</h1>
      <div className={`${CARD_CLASS} mt-8 flex flex-col gap-6 p-6`}>
        <p className="text-[15px] leading-relaxed">
          You are about to delete <strong>{account.name}</strong>.{' '}
          {accountDeals.length === 0 ? (
            'It has no deals.'
          ) : (
            <>
              This also deletes its{' '}
              <strong>{formatNumber(accountDeals.length, 'deal')}</strong>, and everything
              attached to them:
            </>
          )}
        </p>
        {accountDeals.length > 0 ? (
          <ul className="list-disc pl-6 text-[15px]">
            {accountDeals.map((deal) => (
              <li key={deal.id}>{deal.name}</li>
            ))}
          </ul>
        ) : null}
        <p className="text-[15px] font-semibold">This cannot be undone.</p>
        <ConfirmDeleteForm target="account" id={account.id} cancelHref="/workspace/accounts" />
      </div>
    </main>
  )
}
