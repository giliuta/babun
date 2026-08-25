---
name: review
description: Code review of uncommitted changes and recent commits. Run before pushing.
---

Review all changes relative to `origin/master`:

1. Run `git diff origin/master..HEAD` for committed changes + `git diff` for staged/unstaged
2. Run `git status --short` to see what's pending
3. For each changed file, check against the checklist below

**Checklist (block on any ❌):**

### TypeScript
- [ ] No `any`, no `ts-ignore`, no unsafe casts
- [ ] Interfaces for all component props
- [ ] Type imports use `import type`
- [ ] `bun run typecheck` passes

### Architecture
- [ ] No business logic in components — lives in `packages/shared/src/local/*` or the feature's own `*.ts`
- [ ] Route files in `apps/mobile/app/**` stay thin — screens live in `src/features/*`
- [ ] No new persisted key without matching load/save helpers (MMKV / expo-sqlite / Supabase)
- [ ] tenant_id enforced at DB level via RLS / `current_tenant_id()`, never trusted from the client
- [ ] No credentials / secret keys hardcoded
- [ ] No `console.log` in production code paths (ok in dev utilities / catch blocks where commented)

### UI
- [ ] Radius only `rounded-[10px]` / `rounded-t-[10px]` / `rounded-full` — no `rounded-xl/2xl/3xl`, no stray numbers
- [ ] Rising panels go through the canonical `BottomSheet`, never a hand-rolled `Modal animationType="slide"`
- [ ] Настройка = страница, действие = лист (`ToggleListScreen` / `PickerSheet`), no bespoke list layout
- [ ] Time is always the two looped wheels (`TimeWheelPair`), on every surface
- [ ] Safe areas via `useSafeAreaInsets()` on anything touching a screen edge
- [ ] Colors from `useThemeColors()` — no hex literals outside `src/theme/`
- [ ] Touch targets ≥ 44pt (or `hitSlop` making them so)
- [ ] Russian text in UI, English in code

### Tests
- [ ] `bun test` passes
- [ ] A bug fix carries a regression test

### Commits
- [ ] Each commit is one logical change
- [ ] Commit messages follow format `type: description` or `type(scope): description`
- [ ] No `--no-verify`, no force push, no amend of public commits

**Output:**
```
🔍 Review Summary
━━━━━━━━━━━━━━━━━━━━
Files changed: N
Blockers:      0 or list
Warnings:      N or list
Verdict:       ✅ Approve / ⚠ Approve with comments / ❌ Changes requested
━━━━━━━━━━━━━━━━━━━━
```

If blockers — do NOT push. List each with file:line and a fix suggestion.
