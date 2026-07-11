# OnTask — Build Plan for Claude Code (chunked, one task at a time)

Companion to `OnTask_Architecture.md` and `OnTask_Product_PRD.md`. This document is written **for Claude Code**. It breaks the build into small, sequential, independently testable tasks.

---

## ⚠️ HOW TO USE THIS FILE — read before doing anything

**You (Claude Code) must work ONE task at a time, in order — but run continuously.** Do not build multiple tasks in one pass. Do not implement a whole phase at once. Do not scaffold the entire app ahead of the plan. Complete a task, verify it, then move to the next one on your own — the human should not have to approve every step.

For **each** task:
1. Do only what that task's "Steps" describe. Touch only the files it lists.
2. Run the task's "Test" and confirm the "Done when" criteria are met.
3. **If the test PASSES:** commit with the task ID (e.g. `T3.2: local cosine scoring`), then continue automatically to the next task. Do not wait for approval.
4. **HARD STOP and report** only when: a test fails and you can't fix it within the task's own scope; the plan conflicts with what you find in the real Min codebase; or a step would be destructive/irreversible. Never push forward past a failure — a silent failure poisons everything downstream.

Keep each change minimal and reversible. If a test fails, fix within the same task's scope — do not pull work forward from later tasks to make it pass.

Tasks are labeled `T<phase>.<n>`. Phases must be done in order. Within reason, tasks within a phase are also ordered.

**UI-first:** the styled UI must appear on screen as early as possible. Phase 1 builds the task-intake screen and focus bar **already styled** from `ontask-pastel.html` — not in Min's default look, and not deferred to Phase 8. The engine is wired in behind an already-good-looking UI.

---

## Conventions

- **Repo:** the Min fork, cloned locally (Phase 0). Work on a branch `ontask`.
- **Run:** `npm run start` (Min dev mode). Reload UI with the Min hotkey after chrome changes.
- **Test types:** each task states whether its test is *manual* (do X in the running browser, observe Y) or *automated* (a script/log assertion). For a hackathon, manual visual confirmation is acceptable and expected for most UI/DOM tasks — but every task has an explicit observable pass condition.
- **Styling reference:** `ontask-pastel.html` is the visual source of truth for the chrome. Intake + focus bar are styled from it in Phase 1; Phase 8 finishes the remaining chrome (tab rail, affordances).
- **Decisions:** all product decisions are in the Product PRD. When in doubt, that doc wins.

---

## Phase 0 — Baseline and the one load-bearing check

> Goal of the phase: prove Min builds and that we can run our own code inside a third-party page (YouTube). Nothing else matters until this works.

### T0.1 — Clone and build Min
- **Goal:** get Min running locally, unmodified.
- **Steps:** clone the Min repo; `npm install`; `npm run start`.
- **Test (manual):** Min launches, loads a webpage, tabs work.
- **Done when:** the unmodified browser runs. **On pass: commit and continue. On fail: stop and report.**

### T0.2 — Confirm preload reach into YouTube
- **Goal:** prove a preload script executes inside a loaded YouTube page.
- **Steps:** locate Min's per-page preload; add a single `console.log('ONTASK preload alive', location.href)`.
- **Test (manual):** open a YouTube watch page; open devtools for that page; confirm the log appears.
- **Done when:** the log fires inside YouTube. If it does NOT, **STOP and report** — the architecture depends on this and we must resolve it before continuing.

### T0.3 — Confirm main↔preload IPC
- **Goal:** prove the preload can send a message to the main process and get a reply.
- **Steps:** add a trivial IPC round-trip (preload sends `ping`, main replies `pong`, preload logs it).
- **Test (manual):** load any page; confirm `pong` logged.
- **Done when:** round-trip works. **On pass: commit and continue. On fail: stop and report.**

---

## Phase 1 — Focus Session store and task intake

> Goal: one shared task context, set once on open, visible in the chrome. No engine yet.

