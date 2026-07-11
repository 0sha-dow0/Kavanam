# OnTask — Architecture PRD

*Focus browser built on Min (Electron). One task per session; one relevance engine; three enforcement surfaces. Local-first compute with a Groq assist.*

Status: draft for build. Companion docs: `OnTask_Product_PRD.md` (what/why), `OnTask_Build_Plan.md` (step-by-step chunked build for Claude Code).

---

## 1. Purpose and scope

OnTask is a standalone desktop browser that holds the user to a single task they set at the start of a session. It reads page content locally, scores it for relevance to the task, and applies that score to three surfaces: page content, navigation, and recommendation panels. The MVP target site is YouTube across all of its surfaces (watch page, home feed, search results).

This document defines the system's components, data model, data flows, and boundaries. It does not restate product rationale (see the Product PRD).

---

## 2. Guiding principles

1. **One engine, three surfaces.** A single relevance score is computed once per item and reused for content-hiding, navigation-blocking, and recommendation-curation. No surface has its own scoring logic.
2. **Least-invasive signal that works.** Read structured DOM text on-device. No screenshots, no per-page vision calls.
3. **Local-first compute.** Relevance is decided locally by a bundled sentence-embedding model for the large majority of items. Groq is used only twice: once to expand the goal at session start, and as a tiebreaker for genuinely ambiguous items.
4. **Fail open on *outage*, fail closed on *ambiguity*.** These are different failure classes and resolve differently (see §9). If the engine cannot run at all (model won't load, Groq unreachable at a level that blocks startup), the browser degrades to a normal browser — it must never brick the web. But while the engine *is* running, an item that is pending an ambiguity decision is **blocked until resolved** (product decision, Q8).
5. **The task is immutable for the session.** Once set, the task cannot be edited mid-session. Ending the session is the only way to change it (Q3).

---

## 3. High-level architecture

OnTask forks Min. Min is Electron: a Node main process, a renderer for the browser chrome (HTML/CSS/JS), and web content hosted in per-tab views with an injected preload script.

```
┌────────────────────────────────────────────────────────────────┐
│ MAIN PROCESS (Node)                                             │
│                                                                │
│  FocusSessionStore ──── single source of truth                 │
│    { task, taskEmbedding, expandedIntent, keywords,            │
│      subtask, allowlist, overrides, startedAt }                │
│                                                                │
│  RelevanceEngine                                               │
│    local tier: MiniLM embeddings + cosine  (bundled, offline)  │
│    groq tier:  goal expansion (once) + ambiguity tiebreaker    │
│                                                                │
│  GroqClient · NavigationGuard · PersistenceStore               │
└───────────────▲───────────────────────────────┬───────────────┘
                │ IPC (scored results, session)  │ IPC (DOM text, nav events)
                │                                 ▼
┌───────────────┴────────────────────────────────────────────────┐
│ PER-TAB PRELOAD (runs inside every page, incl. YouTube)        │
│   DomReader → sends element text to main for scoring           │
│   SurfaceApplier ← receives verdicts, hides/blocks/curates     │
│   Per-site adapter selects which nodes are content / recs      │
└────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────┐
│ RENDERER CHROME (browser UI — pastel Dia-style)                │
│   Task-intake screen · persistent focus bar · vertical tabs    │
│   subtask line · end-session control                           │
└────────────────────────────────────────────────────────────────┘
```

The **FocusSessionStore lives in the main process** so every tab shares one task context. New tabs inherit it silently — there is no per-tab prompt.

---

## 4. What we inherit from Min vs. what we add

| Concern | Min gives us | We add / change |
|---|---|---|
| Tabs, navigation, window chrome | Yes | Restyle to pastel; convert tab strip to a vertical rail |
| Preload injection into every page | Yes (verify in Phase 0) | Our `DomReader` + `SurfaceApplier` bridge |
| Content blocker | Yes (ad/tracker) | Extend for the navigation allowlist guard |
| Tab-group "Tasks" feature | Yes | **Not used as Spaces.** OnTask has one task per session, not user-managed groups |
| Reader mode (DOM stripping) | Yes | Reference for content-hiding patterns |
| Main-process state | Yes | `FocusSessionStore` + `RelevanceEngine` + `GroqClient` |

Phase 0 of the build plan verifies the one load-bearing assumption: that we can land code inside a third-party page (YouTube) via Min's preload. Everything else depends on it.

---

## 5. Core components

### 5.1 FocusSessionStore (main process)
Single authoritative object for the session. Created at task intake, destroyed on session end.

- Holds: `task` (raw string), `taskEmbedding`, `expandedIntent` (Groq output), `keywords`, `subtask` (live, inferred), `allowlist`, `overrides`, `startedAt`.
- Exposes read to all tabs via IPC; only the engine and intake flow write to it.
- **Immutable task:** no API to change `task` mid-session. `subtask` updates freely.
- Persisted on end (see §8) so relaunch can offer *resume vs. new* (Q2).

### 5.2 Goal intake + Groq expansion
On browser open, the intake screen collects one free-text task (Q1). On submit:
1. Compute `taskEmbedding` locally.
2. Call Groq once to expand the task into structured intent + keyword set + an initial domain allowlist (Q16). Cache for the session.
3. If Groq is unreachable, start in **local-only degraded mode** using the raw task text for embeddings and an empty/seed allowlist (Q28). Session still starts.

### 5.3 RelevanceEngine
Two tiers, one output (`ScoredItem`).

- **Local tier (default path):** bundled `all-MiniLM-L6-v2` via transformers.js/ONNX, running in the main process (or a worker). Cosine similarity between the item embedding and **both** `taskEmbedding` and `subtaskEmbedding`; the item keeps the higher of the two (Q10).
- **Bands (Q7):** `≥0.55` on-task, `0.40–0.55` ambiguous, `<0.40` off-task. Tunable via a hidden dev setting.
- **Groq tiebreaker:** ambiguous-band items only. Cached by URL/id. **While the tiebreaker is pending, the item is treated as blocked/hidden (fail closed) — Q8.**
- **Embedding input (Q9):** all text needed to judge the item — title, channel/author, and any available description/snippet text the adapter can cheaply extract. Maximal-context, not title-only.
- **Cold start (Q11):** before the model is warm, render items normally, then apply verdicts once ready. (This is the one fail-open moment during startup, distinct from the running-state fail-closed behavior.)
- **Unscoreable items (Q12):** items with no usable text (non-English with no signal, thumbnail-only) are left visible.

### 5.4 Preload bridge (per page)
Runs inside every page.
- `DomReader`: using the active per-site adapter, collects candidate nodes (content sections, recommendation cards) and their text; sends to main for scoring. Uses a `MutationObserver` for infinite/related feeds, batched and debounced (Q23).
- `SurfaceApplier`: receives verdicts and applies them. Injects **hide-by-default CSS first** so nothing flashes before it's judged, then reveals on-task items (Q23).

### 5.5 Surface modules
One score, three appliers:

- **Surface 1 — page content (Q13–Q15):** off-task *sections within* an on-task page are collapsed/hidden with a reversible "show anyway" affordance (Q14). But if the *primary content itself* is off-task (user opens an off-task video/page directly), it is **blocked**, not curated around (Q15).
- **Surface 2 — navigation (Q16–Q21):** a main-process `NavigationGuard` intercepts top-level navigations. Off-task, cross-domain navigations are **hard-blocked and redirected back to the previous on-task page** (Q18, Q19) — no session-override escape hatch. Auth/OAuth domains and their redirect chains are always allowed (Q20). In-site drift within an allowed domain is handled by the content/recommendation surfaces, not by navigation blocking (Q21).
- **Surface 3 — recommendations (Q22–Q26):** per-site adapter identifies recommendation cards; off-task cards are hidden; **if none qualify, the panel is left empty** (Q25). **Autoplay is intercepted** — if the next target is off-task, it is paused/replaced (Q24). Applies across **all** MVP YouTube surfaces: watch-page related, home feed, and search results (Q26).

### 5.6 Per-site adapters
A small module per supported site (Q22). MVP ships one YouTube adapter covering three surfaces. Each adapter declares: recommendation-card selectors, content-section selectors, main-content selector, autoplay hook, and text-extraction rules. Adapters are the only site-specific code; the engine and surfaces are generic. Broken selectors degrade to a silent no-op + dev log (Q29).

---

## 6. Data model

```ts
FocusSession {
  task: string                 // immutable for the session
  taskEmbedding: Float32Array
  expandedIntent: string       // Groq output
  keywords: string[]
  subtask: string              // live, inferred, display-only
  subtaskEmbedding: Float32Array
  allowlist: string[]          // domains; seeded by Groq, user-editable
  overrides: OverrideRecord[]  // session-scoped
  startedAt: number
}

ScoredItem {
  id: string                   // url or DOM-stable key
  text: string                 // extracted text used for embedding
  score: number                // max(sim(task), sim(subtask))
  band: 'on' | 'ambiguous' | 'off'
  verdict: 'show' | 'hide' | 'block' | 'pending'
  source: 'local' | 'groq'
}

SiteAdapter {
  match: RegExp
  surfaces: { watch?, home?, search? }
  recommendationSelectors: string[]
  contentSectionSelectors: string[]
  mainContentSelector: string
  autoplayHook?: () => Target
  extractText: (node) => string
}
```

Persisted subset (§8): `task`, `startedAt`, `allowlist`, `overrides`, and a short task history for resume.

---

## 7. Key data flows

**Session start**
`intake screen → task string → local embed → Groq expand (intent + keywords + allowlist) → FocusSessionStore populated → chrome shows focus bar → first tab inherits session`

**Page load / scroll (any tab)**
`preload DomReader (via adapter) collects nodes → hide-by-default CSS applied → text batched to main → RelevanceEngine scores (local; ambiguous→Groq) → verdicts returned → SurfaceApplier reveals on-task / hides off / keeps ambiguous blocked until resolved`

**Navigation attempt**
`NavigationGuard intercepts → auth domain? allow → same allowed domain? allow → cross-domain + on-task (allowlist/score)? allow → else block + redirect to previous on-task page`

**Autoplay**
`adapter autoplay hook fires → score next target → off-task? pause/replace with on-task item or empty`

---

## 8. Privacy and data boundaries

This reflects the product owner's answers (Q30–Q34), which are deliberately **not** a strict "nothing leaves the device" stance.

- **Local:** the embedding model and all embedding computation run on-device. The model is **bundled** with the app, not fetched at runtime (Q33) — offline-capable.
- **Sent to Groq:** the task string at session start, and the text needed to judge relevance for ambiguous items (titles and available snippet/description text of the specific items being scored). The system sends **what is required to keep the user on task** (Q30) — this is broader than title-only. It does **not** stream full page bodies wholesale or send browsing history logs.
- **Not claimed:** the "page content never leaves your device" line is **rejected** (Q31). Do not use it in-product or in the pitch. Use the accurate statement in the Product PRD instead.
- **Persisted to disk:** task history (for resume), allowlist, and overrides — whatever is needed for the user to stay on task across sessions (Q32). Stored in plain local app storage; no secrets are stored, so no encryption in MVP.
- **Telemetry:** none (Q34). No analytics or usage tracking.

The honest one-liner (see Product PRD for full text): OnTask sends the text it needs to judge relevance to Groq; it never sells data, serves ads, or tracks you.

---

## 9. Failure and fallback behavior

| Failure | Class | Behavior |
|---|---|---|
| Model won't load / inference throws | Outage | **Fail open** — normal browsing, no enforcement (Q27) |
| Groq unreachable at session start | Outage | Start in **local-only degraded mode**; raw-text embeddings, no goal expansion (Q28) |
| Groq tiebreaker pending on an ambiguous item | Ambiguity | **Fail closed** — item blocked/hidden until the verdict returns (Q8) |
| Site selectors break after a site update | Outage | **Silent no-op** on that surface + dev log; no user-facing error (Q29) |
| Cold start (model warming) | Startup | Show items, then apply verdicts once ready (Q11) |

The distinction is deliberate: a total inability to enforce must never trap the user (fail open), but a *known-ambiguous* item during normal operation is withheld pending resolution (fail closed), per the owner's aggressive-retention preference.

---

## 10. Tech stack and dependencies

- **Base:** Min browser (Electron, Node, HTML/CSS/JS chrome).
- **Embeddings:** `all-MiniLM-L6-v2` via transformers.js / ONNX Runtime, bundled.
- **LLM assist:** Groq API (goal expansion + ambiguity tiebreaker).
- **UI:** existing Min chrome, restyled (pastel Dia-style); Plus Jakarta Sans; prototype in `ontask-pastel.html` is the styling reference.
- **Per-site adapters:** plain JS modules.

---

## 11. Module / directory layout (proposed)

```
ontask/                      (Min fork)
  main/
    focusSession.js          FocusSessionStore
    relevanceEngine.js       local + groq tiers, bands
    groqClient.js            expansion + tiebreaker
    navigationGuard.js       Surface 2
    persistence.js           resume, allowlist, overrides
  preload/
    domReader.js             collect + observe
    surfaceApplier.js        hide/block/curate + hide-by-default CSS
    bridge.js                IPC wiring
  adapters/
    youtube.js               watch / home / search
  chrome/                    (Min renderer UI, restyled)
    intake/                  task-set screen
    focusBar/                persistent bar + subtask + end session
    tabs/                    vertical rail
  models/
    minilm/                  bundled ONNX weights
```

---

## 12. Performance budget (Q45)

- < 150 ms added latency per top-level navigation.
- < 150 MB RAM for the embedding model.
- No visible jank while scrolling infinite feeds (batched, debounced scoring; hide-by-default CSS).

---

## 13. Open technical risks

- **Preload reach on YouTube** — the whole design assumes we can inject and mutate inside YouTube via Min's preload. Verified first in Phase 0.
- **Block-while-pending latency (Q8)** — because ambiguous items are hidden until Groq responds, tiebreaker latency directly affects perceived UX. Keep the ambiguous band narrow and the Groq call fast; cache aggressively by id.
- **All-surfaces YouTube (Q26)** — home and search have different DOM shapes and heavier card volume than the watch page; each needs its own selectors and scroll handling in the adapter.
- **Autoplay interception (Q24)** — YouTube autoplay is timing-sensitive; interception must fire before navigation commits.
- **Selector drift** — adapters are inherently brittle to site updates; mitigated by silent-no-op fail-open and isolating all site-specifics to the adapter.
