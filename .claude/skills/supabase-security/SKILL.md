---
name: supabase-security
description: Supabase security best practices covering Row Level Security, API key handling, JWT policies, and common pitfalls. Load this skill when auditing a Supabase-backed project for security issues.
---

## Row Level Security (RLS)

Every table in the public schema must have RLS enabled. Without it, any client
holding the publishable key can read or write the table freely. The most common
failure mode is creating a table via raw SQL and forgetting to enable RLS — the
Table Editor enables it automatically, but SQL migrations do not.

Enable RLS from the dashboard: Database > Tables, toggle RLS on for the relevant
table. After a deploy, check Authentication > Policies to confirm every restricted
table has at least one active policy.

## API keys: publishable and secret

Supabase has introduced new key names. The **publishable key** (prefix
`sb_publishable_`) replaces the legacy `anon` key. The **secret key** (prefix
`sb_secret_`) replaces the legacy `service_role` key. Legacy keys still work but
are being deprecated — accept either form when auditing.

The publishable/anon key is browser-safe: it maps to a low-privilege Postgres role
and respects RLS.

The secret/service_role key bypasses RLS entirely and has full access to every
table. It must never appear in client-side code. In a Next.js project, any
environment variable prefixed with `NEXT_PUBLIC_` is sent to the browser — never
place the secret key in a `NEXT_PUBLIC_` variable.

## JWT-based row policies

Use `auth.uid()` in RLS policies so each user sees only their own rows:

```sql
create policy "Users can view their own records" on my_table
for select to authenticated
using ( (select auth.uid()) = user_id );
```

When no user is logged in, `auth.uid()` returns null, so the comparison is always
false and the row is hidden. Wrapping the call in `(select auth.uid())` lets
Postgres cache the result per statement rather than evaluating it on every row.

## Common pitfalls

- **Views bypass RLS by default.** A view created under the postgres role runs as
  SECURITY DEFINER and ignores the underlying table's policies. In PostgreSQL 15+,
  add `with (security_invoker = true)` to the view definition to make it honour
  the calling user's policies.
- **SECURITY DEFINER functions run with elevated rights.** A function marked
  SECURITY DEFINER executes as its creator (often a superuser). If it touches a
  restricted table, RLS does not apply. Avoid defining these in the public schema.
- **NEXT_PUBLIC_ variables reach the browser.** Only the publishable/anon key
  should appear in a `NEXT_PUBLIC_` variable. Flag any secret/service_role key
  found there as Critical.
- **Legacy key names are still in wide use.** An audit may find `SUPABASE_ANON_KEY`
  or `SUPABASE_SERVICE_ROLE_KEY` rather than the new prefixed names. Treat them
  by the same rules: anon/publishable is browser-safe; service_role/secret is not.

## Where to check after a deploy

- Dashboard > Database > Tables: confirm the RLS toggle is on for every table that
  holds user data.
- Dashboard > Authentication > Policies: confirm each restricted table has at least
  one active policy and no table is unprotected.
- Dashboard > Advisors > Security: Supabase's built-in security advisor flags tables
  with RLS disabled and other common misconfigurations.
