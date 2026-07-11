# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ontask.spec.js >> engine outage reveals content and allows navigation
- Location: test/e2e/ontask.spec.js:44:1

# Error details

```
TimeoutError: electronApplication.waitForEvent: Timeout 30000ms exceeded while waiting for event "window"
```

# Test source

```ts
  1  | const path = require('node:path')
  2  | const { _electron: electron } = require('@playwright/test')
  3  | 
  4  | const projectRoot = path.resolve(__dirname, '../..')
  5  | 
  6  | async function launchOnTask (userDataDir, initialURL) {
  7  |   return electron.launch({
  8  |     cwd: projectRoot,
  9  |     args: [
  10 |       '.',
  11 |       '--ontask-e2e',
  12 |       '--ontask-e2e-user-data=' + userDataDir,
  13 |       initialURL
  14 |     ],
  15 |     env: Object.assign({}, process.env, { GROQ_API_KEY: '' })
  16 |   })
  17 | }
  18 | 
  19 | async function waitForPage (app, predicate) {
  20 |   const current = app.windows().find(predicate)
  21 |   if (current) {
  22 |     return current
  23 |   }
> 24 |   return app.waitForEvent('window', { predicate })
     |              ^ TimeoutError: electronApplication.waitForEvent: Timeout 30000ms exceeded while waiting for event "window"
  25 | }
  26 | 
  27 | module.exports = { launchOnTask, waitForPage }
  28 | 
```