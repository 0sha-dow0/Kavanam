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

async function waitForPage (app, predicate) {
  const current = app.windows().find(predicate)
  if (current) {
    return current
  }
  return app.waitForEvent('window', { predicate })
}

module.exports = { launchOnTask, waitForPage }
