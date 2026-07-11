# OnTask (Min fork)

Focus browser: one task per session, relevance engine scores content on three surfaces (page content, navigation, recommendation panels). Generic-first feed detection works on any site; YouTube is a demo adapter.

## Build & run

- `npm run start` — build + watch + Electron dev mode
- `npm run startElectron` — launch after build
- `npm test` — runs `test/ontask/*.test.js` (node --test). No separate lint.
- Chrome reload: **Cmd+R doesn't work**; use `alt+ctrl+r` or restart Electron.
- **No semicolons, 2-space indent** throughout.

## Build system (concatenation, not bundler)

- `scripts/buildMain.js` — file list → `main.build.js`. New main modules (e.g. `main/foo.js`) must be added here, ordered after deps.
- `scripts/buildPreload.js` — file list → `dist/preload.js`. New preload modules must be added here.
- `scripts/buildBrowser.js` — browserifies `js/default.js` → `dist/bundle.js`. Chrome modules use `require()`.
- `scripts/buildBrowserStyles.js` — bundles `css/*.css`.

## Key files

| Area | File | Purpose |
|---|---|---|
| Focus session | `main/focusSession.js` | Session lifecycle, pause/edit/leave, IPC handlers |
| Relevance | `main/relevanceEngine.js` | Scoring, curation tracking (`ontaskCurationRequests`), IPC pipeline |
| Groq | `main/groqClient.js` | LLM tiebreak for ambiguous items |
| Navigation guard | `main/navigationGuard.js` | URL scoring, redirect-gate pass, host verification |
| Persistence | `main/persistence.js` | Session save/restore, completed analytics |
| IPC validation | `main/ontaskIPC.js` | `cleanItems`, `requireContent`, `cleanDomain`, rate limiting |
| Preload bridge | `js/preload/bridge.js` | `sendCards` — chunks items (50/batch), sends `ontask-cards-collected` |
| DOM reader | `js/preload/domReader.js` | Extracts cards/links from page |
| Sidebar | `js/ontask/sidebar.js` | Collapsible rail, blocked overlay, session menu, curation popup, timer, idle |
| Intake | `js/ontask/intake.js` | Landing page: resume list, completed archive, stats |
| Nav bar | `js/navbar/navigationButtons.js` | Back/forward/reload buttons |
| Nav bar | `js/navbar/tabEditor.js` | Address bar: search, voice, image buttons |
| Chrome shell | `index.html` | All chrome DOM elements |
| OnTask CSS | `css/ontask.css` | Full pastel theme, sidebar, blocked overlay, curation popup, etc. |
| Base CSS | `css/tabBar.css` | Navbar buttons, tab bar, navigation button widths |

## Key IPC channels

| Channel | Direction | Purpose |
|---|---|---|
| `ontask-cards-collected` | preload→main | Card batches for scoring (max 50/batch) |
| `ontask-verdicts` | main→preload | Show/hide verdicts per card |
| `ontask-curation-progress` | main→chrome | Curation popup updates: `{id, url, total, completed, phase}` (start/progress/complete) |
| `ontask-set-paused` | both | Pause/resume session |
| `ontask-edit-session` | chrome→main | Edit task prompt |
| `ontask-end-session`, `ontask-leave-session` | chrome→main | Complete/unfinished session |
| `ontask-get-sessions`, `ontask-get-completed-sessions` | chrome→main | Session list |
| `ontask-user-activity` | preload→main | Idle detection heartbeat |

## Curation popup lifecycle

1. `bridge.sendCards()` sends all items in batches of 50, each with `curationId` (same across batches) and `total` (full item count).
2. `relevanceEngine.js` handler creates a curation record via `startCuration()` — accumulates `total` across all batches.
3. `scoreItems()` scores locally, calls `push()` per chunk. Non-pending verdicts are counted in `record.completed`.
4. `push()` calls `notifyCuration(record, phase)` — sends `ontask-curation-progress` to chrome.
5. `sidebar.showCuration()` shows popup, updates progress bar and count text.
6. When `completed >= record.total`: `push` sets 5s expiry timer; notifies 'complete'; chrome hides popup after 350-900ms.
7. Record auto-deleted after 30s (or 5s post-complete). Switching tabs hides popup via `tasks.on('tab-selected')`.

**Curation tracking vulnerability (fixed):** `cleanItems` dedup removes duplicate items. Previously `payload.total` (raw count) was used as `record.total`, causing the popup to never complete when dedup occurred. Fix: use `items.length` (deduplicated) per batch and **accumulate** across batches in `startCuration()`.

## CSS variables (pastel palette)

`--ot-page: #dfe7e4` · `--ot-canvas: #e6ece8` · `--ot-sidebar-bg: #d5e0dc` · `--ot-ink: #2d3d3e` · `--ot-ink-soft: #627475` · `--ot-ink-faint: #8b9b9a` · `--ot-accent: #789da0` · `--ot-accent-strong: #4c7479` · `--ot-line: #cddad6` · `--ot-line-soft: #d9e3df`

## Key DOM element IDs

- `#toolbar-navigation-buttons` — back/reload/forward container (width: 4rem, hover .can-go-forward: 6rem)
- `#back-button`, `#reload-button`, `#forward-button` — nav buttons (.navbar-action-button .i carbon:*)
- `#ontask-curation` — curation progress popup with `.ontask-curation-card`, `.ontask-curation-mark`, `.ontask-curation-track`, `#ontask-curation-progress`
- `#ontask-search-submit`, `#ontask-search-voice`, `#ontask-search-image` — address bar actions
- `#ontask-status-badge` — "On task" indicator in navbar
- `#ontask-manual-pause` — pause overlay
- `#ontask-edit-dialog`, `#ontask-end-confirm` — session dialogs
