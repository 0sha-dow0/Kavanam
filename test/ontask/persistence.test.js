const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')

function loadPersistence (directory) {
  const handlers = {}
  const context = {
    require,
    console,
    Date,
    fs,
    path,
    app: { getPath: () => directory },
    ipc: { handle: (name, fn) => { handlers[name] = fn } }
  }
  vm.createContext(context)
  const file = path.join(__dirname, '../../main/persistence.js')
  vm.runInContext(fs.readFileSync(file, 'utf8') + '\nthis.persistence = ontaskPersistence', context)
  return { persistence: context.persistence, handlers }
}

test('migrates the legacy last session into the resumable session list', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ontask-persistence-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.writeFileSync(path.join(directory, 'ontask.json'), JSON.stringify({
    lastSession: { task: 'finish report', startedAt: 123, allowlist: [], overrides: [] },
    history: ['finish report'],
    firstRunDone: true
  }))

  const { persistence } = loadPersistence(directory)
  const sessions = persistence.getSessions()

  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].task, 'finish report')
  assert.equal(sessions[0].startedAt, 123)
})

test('keeps full records for every started session', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ontask-persistence-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const { persistence, handlers } = loadPersistence(directory)

  persistence.onSessionStart({ task: 'first task', startedAt: 100, allowlist: [], overrides: [] })
  persistence.onSessionStart({ task: 'second task', startedAt: 200, allowlist: ['example.com'], overrides: [] })

  const sessions = handlers['ontask-get-sessions']()
  assert.equal(sessions.length, 2)
  assert.deepEqual(new Set(sessions.map(session => session.task)), new Set(['first task', 'second task']))
  assert.equal(persistence.getSession(100).task, 'first task')
  assert.deepEqual(Array.from(persistence.getSession(200).allowlist), ['example.com'])
})

test('persists accumulated and currently active focus time', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ontask-persistence-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const { persistence } = loadPersistence(directory)
  const openedAt = Date.now() - 5000

  persistence.onSessionStart({
    task: 'timed task',
    startedAt: openedAt,
    openedAt,
    totalFocusMs: 10000,
    currentFocusMs: 5000,
    allowlist: [],
    overrides: []
  })

  assert.equal(persistence.getSession(openedAt).totalFocusMs, 15000)
})
