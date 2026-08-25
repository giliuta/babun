---
name: walkthrough
description: Simulate a real user walking through a screen or flow before shipping. Rates each step on usability heuristics (clarity, thumb zone, typography, cognitive load, feedback, error recovery). Catches "looks fine on my machine" mistakes.
argument-hint: [screen or flow to audit, e.g. "create appointment" or "/dashboard/clients/[id]"]
---

Walk through "$ARGUMENTS" as a real user would. No implementation, no code changes — just an honest UX audit. Write for Dima specifically, not a generic customer.

**Step 1 — pick the persona and context**

Babun's primary persona is a **dispatcher / crew lead on a scooter in Cyprus, mid-summer, one hand on the phone, one on the bike handle, LTE flaky, AirPods in one ear**. Not a desktop user. Not a casual visitor.

State explicitly:
- **Who** is walking through (dispatcher / lead / client-facing crew / admin)
- **Context** (one-handed, backlit sun, rush, glove on, wet hands — whichever fits)
- **Job-to-be-done** — the one thing they came here for ("записать клиента за 20 секунд", "посмотреть адрес и маршрут за 3 секунды")
- **Success criterion** — how do they know they're done

**Step 2 — map the physical path**

Open the screen. List every observable element **in visual order, top-to-bottom, left-to-right**. Use `file_path:line` references to the actual JSX. If an element is rendered conditionally, note the condition.

**Step 3 — simulate the flow tap by tap**

For each tap, long-press, swipe, scroll:
1. Describe what the user sees **right before** the action
2. Say what they tap and what they expect to happen
3. Say what actually happens (from reading the code — not guessing)
4. Flag the delta between expectation and reality, if any

**Step 4 — rate each step against heuristics**

For every step, score 1-5 on these axes. Mark anything below 4 as `⚠` with a one-line fix.

- **Clarity** — is the next action obvious without reading? (Nielsen's "recognition over recall")
- **Thumb zone** — is the primary tap target in the easy reach of a right-handed thumb on a 6.1" phone? (Fitt's law — bigger and closer = faster, 44×44 pt minimum — or a `hitSlop` that gets there)
- **Cognitive load** — how many decisions per screen? (Hick's law — fewer options = faster choice; Miller's 7±2 — working memory limit)
- **Typography** — is the body text ≥13 pt? Is hierarchy clear? Is contrast enough for sun / low vision? (units here are pt/dp — there are no CSS pixels in RN)
- **Feedback** — does every tap produce visible change within 100 ms? Loading indicators where things take longer?
- **Error recovery** — if the user screws up, is the escape cheap? (back / undo / confirm-before-destroy)
- **Emotional tone** — does the screen feel calm / panicked / empty / cluttered? Is the user in control or being rushed?

**Step 5 — compare against the real-world constraints**

This is a native Expo/RN app, not a web page — walk it in the iPhone simulator
(skill `babun-sim`). RN-Web is a second target, never the reference.

- Safe area — every bottom bar pays `useSafeAreaInsets().bottom`, every fixed
  header pays `.top`. Nothing may sit on the home-indicator strip: a money button
  there gives the system swipe instead of the transfer.
- Keyboard — an input focused inside a `BottomSheet` must not hide the sheet's
  footer button (`avoidKeyboard`; the footer pays the bottom inset only while the
  keyboard is DOWN).
- Gestures — RN gesture-handler compositions, not browser scroll: a pan fighting a
  scroll, a swipe eating a tap, a long-press racing a context menu
  (`Gesture.Exclusive` / `Gesture.Race` / `Gesture.Native`). Note that an RN `Switch` needs a long
  press (~160 ms) in the simulator — repeat the gesture before calling it a bug.
- The tab bar never hides, and a second tap on the active tab unwinds its stack.
- One-handed use — is the primary action in the bottom third of the screen?
- Slow connection — does the screen degrade gracefully or hang blank?
- Dark sun / bright street — does the contrast still read? (the app is light-only —
  there is no dark palette to check)
- AirPods half-in — is there anything sound-dependent (there shouldn't be)?

**Step 6 — output a prioritized fix list**

Format:
```
P0 — ship-blockers (data loss, unreachable action, unreadable text on common screens)
P1 — frequent friction (extra taps, confusing labels, missing feedback)
P2 — polish (microcopy, spacing, animations)
```

Each item:
- One-line description
- `file_path:line` pointing to the exact offender
- Proposed fix in 1-2 sentences

**Don't do:**
- Don't write patches inside this walkthrough — suggest, don't ship. A separate `/implement` or manual edit comes after.
- Don't rate anything 5/5 without evidence — "I walked through it and it was fine" is not the same as "here's why I gave it a 5 on clarity"
- Don't generalize. Speak in terms of Dima on a scooter, not "users in general"
- Don't lean on "modern trends". Lean on heuristics and observed behaviour
- Don't hide trade-offs. If fixing P1 would break P2's emotional tone, say so
