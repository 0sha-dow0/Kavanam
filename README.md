<h1 align="center">◎ OnTask</h1>

<p align="center"><b>A focus browser that holds you to one task.</b><br/>
Set a single task when you open the browser — OnTask keeps every page, search, and recommendation feed pointed at it.</p>

---

Feeds are engineered to pull attention away. For students and people with ADHD, a single off-task recommendation can cost an hour. Domain blockers are too blunt — YouTube is both a research library and a distraction machine. OnTask is different: it understands **what you're working on** and applies that one judgment everywhere the web tries to redirect you.

## What it does

- **One task, set once.** You type your task when the browser opens ("Write my statement of purpose"). It's pinned for the whole session and can't be edited — ending the session is the only way out. Every new tab already knows it.
- **One engine, three surfaces.** A single relevance judgment is applied to page content, navigation, and recommendation feeds:
  - **Feeds & recommendations** — off-task cards are hidden on *any* site (a generic extractor detects feed structures with no per-site code; an optional YouTube adapter adds precision). If nothing qualifies, the panel is left calmly empty — that's the tool working.
  - **Navigation** — off-task cross-domain jumps and off-task searches are blocked. Navigational searches ("google", "youtube") and sign-in flows always pass.
  - **Pages** — opening a clearly off-task page bounces you back to where you were working. Off-task autoplay is stopped.
- **Local-first intelligence.** A bundled MiniLM embedding model (offline, ~23 MB) makes most decisions on your machine. Groq is consulted exactly twice: once to expand your task into intent + keywords + trusted domains, and as a tiebreaker for genuinely ambiguous items — judged *in the context of the page you're on*, so valid search results don't get mass-hidden.
- **Reversible, humane overrides.** Every hidden item gets its own one-click "show anyway" that persists for the session. One mistake never reveals the whole feed.
- **Never bricks the web.** Engine outage → normal browser. Unscoreable content → left visible. Lost verdicts → revealed by a watchdog. Fail open on outage, fail closed on ambiguity.
- **No telemetry, no ads, no history harvesting.** See [`PRIVACY.md`](PRIVACY.md).

## How it works

```
┌─ MAIN PROCESS ────────────────────────────────────────────────┐
│  FocusSessionStore   one immutable task, shared by every tab  │
│  RelevanceEngine     MiniLM embeddings + bands + Groq assist  │
│  NavigationGuard     blocks off-task navigation & searches    │
└──────────────▲──────────────────────────────┬────────────────┘
               │ card text, page text          │ verdicts
┌──────────────┴──────────────────────────────▼────────────────┐
│  PER-PAGE PRELOAD    generic extractor (any site) + optional  │
│                      site adapters · hide/reveal/override     │
└───────────────────────────────────────────────────────────────┘
```

Product decisions, architecture, and the full build plan live in [`docs/OnTask_Product_PRD.md`](docs/OnTask_Product_PRD.md), [`docs/OnTask_Architecture.md`](docs/OnTask_Architecture.md), and [`docs/OnTask_Build_Plan.md`](docs/OnTask_Build_Plan.md).

## Quick start

Use Node 24, then:

```bash
npm ci          # install the locked dependency tree
npm run start   # launch OnTask in development mode
```

Optional: connect Groq assist by setting `GROQ_API_KEY` in the environment before launch. Without it, OnTask runs in local-only degraded mode (still functional, decisively strict on ambiguity).

After changing browser-chrome code, reload with `alt+ctrl+r` (`opt+cmd+r` on Mac).

## Testing

```bash
npm test           # unit tests (IPC trust boundary, guard, session, reader)
npm run test:e2e   # deterministic Electron end-to-end tests (Playwright)
npm run verify     # everything above + build + dependency audit
```

## Packaging

```bash
npm run buildMacArm && npm run buildMacIntel
npm run buildWindows
npm run buildDebian && npm run buildRedhat
```

Local macOS artifacts are ad-hoc signed; public releases require Apple Developer ID signing/notarization and Windows Authenticode credentials.

## Privacy

Most decisions run locally. When Groq assist is configured, OnTask sends your task and the text needed to judge ambiguous items — nothing else. It does not send a browsing-history log, sell data, show ads, or collect telemetry. Full statement: [`PRIVACY.md`](PRIVACY.md).

---

## Credits & attribution

