# OnTask — Product PRD

*A focus browser that holds you to one task. For students and people with ADHD, against feeds engineered to pull attention away.*

Status: draft for build. Companion docs: `OnTask_Architecture.md`, `OnTask_Build_Plan.md`.

---

## 1. Summary

Platforms spend enormous effort engineering attention away from the user's own goals. OnTask is a browser that knows the one thing you're working on and keeps the whole web pointed at it — pages, navigation, and recommendation panels. You set a single task when you open the browser; it stays fixed for the session; everything off-task is filtered, hidden, or blocked.

OnTask is deliberately assertive. This is not a gentle nudge tool: off-task pages and off-task navigation are blocked, and ambiguous items are withheld until they're confirmed on-task. The product bet is that for the target user, decisive protection beats polite suggestion.

---

## 2. Problem and who it's for

**Who:** students and people with ADHD. Executive-function difficulty makes engineered feeds genuinely disabling; a single off-task recommendation can cost an hour. This is framed as assistive tech for attention, never as clinical or diagnostic, and OnTask never labels the user.

**Problem:** the same site is productive or distracting depending on the page and the user's intent. Domain blocking is too blunt (YouTube is both a research library and a distraction machine). What's needed is intent-aware filtering that understands the user's actual task and applies it everywhere the platform tries to redirect attention.

---

## 3. Goals and non-goals

**Goals**
- Let the user set one task in seconds on open, and keep them on it for the whole session.
- Apply one relevance judgment across page content, navigation, and recommendations.
- Be decisive: block off-task pages and navigation; hide off-task recommendations; withhold ambiguous items until confirmed.
- Never brick the web — if enforcement can't run, degrade to a normal browser.
- Keep the demo (YouTube) flawless.

**Non-goals (MVP)**
- No sites beyond YouTube (but *all* YouTube surfaces are in — see scope).
- No accounts, sync, or cross-device.
- No cross-app / OS-level awareness.
- No learning loop at scale, no external search-API backfill for recommendations.
- No editing the task mid-session.

---

## 4. Product principles

1. **One task, set once, immutable.** The task is chosen on open and cannot be changed until the session ends.
2. **Decisive over polite.** Off-task = blocked or hidden, not softly suggested against.
3. **Ambient, not naggy.** No pop-up lectures. The intervention *is* the block/hide; there are no guilt prompts.
4. **Fail open on outage, fail closed on ambiguity.** A broken engine never traps the user; a genuinely ambiguous item is withheld until judged.
5. **Honest about data.** OnTask sends what it needs to Groq to judge relevance. It does not pretend nothing leaves the device, and it never sells data, serves ads, or tracks the user.

---

## 5. Core experience and flows

**5.1 Open → set task.** Browser opens to a single prompt: "What are you working on today?" Free-text entry, one greyed example as placeholder. On submit, the session starts and the task is pinned in a persistent focus bar. If a prior session exists, the user is offered **resume the previous task or start a new one** (Q2).

**5.2 Live subtask.** Under the pinned task, a live subtask line shows what the user is doing right now, inferred from the active page and updated on navigation (debounced ~1.5s). Display-only in MVP (Q5).

**5.3 Browsing on-task.** On-task pages load normally. Off-task *sections within* an on-task page are collapsed with a one-click "show anyway" (Q13–Q14).

**5.4 Off-task page → blocked.** If the user opens an off-task video or page directly, it is **blocked** — not left playable — and the user is returned to the previous on-task page (Q15, Q19).

**5.5 Off-task navigation → redirected back.** Attempting to navigate cross-domain to an off-task site is **hard-blocked**; the user is sent back to the previous on-task page. No "continue anyway" escape for navigation (Q18, Q19). Auth/login domains are always allowed so sign-ins never break (Q20).

**5.6 Recommendations curated.** Across the watch page, home feed, and search results, off-task cards are hidden. **If nothing on-task qualifies, the panel is left empty** — the calm, stripped panel is the proof the tool is working (Q25, Q26). Autoplay of an off-task next video is intercepted and stopped (Q24).

**5.7 Drift handling.** If the user drifts toward a clearly different task, there is **no re-prompt** — it is simply blocked, consistent with the one-immutable-task model (Q4).

**5.8 End session.** Ending the session un-hides everything, clears the allowlist, leaves tabs open, and returns a normal browser (Q40). Only then can a new task be set.

---

## 6. Functional requirements

### 6.1 Session and goal
- Single free-text task set on open (Q1); immutable for the session (Q3).
- Resume-or-new choice on relaunch (Q2).
- Live, inferred, display-only subtask line (Q5).
- Drift to a different task is blocked, not re-prompted (Q4).

### 6.2 Relevance behavior
- Bands: ≥0.55 on-task, 0.40–0.55 ambiguous, <0.40 off-task (Q7).
- Score against both the task and the live subtask; keep the higher similarity (Q10).
- Embed all text needed to judge the item, not just the title (Q9).
- **Ambiguous items are blocked/hidden while their Groq tiebreaker is pending** (Q8).
- Unscoreable (no usable text) items are left visible (Q12).
- Cold start shows items, then filters once the model is ready (Q11).

### 6.3 Surface 1 — page content
- Hide off-task sections at card/section level via per-site selectors (Q13).
- Collapse/hide with reversible one-click "show anyway" (Q14).
- Off-task **primary** content is blocked outright (Q15).

