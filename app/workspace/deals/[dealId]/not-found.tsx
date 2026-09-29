import Link from 'next/link'

import { PAGE_CLASS, PRIMARY_LINK_CLASS } from '@/app/components/deal-desk/styles'

/**
 * Shown for a deal id that does not exist and for one that belongs to
 * someone else: row level security makes the two indistinguishable, and the
 * page says nothing that would tell them apart.
 */
export default function DealNotFound() {
  return (
    <main aria-label="Deal not found" className={PAGE_CLASS}>
      <section className="rounded-[var(--radius-card)] border border-dashed border-border-strong bg-pane px-6 py-10 text-center">
        <h1 className="text-[24px] font-bold tracking-tight">Deal not found</h1>
        <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-muted">
          This deal does not exist, or it is not one of yours.
        </p>
        <div className="mt-6">
          <Link href="/workspace" className={PRIMARY_LINK_CLASS}>
            Back to your deals
          </Link>
        </div>
      </section>
    </main>
  )
}
