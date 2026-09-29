import { PAGE_CLASS } from '@/app/components/deal-desk/styles'

/** Shown while a workspace page loads its deals or accounts. */
export default function WorkspaceLoading() {
  return (
    <main aria-label="Loading" aria-busy="true" className={PAGE_CLASS}>
      <p role="status" className="text-[15px] text-muted">
        Loading…
      </p>
      <div className="mt-6 flex flex-col gap-3" aria-hidden="true">
        <div className="h-8 w-48 animate-pulse rounded-[var(--radius-control)] bg-border" />
        <div className="h-40 animate-pulse rounded-[var(--radius-card)] bg-border" />
      </div>
    </main>
  )
}