### T1.1 — FocusSessionStore (empty)
- **Goal:** a main-process singleton holding the session object (task, subtask, allowlist, overrides, startedAt), with get/set + an IPC read for tabs.
- **Files:** `main/focusSession.js`.
- **Test (automated/log):** from main, set a dummy task, read it back, log it.
- **Done when:** store holds and returns a task. **On pass: commit and continue. On fail: stop and report.**

### T1.2 — Task-intake screen (styled)
- **Goal:** on open with no active session, show the "What are you working on today?" screen — **built from `ontask-pastel.html`'s intro screen** (pastel look, Plus Jakarta Sans, the placeholder example, the Start-focus button). Free text; on submit, write the task to the store and dismiss.
- **Files:** `chrome/intake/*` (port markup + CSS from `ontask-pastel.html`).
- **Test (manual):** launch → intake appears → type a task → submit → intake closes; log confirms the store has the task.
- **Done when:** task is captured into the store from the UI. **On pass: commit and continue. On fail: stop and report.**

### T1.3 — Persistent focus bar (styled)
- **Goal:** the persistent pinned focus card (task + subtask line) **styled from `ontask-pastel.html`'s `.focus` card**, reading from the store; visible on every tab. This is the first on-screen proof the real UI look is live.
- **Files:** `chrome/focusBar/*` (port markup + CSS from `ontask-pastel.html`).
- **Test (manual):** after setting a task, the bar shows it; open a new tab — the bar still shows it (no re-prompt).
- **Done when:** task persists across tabs in the UI. **On pass: commit and continue. On fail: stop and report.**

### T1.4 — Resume-or-new + immutability
- **Goal:** persist the task on session end; on relaunch offer "Resume <task>" or "Start new". Ensure there is no code path to edit the task mid-session.
- **Files:** `main/persistence.js`, intake screen.
- **Test (manual):** set task, quit, relaunch → offered resume/new; choose resume → same task in bar. Confirm no "edit task" control exists.
- **Done when:** resume/new works and task is immutable in-session. **On pass: commit and continue. On fail: stop and report.**

---

## Phase 2 — DOM read bridge

> Goal: read page text reliably via a per-site adapter, and be able to apply a class to nodes. No scoring yet.

### T2.1 — YouTube adapter skeleton
- **Goal:** an adapter module that matches YouTube and declares selectors for recommendation cards on the **watch page only** (home/search come later), plus a text-extraction function.
- **Files:** `adapters/youtube.js`.
- **Test (manual):** on a watch page, run the adapter's card query in devtools; confirm it returns the related-video cards.
- **Done when:** the selector reliably returns watch-page rec cards. **On pass: commit and continue. On fail: stop and report.**

### T2.2 — DomReader collects card text
- **Goal:** preload uses the adapter to collect `{id, text}` for each rec card and logs them.
- **Files:** `preload/domReader.js`, `preload/bridge.js`.
- **Test (manual):** load a watch page; console shows a list of card ids + extracted text (title + channel + any snippet).
- **Done when:** real card text is captured. **On pass: commit and continue. On fail: stop and report.**

### T2.3 — MutationObserver for infinite feed
- **Goal:** re-collect newly added cards on scroll, batched and debounced.
- **Files:** `preload/domReader.js`.
- **Test (manual):** scroll the related feed; new cards get logged without duplicating old ones; no visible lag.
- **Done when:** new cards are picked up on scroll. **On pass: commit and continue. On fail: stop and report.**

### T2.4 — SurfaceApplier can mark nodes
- **Goal:** apply a CSS class (e.g. `.ontask-hidden`) to any card by id, and inject a stylesheet that hides `.ontask-hidden`.
- **Files:** `preload/surfaceApplier.js`.
- **Test (manual):** manually hide 2 cards by id from devtools via the applier; they disappear.
- **Done when:** nodes can be hidden/revealed programmatically. **On pass: commit and continue. On fail: stop and report.**

---

## Phase 3 — Local relevance engine

> Goal: score card text locally against the task and actually hide off-task cards on the watch page. Still no Groq.

