# OnTask

OnTask is a desktop focus browser built on Electron and the open-source Min
browser. A user sets one immutable task for a focus session, and OnTask keeps
pages, navigation, and recommendation feeds aligned with that task.

The default extractor works across websites. Optional site adapters improve
precision for complex surfaces such as YouTube.

## How It Works

- A bundled MiniLM model scores content locally.
- Groq optionally expands the task and resolves genuinely ambiguous items.
- Off-task feed items are hidden with item-scoped overrides.
- Off-task cross-domain navigation and primary pages are blocked.
- Engine outages fail open so the browser never traps the user.
- OnTask collects no telemetry.

See `docs/OnTask_Product_PRD.md`, `docs/OnTask_Architecture.md`, and
`docs/OnTask_Build_Plan.md` for detailed product and architecture decisions.

## Development

Use Node 24 and install the locked dependency tree:

```bash
npm ci
```

Start the development build:

```bash
npm run start
```

Run the complete release verification suite:

```bash
npm run verify
```

This runs unit tests, builds all generated bundles, launches deterministic
Electron end-to-end tests, and checks production dependencies for high or
critical advisories.

## Packaging

```bash
npm run buildMacArm
npm run buildMacIntel
npm run buildWindows
npm run buildDebian
npm run buildRedhat
```

Local macOS artifacts are ad-hoc signed. Public releases still require Apple
Developer ID signing/notarization and Windows Authenticode credentials.

## Privacy

Read `PRIVACY.md`. Most decisions run locally. When Groq assist is configured,
OnTask sends the task and text needed to judge ambiguous items. It does not
send a browsing-history log or collect telemetry.

## Attribution

OnTask is derived from Min, licensed under Apache-2.0. Min's original license
and attribution are retained in `LICENSE.txt` and the source history.
