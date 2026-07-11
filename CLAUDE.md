# CLAUDE.md — OnTask (Min fork)

OnTask is a focus browser built as a fork of Min (Electron). The user sets **one task per session**; a relevance engine scores content against it and enforces it on three surfaces: page content, navigation, and recommendation panels. MVP target site: YouTube (watch, home, search).

## Authoritative docs (read these before making decisions)

- `docs/OnTask_Product_PRD.md` — what/why, all product decisions (Q-numbers). **When in doubt, this doc wins.**
- `docs/OnTask_Architecture.md` — components, data model, data flows, failure behavior.
- `docs/OnTask_Build_Plan.md` — the chunked task list (T<phase>.<n>). **Work ONE task at a time, in order.** Complete → test → commit with the task ID (e.g. `T3.2: local cosine scoring`) → continue automatically. HARD STOP only on: unfixable test failure, plan-vs-codebase conflict, or destructive steps.

## Non-negotiable product rules

- The task is **immutable** for the session — no edit path mid-session.
- **Fail open on outage** (engine broken → normal browser), **fail closed on ambiguity** (pending Groq tiebreaker → item stays hidden).
- Bands: score ≥0.55 on-task · 0.40–0.55 ambiguous · <0.40 off-task. Score against both task and subtask, keep the higher.
- Never claim "page content never leaves your device" — use the approved privacy wording in the Product PRD §6.8.
- Auth/OAuth domains are always allowed by the navigation guard.
- All site-specific code lives in adapters; broken selectors = silent no-op + dev log.

## Running and building

- `npm run start` — builds everything then runs watch + Electron dev mode concurrently. This is the live-dev loop; the watcher rebuilds on file changes.
- `npm run startElectron` — just launch Electron (needs a prior build).
- `npm test` — `standard` lint over `js/**/*.js main/*.js` (Min uses standard style: no semicolons, 2-space indent).
- Reload the browser chrome after changes: **Cmd+R doesn't reload chrome**; use alt+ctrl+r (Min dev reload) or restart Electron. The watcher rebuilds bundles but Electron restart/reload is needed to pick them up.

## Min's build system — CRITICAL, non-obvious

Min does **not** auto-discover source files. Bundles are built by concatenating explicit file lists in `scripts/`:

- `scripts/buildMain.js` — module list concatenated into `main.build.js` (the Electron main entry). **Any new main-process file (focusSession.js, relevanceEngine.js, groqClient.js, navigationGuard.js, …) must be added to this list**, ordered after its dependencies.
- `scripts/buildPreload.js` — module list concatenated into `dist/preload.js` (injected into every page). **New preload modules (domReader.js, surfaceApplier.js, bridge.js) must be added here.**
- `scripts/buildBrowser.js` — browserifies `js/default.js` (browser chrome UI) into `dist/bundle.js`. Chrome modules are `require`d from `js/default.js`-reachable code, with `paths: [rootDir, jsDir]`.
- `scripts/buildBrowserStyles.js` — bundles `css/*.css`. New chrome CSS files must be registered where the existing ones are.

Because files are concatenated (main + preload), they share one scope — no `require` between concatenated modules in the same bundle; they see each other's top-level names. Match the existing style of neighboring files.

## Where things live (Min)

- `main/` — Electron main process (`main.js`, `viewManager.js` owns per-tab WebContentsViews, `filtering.js` is the request-level content blocker — extend for the navigation guard).
- `js/preload/` — per-page preload modules (`default.js` sets up IPC helpers; `textExtractor.js` is a reference for reading page text).
- `js/` — browser chrome renderer (tabs, navbar, searchbar). `index.html` is the chrome shell.
- `css/` — chrome styles.
- `js/util/settings/` — settings shared across processes.

## OnTask module layout (added as the plan progresses)

Per Architecture §11: main-process OnTask code in `main/` (focusSession.js, relevanceEngine.js, groqClient.js, navigationGuard.js, persistence.js), preload bridge in `js/preload/` (domReader.js, surfaceApplier.js, bridge.js), site adapters in `js/preload/adapters/` (youtube.js), chrome UI in `js/` + `css/` following Min's existing patterns, bundled model in `models/minilm/`.

## Conventions for this fork

- Branch: `ontask`. One commit per completed task, message starts with the task ID.
- Keep changes minimal and reversible; touch only files the current task lists.
- Prefix OnTask logs with `ONTASK` so they're easy to grep in devtools/terminal.
- Groq API key comes from env/config — never hardcode or commit it.
- Performance budget: <150 ms added per navigation, <150 MB model RAM, no scroll jank (batch + debounce DOM scoring).

## Known gaps

- `ontask-pastel.html` (the styling source of truth for the pastel Dia-style chrome) was **not provided** with the docs. When a task needs it (T1.2+), ask the user for the file; if unavailable, design to the written description: pastel palette, Plus Jakarta Sans, intake screen, `.focus` card, vertical tab rail.