### T3.1 — Bundle and load MiniLM
- **Goal:** bundle `all-MiniLM-L6-v2` (transformers.js/ONNX) and load it in the main process (or a worker); embed a test string.
- **Files:** `main/relevanceEngine.js`, `models/minilm/*`.
- **Test (automated/log):** embed "hello world"; log vector length (384).
- **Done when:** model loads offline and produces embeddings. **On pass: commit and continue. On fail: stop and report.**

### T3.2 — Embed the task + cosine scoring
- **Goal:** on session start compute the task embedding; add a `score(text)` returning `max(sim(task), sim(subtask))` (subtask may equal task for now).
- **Files:** `main/relevanceEngine.js`, `main/focusSession.js`.
- **Test (automated/log):** score an obviously on-task string and an obviously off-task string; confirm the on-task score is clearly higher.
- **Done when:** scoring discriminates on/off task. **On pass: commit and continue. On fail: stop and report.**

### T3.3 — Wire scoring to the watch-page rec cards
- **Goal:** DomReader text → engine → verdict per band (≥0.55 on, 0.40–0.55 ambiguous, <0.40 off) → SurfaceApplier hides `off` cards. For now treat `ambiguous` as **hidden** (matches the block-while-pending stance; Groq comes in Phase 4).
- **Files:** engine + bridge + applier.
- **Test (manual):** set task "write my statement of purpose"; on an SOP video, off-task cards (entertainment, etc.) disappear, SOP-related ones remain.
- **Done when:** the watch-page panel visibly curates. **On pass: commit and continue. On fail: stop and report.** *(This is the first demo-able moment.)*

### T3.4 — Hide-by-default (no flash)
- **Goal:** inject hiding CSS so cards start hidden and are revealed only when scored on-task, preventing flash-of-unfiltered-content.
- **Files:** `preload/surfaceApplier.js`.
- **Test (manual):** hard-reload a watch page; off-task cards never visibly flash before being hidden.
- **Done when:** no unfiltered flash on load. **On pass: commit and continue. On fail: stop and report.**

### T3.5 — Cold-start + unscoreable rules
- **Goal:** before the model is warm, show cards, then filter once ready (fail open at startup). Leave text-less/unscoreable cards visible.
- **Files:** engine + applier.
- **Test (manual):** relaunch and immediately open a watch page; nothing is stuck hidden; thumbnail-only/no-text cards stay visible.
- **Done when:** cold start and unscoreable items behave per spec. **On pass: commit and continue. On fail: stop and report.**

---

## Phase 4 — Groq assist

> Goal: expand the goal at session start and resolve ambiguous items via Groq, with block-while-pending.

### T4.1 — GroqClient
- **Goal:** a thin client for Groq (key from env/config), with one method for a prompt→text call and error handling.
- **Files:** `main/groqClient.js`.
- **Test (automated/log):** send a trivial prompt; log the response. Simulate no-network; confirm it errors cleanly (no crash).
- **Done when:** Groq call works and fails gracefully. **On pass: commit and continue. On fail: stop and report.**

### T4.2 — Goal expansion at session start
- **Goal:** on task submit, call Groq to expand the task into intent + keywords + an initial domain allowlist; store them. If Groq is unreachable, start in local-only degraded mode (raw task text only).
- **Files:** `groqClient.js`, `focusSession.js`, intake flow.
- **Test (manual):** set a task; log shows expanded intent + allowlist. Kill network, set a task; session still starts, log notes degraded mode.
- **Done when:** expansion works online and degrades offline. **On pass: commit and continue. On fail: stop and report.**

### T4.3 — Ambiguity tiebreaker (block-while-pending)
- **Goal:** ambiguous-band items are sent to Groq for an on/off verdict; **while pending they remain hidden**; cache verdicts by id.
- **Files:** `relevanceEngine.js`, applier.
- **Test (manual):** craft/find a borderline card; confirm it stays hidden until Groq replies, then reveals only if on-task; repeat visit uses cache (no second call).
- **Done when:** ambiguous items block-then-resolve and cache. **On pass: commit and continue. On fail: stop and report.**

