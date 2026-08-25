---
name: debug
description: Diagnose a bug. Fix root cause, not symptom.
argument-hint: [bug description]
---

Diagnose the issue: "$ARGUMENTS"

**Rules:**
1. **Never patch symptoms.** Find why the thing broke. If the cause isn't clear after 5 minutes, say so and ask for more info.
2. **Reproduce first.** Before proposing a fix, confirm you understand what exact input causes the failure.
3. **One fix per commit.** Do not bundle unrelated changes.
4. **Add a regression test** — `bun:test`, file next to the code it covers. The runner is already in place.

**Workflow:**
1. Ask the user for:
   - Exact error message (copy-paste)
   - Stack trace (if any)
   - Steps to reproduce
   - Expected vs actual behavior
   - Устройство / симулятор и экран (if UI bug)
2. Read the relevant code. Don't guess based on file names.
3. Check recent `git log --oneline -10` for related commits.
4. Check the "Critical Known Issues" section of `AGENTS.md` (calendar pinch-zoom,
   the period pager) — maybe you're about to reintroduce one. `docs/architecture.md`
   has no such section.
5. Propose a fix. **Explain the root cause in 2-3 sentences before writing code.**
6. Implement fix.
7. `/test` (typecheck + `bun test` + lint)
8. Commit: `fix: {what} (root cause: {why})`
9. Push only when the owner asks.

**Common anti-patterns to reject:**
- "Add a try/catch" — catches a symptom, not a cause
- "Add a check for null" — why is it null?
- "Reload on error" — why did it fail?
- "Disable the feature" — only as last resort, after user approval
