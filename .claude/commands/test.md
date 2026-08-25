---
name: test
description: Полная проверка репозитория — typecheck, тесты, lint (apps/mobile + packages/shared)
---

Run the full verification suite from the repository root (not from a workspace —
every script below already forwards into `apps/mobile`):

1. **TypeScript** — `bun run typecheck`
   - Must be zero errors
   - If there are errors, list the first 20 lines of output and stop
2. **Tests** — `bun test`
   - `bun:test` runner, tests live next to the code they cover
   - A single failing test is a blocker; show its name and the assertion diff
3. **ESLint** — `bun run lint`
   - Report new errors compared to `master` (if possible)
   - Existing known warnings (unused vars, etc.) are acceptable unless explicitly asked to fix
4. **Web build dry-run** (optional, slower) — if user says "full test": `bun run build:web`
   - `expo export --platform web`; this is what Vercel runs on every push

Report format:
```
📋 Test Report
━━━━━━━━━━━━━━━━━━━━
TypeScript:  ✅ clean  |  ❌ N errors
Tests:       ✅ N pass  |  ❌ N fail
ESLint:      ✅ clean  |  ⚠ N warnings  |  ❌ N errors
Build:       ✅ success  |  ❌ failed  |  ⏭ skipped
━━━━━━━━━━━━━━━━━━━━
```

Never swallow errors. If anything fails, show the user the first ~20 lines of output.
