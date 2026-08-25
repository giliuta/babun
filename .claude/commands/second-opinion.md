---
name: second-opinion
description: Get an independent review of the current diff from a fresh agent. Useful before pushing risky changes (migrations, auth, data loss risk, SRE-y things).
argument-hint: [optional: extra context for the reviewer]
---

Get a fresh pair of eyes on what's currently uncommitted or just committed. The reviewer is a separate agent that didn't see our conversation — it reads the diff cold and reacts.

**Step 1 — capture what to review**

Run:
```
git status
git diff
git log --oneline -5
```

Identify:
- Files changed (scope)
- What kind of change this is (feature / fix / refactor / migration / infra)
- Is anything destructive (schema changes, deletes, force-push risk)?

**Step 2 — pick the right reviewer persona**

Based on what changed, spawn an Agent with the best-fit `subagent_type`. Only the
agents that actually exist in `.claude/agents/` can be spawned — the full index is
`docs/agents.md`:

- **Code quality / refactors** → `reviewer`
- **Security-sensitive** (auth, SQL, secrets, RLS, multi-tenant leaks) → `security-auditor`
- **Architectural changes** (new modules, cross-boundary) → `architect`
- **Data model / schema / migrations** → `architect`, plus `babun-data-loss-guardian`
  when a delete or a cascade is involved
- **UI change** → `babun-design-system-keeper` and `babun-mobile-ux-auditor`
- **A single screen area** → the matching `babun-*-expert` (calendar, clients,
  finance, brigades, settings, appointment form)
- **Mixed / general** → `reviewer`

**Step 3 — brief the agent like a cold colleague**

The agent hasn't seen our conversation. Give it:
- Exact command to run (usually `git diff` or `git diff origin/master...HEAD` —
  the default branch here is `master`, not `main`)
- 2-3 sentences of business context: what this is for, what we're trying to avoid
- Specific question to answer: "Is this safe to push?" / "Does this break X?" / "Any regressions I missed?"
- Cap the response: "Report in under 250 words — bullets, not prose."

**Step 4 — present findings to the user**

Show the reviewer's response verbatim (it's another agent's opinion, not mine — don't paraphrase).

Then:
- If the reviewer flagged **blockers** → list them, stop, wait for user decision
- If the reviewer flagged **nice-to-haves** → summarize, ask if we should address before push
- If the reviewer said **ship it** → say so, suggest push command

**Don't do:**
- Don't spawn a reviewer if the diff is empty or trivial (< 10 lines)
- Don't merge my opinion into the reviewer's — keep them separate so the user sees real disagreement
- Don't silently fix what the reviewer flagged — always surface to the user first
- Context from "$ARGUMENTS" goes into the agent brief, but don't just echo it back to the user