### 6.4 Surface 2 — navigation
- Allowlist auto-seeded from the Groq goal-expansion, user-editable, domain-level (Q16, Q17).
- Off-task cross-domain navigation hard-blocked; redirect to previous on-task page (Q18, Q19).
- Auth/OAuth domains and redirect chains always allowed (Q20).
- In-site drift handled by content/recommendation surfaces, not navigation blocking (Q21).

### 6.5 Surface 3 — recommendations
- Per-site adapter selectors; YouTube adapter covers watch, home, and search (Q22, Q26).
- Hide-by-default then reveal on-task; batched, debounced scoring on infinite scroll (Q23).
- Empty panel when nothing on-task qualifies (Q25).
- Autoplay intercepted; off-task next target paused/replaced (Q24).

### 6.6 Onboarding and consent
- One short first-run card: the model can be wrong, interventions are the point, and what is sent to Groq. Then "Got it" (Q37).

### 6.7 Override model
- **Content sections:** reversible one-click "show anyway" (Q14, Q38).
- **Navigation and off-task pages:** no override — hard block and redirect (Q18, Q19). This is intentional asymmetry: low-stakes content is recoverable in a click; leaving the task entirely is not offered.

### 6.8 Privacy (honest statement — approved wording)
> OnTask keeps your task on your machine and decides most things locally. To judge whether something fits your task, it sends the text it needs — your task and the titles and text of what's being checked — to Groq. It does not send your full browsing history, it does not sell your data, it shows no ads, and it collects zero telemetry.

The "page content never leaves your device" claim is **not** used (Q31).

### 6.9 Accessibility
- Keyboard navigation, visible focus, reduced-motion support, and sufficient contrast are in scope as table stakes for this audience (Q41).

---

## 7. Scope

**MVP in-scope**
- Base: Min (Electron) fork, pastel Dia-style UI.
- One immutable task per session; Groq goal expansion + tiebreaker.
- All three surfaces active.
- **YouTube across all surfaces: watch page, home feed, search results** (Q26).
- Autoplay interception (Q24).
- Resume-or-new, subtask display, first-run card.

**Out of scope (MVP)** — Q43
- Any site other than YouTube.
- Accounts, sync, cross-device.
- Cross-app / OS-level awareness.
- Search-API backfill for recommendations.
- Learning loop at scale.
- Mid-session task editing.

---

## 8. Success metrics and demo criteria

- **Internal measures (Q44):** time-in-focus per session; count of items filtered/blocked. Not necessarily surfaced in UI.
- **Demo success:** the curated-vs-raw contrast lands cleanly on stage — the recommendation panel visibly strips to on-task-only (or empty), an off-task page/navigation is blocked and bounced back, and a new tab already knows the task with no re-prompt.
- **Performance (Q45):** <150 ms added per navigation, <150 MB model RAM, no scroll jank.

---

## 9. Risks and mitigations

- **Block-while-pending false positives (from Q8).** Because ambiguous items are withheld until Groq confirms, the user can briefly lose an item they actually wanted, and slow tiebreaker calls make the UI feel laggy. This is the classic asymmetric-false-positive risk. *Mitigation:* keep the ambiguous band narrow, make the Groq tiebreaker fast and cached, and lean on the local tier for the large majority of decisions so blocking-pending is rare. Accept the tradeoff deliberately — it is the owner's chosen stance in favor of stronger retention.
- **Hard navigation blocking frustrates on false positives.** No escape hatch for navigation means a wrong block is more costly than a wrong content-hide. *Mitigation:* generous allowlist seeding, always-allow auth domains, and fast iteration on the allowlist during the session.
- **All-surfaces YouTube widens surface area.** Home and search feeds are higher-volume and differently structured than the watch page. *Mitigation:* build watch first, then home, then search, each as its own tested chunk.
- **Preload reach.** Everything assumes we can inject into YouTube. *Mitigation:* verified in Phase 0 before any feature work.
- **Selector drift.** Site updates break adapters. *Mitigation:* silent no-op fail-open, all site-specifics isolated to the adapter.

---

## 10. The 90-second demo

1. **Frame (15s):** "Feeds are engineered to hijack attention. For someone with ADHD trying to work, that's disabling. Watch."
2. **Set the task once (10s):** "Write my statement of purpose." The focus bar now shows it.
3. **The whoa (25s):** Open an on-task SOP video. Its recommendations strip to on-task-only (or go calmly empty). Open a new tab — it already knows the task, no re-prompt.
4. **The guardrail (20s):** Try to open an off-task video / navigate to an off-task site — it's blocked and bounces back to the on-task page. Autoplay of an off-task next video is stopped.
5. **Close (20s):** "One task, set once, and the whole browser stays pointed at it — pages, navigation, and recommendations. Decided mostly on your machine, and it never sells you out."

---

## 11. Judge Q&A readiness

- **How is this different from Focus AI / an extension?** It's a *browser* with one shared task context across every tab, curating three surfaces with one engine, aimed at ADHD/students — and it's decisive, not a soft blocker.
- **False positives?** For content, being wrong costs one click. For navigation and ambiguous items we deliberately block — the product bet is that decisive retention serves this user better than permissiveness. The whole system still fails open if the engine can't run.
- **Surveillance / privacy?** Most decisions are local; the model is on-device. We send the text needed to judge relevance to Groq and nothing more; no history harvesting, no ads, zero telemetry. (We don't claim "nothing leaves.")
- **Social good or productivity?** Attention-agency protection for a harmed group against manipulative design.
- **Why won't AI browsers just do this?** They may absorb it as a setting — the wedge is the humane, decisive, ADHD/student-focused design, not the mechanism.
