---
name: plan
description: Plan a new feature — creates docs/stories/STORY-NNN.md. ALWAYS run before writing code.
argument-hint: [feature-name]
---

Plan a new feature called "$ARGUMENTS" for Babun.

**Required reading first:**
1. `AGENTS.md` — golden rules (`CLAUDE.md` is only a pointer to it)
2. `docs/architecture.md` — current architecture
3. `docs/coding-patterns.md` — how to write code
4. `docs/roadmap.md` — where this fits in priorities

**Then:**
1. Look at existing `docs/stories/` — pick the next STORY number (increment highest)
2. Ask the user clarifying questions if the scope is ambiguous. Don't invent requirements.
3. Create `docs/stories/STORY-NNN.md` with this structure:
   - **Status:** `todo`
   - **Estimate:** story points 1-8 (if > 8 — tell user to split)
   - **Dependencies:** which other stories this needs
   - **User story:** `As {role}, I want {capability}, so that {benefit}`
   - **Why now:** 2-3 sentences of motivation
   - **Acceptance criteria:** 5-10 concrete, testable items
   - **Technical plan:** file list, schema changes, API routes, migrations
   - **Files touched:** table with Create/Modify/Delete column
   - **Out of scope:** what we are NOT doing in this story
   - **Risks:** what could go wrong
4. Show the story file to the user
5. **STOP.** Do not write code. Wait for approval ("ок", "делай", "go ahead").

If the user asks to skip planning because the change is trivial (< 30 lines, one file) — you may proceed, but still mention that you're skipping the plan.