---

## Phase 5 — Recommendations across all YouTube surfaces

> Goal: extend curation from the watch page to home and search (Q26). One surface per task.

### T5.1 — Home feed adapter + curation
- **Goal:** add home-feed selectors to the YouTube adapter; curate the home grid with the same engine.
- **Files:** `adapters/youtube.js`, applier.
- **Test (manual):** on YouTube home with a task set, off-task home cards are hidden; on-task remain; empty if none.
- **Done when:** home feed curates. **On pass: commit and continue. On fail: stop and report.**

### T5.2 — Search results adapter + curation
- **Goal:** add search-results selectors; curate search results.
- **Files:** `adapters/youtube.js`, applier.
- **Test (manual):** run a search; off-task results hidden, on-task shown.
- **Done when:** search curates. **On pass: commit and continue. On fail: stop and report.**

### T5.3 — Empty-panel behavior
- **Goal:** when no cards qualify on any surface, leave the panel genuinely empty (no fallback message).
- **Files:** applier.
- **Test (manual):** force an all-off-task state; the panel is calmly empty, layout not broken.
- **Done when:** empty state is clean. **On pass: commit and continue. On fail: stop and report.**

### T5.4 — Autoplay interception
- **Goal:** intercept the autoplay next-target; if off-task, stop/replace it.
- **Files:** `adapters/youtube.js`, a main/preload hook.
- **Test (manual):** let an on-task video end with an off-task autoplay target queued; confirm autoplay does not proceed to the off-task video.
- **Done when:** off-task autoplay is stopped. **On pass: commit and continue. On fail: stop and report.**

---

## Phase 6 — Navigation guard

> Goal: hard-block off-task cross-domain navigation and bounce back; always allow auth.

### T6.1 — NavigationGuard intercept
- **Goal:** intercept top-level navigations in the main process; log intended destination + an allow/block decision (no enforcement yet).
- **Files:** `main/navigationGuard.js`.
- **Test (manual):** navigate around; log shows each destination and a decision.
- **Done when:** navigations are observable with decisions. **On pass: commit and continue. On fail: stop and report.**

### T6.2 — Allowlist + auth allow + enforcement
- **Goal:** allow same-domain and allowlisted domains and known auth domains; **block** off-task cross-domain and redirect to the previous on-task page.
- **Files:** `navigationGuard.js`, `focusSession.js`.
- **Test (manual):** with an SOP task, try to open an unrelated site → blocked, bounced back; a Google login redirect still works.
- **Done when:** off-task nav blocks + bounces; auth unaffected. **On pass: commit and continue. On fail: stop and report.**

### T6.3 — User-editable allowlist
- **Goal:** a minimal UI to view/add/remove allowlist domains for the session.
- **Files:** `chrome/focusBar/*` or a small settings panel.
- **Test (manual):** add a domain; it becomes reachable; remove it; it blocks again.
- **Done when:** allowlist is editable in-session. **On pass: commit and continue. On fail: stop and report.**

---

## Phase 7 — Page-content surface

> Goal: collapse off-task sections on on-task pages (reversible); block off-task primary pages.

### T7.1 — Off-task section collapse (reversible)
- **Goal:** using content-section selectors, hide off-task sections within an on-task page, each with a one-click "show anyway".
- **Files:** `adapters/youtube.js`, applier.
- **Test (manual):** on an on-task page with a mixed sidebar/section, off-task sections collapse; "show anyway" reveals one.
- **Done when:** section collapse + reveal works. **On pass: commit and continue. On fail: stop and report.**

### T7.2 — Block off-task primary content
- **Goal:** if the main content of the page itself scores off-task (user opened an off-task video directly), block the page and return to the previous on-task page.
- **Files:** adapter (main-content selector), navigationGuard/applier.
- **Test (manual):** open an off-task video directly by URL → blocked, bounced back.
- **Done when:** off-task primary pages are blocked. **On pass: commit and continue. On fail: stop and report.**

