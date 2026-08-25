---
name: setup
description: Verify dev environment is ready for Babun work
---

Verify the dev environment is configured correctly for Babun.

**Checks (in parallel where possible):**

1. Working directory is the repository root — `git rev-parse --show-toplevel`
   must succeed and contain `apps/mobile`. If not, stop.
2. `git remote -v` — must include `origin  https://github.com/giliuta/babun2.git`
3. `git branch --show-current` — must be `master`
4. `ls apps/mobile/package.json packages/shared/package.json` — both workspaces exist
5. `bun --version` — bun is the package manager and the test runner; there is no npm lockfile
6. `ls apps/mobile/node_modules/expo/package.json` — dependencies installed
7. `bun run typecheck` — typecheck baseline (0 errors expected)
8. `bun test` — test baseline (0 failures expected)
9. Check `docs/` exists with `architecture.md`, `coding-patterns.md`, `roadmap.md`
10. Check `.claude/commands/` has plan/implement/test/review/status/debug/setup

**Output format:**
```
🔧 Setup Check
━━━━━━━━━━━━━━━━━━━━━━━
Working dir:     ✅ repo root
Git:             ✅ master @ origin
bun:             ✅ vX.Y.Z
Dependencies:    ✅ installed
TypeScript:      ✅ clean
Tests:           ✅ N pass
Docs:            ✅ present
Commands:        ✅ all 7 present
━━━━━━━━━━━━━━━━━━━━━━━
Status: READY
```

If ANY check fails, stop and print the fix command. Don't auto-fix without permission.
