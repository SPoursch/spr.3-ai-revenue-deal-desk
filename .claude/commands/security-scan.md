---
description: Run the Supabase, Next.js and Vercel security scanners in parallel and combine their findings into one deduplicated report. Report only; changes nothing.
---

Run a full security scan of this project. This is a report-only task: do not
modify, create or delete any file, do not commit, push or deploy, and do not
change any Supabase, Vercel or GitHub setting.

## 1. Run the three scanners in parallel

Launch all three subagents at the same time, in a single message with three
Agent tool calls, so they run concurrently:

- @supabase-security-scanner — the Supabase setup: RLS, policies, keys,
  Storage buckets, policies that trust user-editable data.
- @nextjs-security-scanner — the Next.js app: secrets behind `NEXT_PUBLIC_`,
  data passed to Client Components, Server Actions and route handlers that do
  not re-check the user, missing per-record authorisation.
- @vercel-security-scanner — the deployment layer: environment variable
  scoping, Deployment Protection, served security headers, committed secrets.

Tell each scanner that this is a findings-only audit: it must not modify
code, configuration or any external setting, and must return its findings
grouped by severity, each with the affected file and line (or setting), the
problem, why it matters, and a suggested fix.

## 2. Wait for all three

Do not start the combined report until every scanner has returned. If a
scanner fails or cannot complete, say so in the report and name what it
could not check; never present a partial scan as complete.

## 3. Combine the findings into one report

Group every finding under exactly these headings, in this order:

- **Critical**
- **High**
- **Medium**
- **Low**

Write "None." under a heading with no findings. Keep each scanner's own
severity. For each finding give: a short title, the affected file:line or
setting, the problem, the suggested fix, and the reporting scanner(s) in
brackets, e.g. `[nextjs-security-scanner]`.

## 4. Deduplicate

When two or more scanners report the same underlying issue (the same file,
setting or root cause, even if worded differently), list it once and name
every scanner that reported it, e.g.
`[nextjs-security-scanner, vercel-security-scanner]`. If they rated it
differently, file it under the highest severity and note the other ratings.
Do not merge findings that only look alike but have different causes.

## 5. Finish with a summary

End with a short summary: the finding count per severity, the number of
duplicates merged, any scanner that failed or was limited, and the one or two
issues to fix first. Do not fix anything.
