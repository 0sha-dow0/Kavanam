# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ontask.spec.js >> real preload filters content and blocks off-task navigation
- Location: test/e2e/ontask.spec.js:5:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  locator('#ontask-focus-task')
Expected: "Write thesis"
Received: "Write thesist"
Timeout:  10000ms

Call log:
  - Expect "toHaveText" with timeout 10000ms
  - waiting for locator('#ontask-focus-task')
    24 × locator resolved to <div id="ontask-focus-task" class="ontask-focus-goal">Write thesist</div>
       - unexpected value "Write thesist"

```

```yaml
- text: Write thesist
```

# Test source

```ts
  1  | const { test, expect } = require('@playwright/test')
  2  | const { createSiteServer } = require('./siteServer')
  3  | const { launchOnTask, waitForPage } = require('./helpers')
  4  | 
  5  | test('real preload filters content and blocks off-task navigation', async ({}, testInfo) => {
  6  |   const site = await createSiteServer()
  7  |   const app = await launchOnTask(testInfo.outputPath('user-data'), site.feedURL)
  8  |   try {
  9  |     const chrome = await waitForPage(app, page => page.url() === 'min://app/index.html')
  10 |     await expect(chrome.locator('#ontask-intake')).toBeVisible()
  11 |     await chrome.locator('#ontask-intake-input').fill('Write thesis')
  12 |     await chrome.locator('#ontask-intake-start').click()
> 13 |     await expect(chrome.locator('#ontask-focus-task')).toHaveText('Write thesis')
     |                                                        ^ Error: expect(locator).toHaveText(expected) failed
  14 | 
  15 |     const content = await waitForPage(app, page => page.url().startsWith(site.feedURL))
  16 |     await expect(content.locator('#on-card')).toBeVisible()
  17 |     await expect(content.locator('#off-card')).toBeHidden()
  18 |     await expect(content.locator('#ambiguous-card')).toBeHidden()
  19 |     await expect(content.locator('#unscoreable-card')).toBeVisible()
  20 | 
  21 |     const replacementError = await chrome.evaluate(async function () {
  22 |       try {
  23 |         await require('electron').ipcRenderer.invoke('ontask-start-session', 'Replace task')
  24 |         return null
  25 |       } catch (err) {
  26 |         return err.message
  27 |       }
  28 |     })
  29 |     expect(replacementError).toContain('already active')
  30 | 
  31 |     const offRequests = site.requestCount('/off-task/page')
  32 |     await content.locator('#blocked-nav').click({ noWaitAfter: true })
  33 |     // a block is an event, not a state: the badge flashes Blocked, then
  34 |     // reverts to the current page's real band
  35 |     await expect(chrome.locator('#ontask-status-text')).toHaveText('Blocked')
  36 |     expect(site.requestCount('/off-task/page')).toBe(offRequests)
  37 |     await expect(chrome.locator('#ontask-status-text')).toHaveText('On task', { timeout: 10000 })
  38 |   } finally {
  39 |     await app.close()
  40 |     await site.close()
  41 |   }
  42 | })
  43 | 
  44 | test('engine outage reveals content and allows navigation', async ({}, testInfo) => {
  45 |   const site = await createSiteServer()
  46 |   const app = await launchOnTask(testInfo.outputPath('outage-user-data'), site.feedURL)
  47 |   try {
  48 |     const chrome = await waitForPage(app, page => page.url() === 'min://app/index.html')
  49 |     await chrome.locator('#ontask-intake-input').fill('Write thesis')
  50 |     await chrome.locator('#ontask-intake-start').click()
  51 |     const content = await waitForPage(app, page => page.url().startsWith(site.feedURL))
  52 |     await expect(content.locator('#off-card')).toBeHidden()
  53 | 
  54 |     await app.evaluate(function () {
  55 |       global.__ontaskE2E.setEngineMode('outage')
  56 |     })
  57 |     await expect(content.locator('#off-card')).toBeVisible()
  58 |     await content.locator('#blocked-nav').click({ noWaitAfter: true })
  59 |     await expect.poll(function () {
  60 |       return app.windows().map(page => page.url())
  61 |     }).toContain(site.offTaskURL)
  62 |   } finally {
  63 |     await app.close()
  64 |     await site.close()
  65 |   }
  66 | })
  67 | 
  68 | test('resume restores the persisted focus session', async ({}, testInfo) => {
  69 |   const site = await createSiteServer()
  70 |   const userData = testInfo.outputPath('resume-user-data')
  71 |   let app = await launchOnTask(userData, site.feedURL)
  72 |   try {
  73 |     let chrome = await waitForPage(app, page => page.url() === 'min://app/index.html')
  74 |     await chrome.locator('#ontask-intake-input').fill('Resume this thesis')
  75 |     await chrome.locator('#ontask-intake-start').click()
  76 |     const original = await chrome.evaluate(function () {
  77 |       return require('electron').ipcRenderer.invoke('ontask-get-session')
  78 |     })
  79 |     await app.close()
  80 | 
  81 |     app = await launchOnTask(userData, site.feedURL)
  82 |     chrome = await waitForPage(app, page => page.url() === 'min://app/index.html')
  83 |     await expect(chrome.locator('#ontask-intake-resume')).toBeVisible()
  84 |     await expect(chrome.locator('#ontask-resume-task')).toHaveText('Resume this thesis')
  85 |     await chrome.locator('#ontask-intake-resume').click()
  86 |     await expect(chrome.locator('#ontask-focus-task')).toHaveText('Resume this thesis')
  87 |     const resumed = await chrome.evaluate(function () {
  88 |       return require('electron').ipcRenderer.invoke('ontask-get-session')
  89 |     })
  90 |     expect(resumed.startedAt).toBe(original.startedAt)
  91 |   } finally {
  92 |     await app.close()
  93 |     await site.close()
  94 |   }
  95 | })
  96 | 
```