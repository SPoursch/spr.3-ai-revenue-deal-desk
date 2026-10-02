'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { NAV_ITEM_ACTIVE_CLASS, NAV_ITEM_CLASS } from './styles'

/**
 * The Deal Desk's primary navigation, rendered once by
 * app/workspace/layout.tsx.
 *
 * A Client Component only to read the current path for the active state; the
 * destinations are fixed links to existing routes. Every item is a real page:
 * a destination is added here when its route exists, never before.
 *
 * One element serves every width. From `lg` up it is a vertical rail beside
 * the content; below that the same links run as a horizontal strip under the
 * top bar, so the links are never rendered twice and every accessible name
 * stays unique on the page.
 *
 * No table, no landmark other than the <nav>, and no `main`: each page owns
 * its own <main>.
 */

type NavItem = {
  href: string
  label: string
  icon: ReactNode
  /** Whether `pathname` is this item's page or one beneath it. */
  matches: (pathname: string) => boolean
}

type NavGroup = { label: string; items: NavItem[] }

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="size-[18px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

const GROUPS: NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      {
        // /workspace is the deal list, and every deal page sits under /workspace/deals.
        href: '/workspace',
        label: 'Deals',
        matches: (pathname) => pathname === '/workspace' || pathname.startsWith('/workspace/deals'),
        icon: (
          <Icon>
            <rect x="3" y="6" width="14" height="10.5" rx="2" />
            <path d="M7.5 6V4.75A1.25 1.25 0 0 1 8.75 3.5h2.5a1.25 1.25 0 0 1 1.25 1.25V6M3 10.5h14" />
          </Icon>
        ),
      },
      {
        href: '/workspace/accounts',
        label: 'Accounts',
        matches: (pathname) => pathname.startsWith('/workspace/accounts'),
        icon: (
          <Icon>
            <path d="M4 17V4.5A1.5 1.5 0 0 1 5.5 3h5A1.5 1.5 0 0 1 12 4.5V17M12 8h2.5A1.5 1.5 0 0 1 16 9.5V17M2.5 17h15M7 6.5h2M7 9.5h2M7 12.5h2" />
          </Icon>
        ),
      },
      {
        href: '/workspace/attention',
        label: 'Attention',
        matches: (pathname) => pathname.startsWith('/workspace/attention'),
        icon: (
          <Icon>
            <path d="M10 3.5a4.5 4.5 0 0 0-4.5 4.5c0 3.5-1.5 5-1.5 5h12s-1.5-1.5-1.5-5A4.5 4.5 0 0 0 10 3.5ZM8.5 16a1.6 1.6 0 0 0 3 0" />
          </Icon>
        ),
      },
    ],
  },
]

export function WorkspaceNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Workspace"
      className="flex shrink-0 gap-6 overflow-x-auto border-b border-border bg-nav px-3 py-2 lg:sticky lg:top-14 lg:h-[calc(100dvh-3.5rem)] lg:w-60 lg:flex-col lg:overflow-y-auto lg:border-r lg:border-b-0 lg:px-3 lg:py-5"
    >
      {GROUPS.map((group) => (
        <div key={group.label} className="flex lg:flex-col lg:gap-1">
          <p className="hidden px-3 pb-1.5 text-[12px] font-semibold text-nav-label lg:block">
            {group.label}
          </p>
          <ul className="flex gap-1 lg:flex-col">
            {group.items.map((item) => {
              const active = item.matches(pathname)
              // The item's own page is the current page; a page beneath it
              // (a deal, an account's edit form) is within that section.
              const current = pathname === item.href ? 'page' : active ? 'true' : undefined

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={current}
                    className={`${NAV_ITEM_CLASS} ${
                      active
                        ? `${NAV_ITEM_ACTIVE_CLASS} lg:before:absolute lg:before:inset-y-2 lg:before:-left-3 lg:before:w-[3px] lg:before:rounded-r-full lg:before:bg-primary`
                        : ''
                    }`}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