---

## Phase 8 — Chrome polish (remaining pieces)

> Goal: finish the pastel chrome. Intake + focus bar were already styled in Phase 1, so this phase is only the tab rail, global tokens, and curation affordances. Pure styling/markup; no logic changes.

### T8.1 — Vertical tab rail + global pastel tokens
- **Goal:** apply the palette/tokens from `ontask-pastel.html` globally across the chrome, and convert Min's horizontal tab strip to a left vertical rail matching the prototype.
- **Files:** `chrome/tabs/*`, global chrome CSS.
- **Test (manual):** tabs render vertically in the pastel style; switching tabs works; the whole chrome reads as the prototype.
- **Done when:** vertical pastel tabs work and tokens are applied globally. **On pass: commit and continue. On fail: stop and report.**

### T8.2 — Status / curation affordances
- **Goal:** the on-task status indicator, the "show anyway" affordance on hidden content, and the calm empty-panel styling.
- **Files:** applier CSS, chrome.
- **Test (manual):** affordances are visible and consistent with the pastel style.
- **Done when:** affordances styled. **On pass: commit and continue. On fail: stop and report.**

---

## Phase 9 — Failure and fallback hardening

### T9.1 — Fail open on model failure
- **Goal:** if the model fails to load or inference throws, disable enforcement entirely and browse normally.
- **Files:** engine + appliers.
- **Test (manual):** force a model-load error; browser works as a normal browser, nothing stuck hidden/blocked.
- **Done when:** total failure fails open. **On pass: commit and continue. On fail: stop and report.**

### T9.2 — Broken-selector no-op
- **Goal:** if adapter selectors return nothing (site changed), that surface no-ops silently + logs; no user error.
- **Files:** adapter, appliers.
- **Test (manual):** break a selector on purpose; that surface stops curating, rest of browser fine.
- **Done when:** broken selectors degrade silently. **On pass: commit and continue. On fail: stop and report.**

---

## Phase 10 — Demo prep

### T10.1 — Scripted demo path
- **Goal:** preload the exact task and the exact on-task YouTube video for the on-stage sequence; verify each demo beat (curate → new tab knows task → off-task blocked/bounced → autoplay stopped).
- **Test (manual):** run the full 90-second sequence end to end twice without failure.
- **Done when:** the demo path is bulletproof. **On pass: commit and continue. On fail: stop and report.**

### T10.2 — Fallback
- **Goal:** confirm `ontask-pastel.html` still runs as a standalone fallback if the live build misbehaves on stage.
- **Test (manual):** open the prototype; the curated-vs-raw toggle works.
- **Done when:** fallback verified. **On pass: commit and continue. On fail: stop and report.**

---

## Progress tracker

```
Phase 0  [x] T0.1  [x] T0.2  [x] T0.3
Phase 1  [x] T1.1  [ ] T1.2  [ ] T1.3  [ ] T1.4
Phase 2  [ ] T2.1  [ ] T2.2  [ ] T2.3  [ ] T2.4
Phase 3  [ ] T3.1  [ ] T3.2  [ ] T3.3  [ ] T3.4  [ ] T3.5
Phase 4  [ ] T4.1  [ ] T4.2  [ ] T4.3
Phase 5  [ ] T5.1  [ ] T5.2  [ ] T5.3  [ ] T5.4
Phase 6  [ ] T6.1  [ ] T6.2  [ ] T6.3
Phase 7  [ ] T7.1  [ ] T7.2
Phase 8  [ ] T8.1  [ ] T8.2
Phase 9  [ ] T9.1  [ ] T9.2
Phase 10 [ ] T10.1 [ ] T10.2
```

**Styled UI is live at the end of Phase 1** (intake + focus bar from the prototype). **First functional demo moment: T3.3** (watch-page curation). If time gets tight, the minimum lovable path is Phase 0 → 1 (styled UI) → 2 → 3 (curation) → T10 demo prep. Phases 4–7 deepen it; Phase 8 finishes the chrome.