OnTask is built on **[Min](https://github.com/minbrowser/min)**, the fast, minimal, privacy-protecting browser by [@PalmerAL](https://github.com/PalmerAL) and the Min contributors, licensed under the **Apache License 2.0**. Min's original license is retained in [`LICENSE.txt`](LICENSE.txt), and the complete upstream history is preserved in this repository.

Modifications in OnTask relative to Min include: the focus-session model and task-intake UI, the relevance engine (bundled MiniLM + Groq assist), the generic feed extractor and site-adapter layer, the navigation guard, the sidebar chrome, removal of Min's telemetry/crash reporting, and an added test suite. Min's tab engine, content blocker, reader view, searchbar, password manager integration, and the rest of its foundation are Min's work — thank you to everyone who built it. 💛

The remainder of this README is Min's original README, preserved for attribution.

---

# Min

Min is a fast, minimal browser that protects your privacy. It includes an interface designed to minimize distractions, and features such as:

- Full-text search for visited pages
- Ad and tracker blocking
- Automatic reader view
- Tasks (tab groups)
- Bookmark tagging
- Password manager integration
- Dark theme

Download Min from the [releases page](https://github.com/minbrowser/min/releases), or learn more on the [website](https://minbrowser.org/).

[![Downloads][DownloadsBadge]][DownloadsUrl]
[![Discord][DiscordBadge]][DiscordUrl]

Min is made possible by these sponsors:

| [<img src="https://avatars.githubusercontent.com/u/6592155?v=4" width="40">](https://github.com/blackgwe) | [<img src="https://avatars.githubusercontent.com/u/49724477?v=4" width="40">](https://github.com/rafel-ioli) |[<img src="https://avatars.githubusercontent.com/u/237596?v=4" width="40">](https://github.com/idoru) |     |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |--------------------------------------------------------------------------------------------------------------- | --- |
| [@blackgwe](https://github.com/blackgwe)                                                                            | [@rafel-ioli](https://github.com/rafel-ioli)                                                                        |[@idoru](https://github.com/idoru)                                                                        ||

[Become a sponsor](https://github.com/sponsors/PalmerAL)

## Screenshots

<img alt="The search bar, showing information from DuckDuckGo" src="http://minbrowser.org/tour/img/searchbar_duckduckgo_answers.png" width="650"/>

<img alt="The Tasks Overlay" src="http://minbrowser.org/tour/img/tasks.png" width="650"/>

<img alt="Reader View" src="https://user-images.githubusercontent.com/10314059/53312382-67ca7d80-387a-11e9-9ccc-88ac592c9b1c.png" width="650"/>

## Installing

You can find prebuilt binaries for Min [here](https://github.com/minbrowser/min/releases). Alternatively, skip to the section below for instructions on how to build Min directly from source.

### Installation on Linux

- To install the .deb file, use `sudo dpkg -i /path/to/download`
- To install the RPM build, use `sudo rpm -i /path/to/download --ignoreos`
- On Arch Linux install from [AUR](https://aur.archlinux.org/packages/min-browser-bin).
- On Raspberry Pi, you can install Min from [Pi-Apps](https://github.com/Botspot/pi-apps).

## Getting Started

* The [wiki](https://github.com/minbrowser/min/wiki) provides an overview of the the features available in Min, a list of available keyboard shortcuts, and answers to some [frequently asked questions](https://github.com/minbrowser/min/wiki/FAQ).
* Min supports installing userscripts to extend its functionality. See the [userscript documentation](https://github.com/minbrowser/min/wiki/userscripts) for instructions on writing userscripts, as well as a collection of scripts written by the community.
* If you have questions about using Min, need help getting started with development, or want to talk about what we're working on, join our [Discord server](https://discord.gg/bRpqjJ4).

## Developing

If you want to develop Min:

- Install [Node](https://nodejs.org).
- Run `npm install` to install dependencies.
- Start Min in development mode by running `npm run start`.
- After you make changes, press `alt+ctrl+r` (or `opt+cmd+r` on Mac) to reload the browser UI.

### Building binaries

In order to build Min from source, follow the installation instructions above, then use one of the following commands to create binaries:

- `npm run buildWindows`
- `npm run buildMacIntel`
- `npm run buildMacArm`
- `npm run buildDebian`
- `npm run buildRaspi` (for 32-bit Raspberry Pi)
- `npm run buildLinuxArm64` (for 64-bit Raspberry Pi or other ARM Linux)
- `npm run buildRedhat`

Depending on the platform you are building for, you may need to install additional dependencies:

- If you are building a macOS package, you'll need to install Xcode and the associated command-line tools. You may also need to set your default SDK to macOS 11.0 or higher, which you can do by running `export SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX11.1.sdk`. The exact command will depend on where Xcode is installed and which SDK version you're using.
- To build on Windows, you'll need to install Visual Studio. Once it's installed, you may also need to run `npm config set msvs_version 2019` (or the appropriate version).

## Contributing to Min

Thanks for taking the time to contribute to Min!

- Start by following the development instructions listed above.
- The wiki has an [overview of Min's architecture](https://github.com/minbrowser/min/wiki/Architecture).
- Min uses the [Standard](https://github.com/feross/standard) code style; [most editors](https://standardjs.com/#are-there-text-editor-plugins) have plugins available to auto-format your code.
- If you see something that's missing, or run into any problems, please open an issue!

### Contributing Translations

#### Adding a new language

- Find the language code that goes with your language from [this list](https://source.chromium.org/chromium/chromium/src/+/main:ui/base/l10n/l10n_util.cc;l=68-259) (line 68 - 259).
- In the `localization/languages` directory, create a new file, and name it "[your language code].json".
- Open your new file, and copy the contents of the <a href="https://github.com/minbrowser/min/blob/master/localization/languages/en-US.json">localization/languages/en-US.json</a> file into your new file.
- Change the "identifier" field in the new file to the language code from step 1.
- Inside the file, replace each English string in the right-hand column with the equivalent translation.
- (Optional) See your translations live by following the [development instructions](#installing) above. Min will display in the same language as your operating system, so make sure your computer is set to the same language that you're translating.
- That's it! Make a pull request with your changes.

#### Updating an existing language

- Find the language file for your language in the `localization/languages` directory.
- Look through the file for any items that have a value of "null", or that have a comment saying "missing translation".
- For each of these items, look for the item with the same name in the `en-US.json` file.
- Translate the value from the English file, replace "null" with your translation, and remove the "missing translation" comment.
- Make a pull request with the updated file.

[DiscordBadge]: https://img.shields.io/discord/764269005195968512.svg?label=Discord&logo=discord&logoColor=white
[DiscordUrl]: https://discord.gg/bRpqjJ4
[DownloadsBadge]: https://img.shields.io/github/downloads/minbrowser/min/total.svg
[DownloadsUrl]: https://github.com/minbrowser/min/releases
