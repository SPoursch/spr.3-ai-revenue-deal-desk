import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AccountForm } from '@/app/components/deal-desk/AccountForm'
import { CARD_CLASS, PAGE_CLASS, TEXT_LINK_CLASS } from '@/app/components/deal-desk/styles'
import { getAuthenticatedUser } from '@/app/lib/db'

/** Create an account, the company a deal belongs to. */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'New account · AI Revenue Deal Desk' }

export default async function NewAccountPage() {
  if (!(await getAuthenticatedUser())) {
    redirect('/login')
  }

  return (
    <main aria-label="New account" className={PAGE_CLASS}>
      <Link href="/workspace" className={`${TEXT_LINK_CLASS} text-[14px]`}>
        ← All deals
      </Link>
      <h1 className="mt-4 text-[28px] font-bold tracking-tight">New account</h1>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
        The company a deal is with. After saving, you continue straight to its
        first deal.
      </p>
      <div className={`${CARD_CLASS} mt-8 p-6`}>
        <AccountForm />
      </div>
    </main>
  )
}
