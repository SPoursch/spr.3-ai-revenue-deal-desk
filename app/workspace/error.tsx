'use client'

import { PAGE_CLASS, SUBMIT_CLASS } from '@/app/components/deal-desk/styles'

/**
 * Error boundary for the workspace pages, e.g. when a deal cannot be read.
 * The error itself is logged on the server; the page shows a generic message
 * and never the error's text.
 */
export default function WorkspaceError({
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <main aria-label="Error" className={PAGE_CLASS}>
      <section
        role="alert"
        className="rounded-[var(--radius-card)] border border-red-200 bg-red-50 px-6 py-10 text-center"
      >
        <h1 className="text-[20px] font-bold tracking-tight text-danger">
          Something went wrong
        </h1>
        <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-danger">
          This page could not be loaded. Please try again.
        </p>
        <div className="mt-6">
          <button type="button" onClick={() => retry()} className={SUBMIT_CLASS}>
            Try again
          </button>
        </div>
      </section>
    </main>
  )
}
