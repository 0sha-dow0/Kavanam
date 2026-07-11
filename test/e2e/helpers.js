const path = require('node:path')
const { _electron: electron } = require('@playwright/test')

const projectRoot = path.resolve(__dirname, '../..')

async function launchOnTask (userDataDir, initialURL) {
  return electron.launch({
    cwd: projectRoot,
    args: [
      '.',
      '--ontask-e2e',
      '--ontask-e2e-user-data=' + userDataDir,
      initialURL
    ],
    env: Object.assign({}, process.env, { GROQ_API_KEY: '' })
  })
}

async function waitForPage (app, predicate, timeoutMs = 30000) {
  // A window's URL is blank at creation and only becomes its real URL after
  // navigation — so a creation-time 'window' predicate is racy. Poll every
  // window (existing and newly opened) until one satisfies the predicate.
  const deadline = Date.now() + timeoutMs
  const seen = new Set()
  const check = () => app.windows().find(predicate)

  let found = check()
  if (found) {
    return found
  }

  return new Promise((resolve, reject) => {
    const tryResolve = () => {
      const hit = check()
      if (hit) {
        cleanup()
        resolve(hit)
        return true
      }
      return false
    }
    const onWindow = (page) => {
      if (seen.has(page)) {
        return
      }
      seen.add(page)
      if (!tryResolve()) {
        page.on('framenavigated', tryResolve)
      }
    }
    const interval = setInterval(() => {
      if (tryResolve()) {
        return
      }
      if (Date.now() > deadline) {
        cleanup()
        reject(new Error('waitForPage: no matching window within ' + timeoutMs + 'ms'))
      }
    }, 250)
    const cleanup = () => {
      clearInterval(interval)
      app.off('window', onWindow)
    }
    app.on('window', onWindow)
    app.windows().forEach(onWindow)
  })
}

module.exports = { launchOnTask, waitForPage }
