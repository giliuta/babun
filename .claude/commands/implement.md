---
name: implement
description: Implement a story that already has a plan in docs/stories/
argument-hint: [story-id] (e.g. 001)
---

Implement STORY-$ARGUMENTS.

**Prerequisites check:**
1. Verify `docs/stories/STORY-$ARGUMENTS.md` exists. If not — tell user to run `/plan` first.
2. Read the story completely. Do not skim.
3. Read `docs/coding-patterns.md`.
4. If the story has `Status: done` — ask if they want to re-implement or add something.
5. If the story has `Dependencies:` that are not `done` — stop and warn.

**Implementation order (strict):**
1. **Database migrations** (if any) → `supabase/migrations/` (write the file; applying to prod is the owner's call)
2. **Types** → `packages/shared/src/db/database.types.ts` and the feature's own types
3. **Domain / data layer** → `packages/shared/src/local/*`, repositories in `packages/shared/src/db/repositories/*`
4. **Server-side logic** (if any) → Supabase RPC in a migration, or `supabase/functions/<name>/`
5. **Providers / query wiring** → `apps/mobile/src/providers/*`, feature `queries.ts` / `mutations.ts`
6. **Feature components** → `apps/mobile/src/features/<feature>/*`, shared primitives in `apps/mobile/src/components/ui/*`
7. **Routes** → `apps/mobile/app/**` (expo-router; the route file stays thin)
8. **Tests** → `bun:test`, file next to the code it covers (`*.test.ts`)

**Per-file checklist:**
- Does it follow `docs/coding-patterns.md`?
- Is the file < 400 lines?
- Named exports, not default (except expo-router route files)?
- No `any` types?
- Error handling at boundaries?

**After a batch of related files:**
- Run `bun run typecheck` — must be green
- Run `bun test` — must be green
- Run `bun run lint` — no new errors
- If UI changed: look at it in the simulator next to its neighbouring states and
  attach the screenshot. "It compiles" is not evidence.

**Committing:**
- One logical change = one commit
- Message format: `feat(STORY-$ARGUMENTS): {what}` or `refactor(STORY-$ARGUMENTS): {what}`
- Commit locally. Pushing and opening a PR happen only when the owner asks.

**When done:**
1. Update `Status: done` in the story file
2. Add a brief "Notes" section at the bottom with surprises / lessons learned
3. Commit the story update
4. Run `/status` to confirm everything is green
