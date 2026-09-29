---
description: Run the Supabase, Next.js and Vercel security scanners in parallel on only the files changed on this branch compared with main. Report only; changes nothing.
---

Run a security scan of the files changed on the current branch. This is a
report-only task: do not modify any file, and do not commit, push or deploy.

1. List the files changed on this branch compared with main:

   ```bash
   git diff --name-only main...HEAD
   ```

   If the list is empty, say there is nothing to scan and stop.

2. Launch these three subagents in parallel, in a single message:

   - @supabase-security-scanner
   - @nextjs-security-scanner
   - @vercel-security-scanner

   Give each one the list of changed files and tell it to focus only on
   those files, and that it must report findings only and not modify code.

3. When all three have finished, combine their findings into one report
   grouped under **Critical**, **High**, **Medium** and **Low**. For each
   finding give the file and line, the problem, the suggested fix, and which
   scanner reported it. Write "None." under a severity with no findings.
