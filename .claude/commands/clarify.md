---
name: clarify
description: Socratic clarification before planning. Surface hidden assumptions before a single line of code. Run this before /plan on vague or non-trivial features.
argument-hint: [feature or problem in a sentence]
---

Surface what is actually being asked before anything is built. Don't generate code, don't write a plan — just drill down until the requirements are clear.

**Step 1 — restate the ask**

In one sentence, play back what you understood from "$ARGUMENTS". Flag any ambiguity you already see.

**Step 2 — ask 5 to 12 yes/no or A-B-C questions**

Pick only the questions that actually matter. Skip what is already obvious from Babun context (Expo/RN на iOS, Android и Web из одного кода, данные в Supabase, phone-first — это в `AGENTS.md`).

Prioritize in this order:
1. **Scope boundaries** — what is definitely IN and OUT of this feature
2. **User flow choices** — where the user can go wrong, what path wins
3. **Data model decisions** — what new fields, what to reuse, what to migrate
4. **UX surfaces** — which screens this touches, which stay untouched
5. **Edge cases** — what happens on empty / many / concurrent / offline
6. **Success criteria** — how we'll know when this is done

Format each question as one line. Number them. Give at most 3 options (A/B/C). If the answer is "your call, decide for me" — note your default and move on.

**Step 3 — clarity score**

After the user answers, rate clarity on 4 dimensions 1-5:
- Scope — do we know what's in/out?
- Data — is the model decided?
- UX — are the screens and states mapped?
- Done-ness — is success testable?

If any dimension is below 4, ask one more round of questions on that axis only. Do not run `/plan` until all dimensions are 4+.

**Step 4 — handoff**

When the score is 4+ across the board, output:
- Summary in 3-5 bullets of what you now know
- Recommended STORY number for `/plan`
- One-line suggested feature name

Then tell the user: "Готово — запусти `/plan {name}` чтобы зафиксировать это в STORY-NNN.md."

**Don't do:**
- Don't write code
- Don't create files
- Don't invent features that weren't asked
- Don't ask more than 12 questions in a round — people tune out
