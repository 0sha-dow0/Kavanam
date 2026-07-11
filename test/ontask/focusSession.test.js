const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadStore () {
  const handlers = {}
  const persistenceCalls = { updated: 0, completed: 0 }
  const saved = {
    task: 'finish report',
    startedAt: 123,
    totalFocusMs: 60000,
    allowlist: ['docs.example.com'],
    overrides: [{ page: 'https://example.com', id: 'item' }]
  }
  const olderSaved = {
    task: 'review notes',
    startedAt: 456,
    allowlist: ['notes.example.com'],
    overrides: []
  }
  const context = {
    console,
    Date,
    process: { argv: [] },
    ontaskPersistence: {
      data: {},
      onSessionStart: () => {},
      onSessionUpdate: () => { persistenceCalls.updated += 1 },
      onSessionComplete: () => { persistenceCalls.completed += 1 },
      getLastSession: () => saved,
      getSession: () => olderSaved,
      load: () => {},
      save: () => {}
    },
    ontaskRelevanceEngine: {
      onSessionStart: () => Promise.resolve(),
      onSessionEnd: () => {}
    },
    ontaskGroqClient: { available: () => false },
    ontaskNavigationGuard: { isSearchEngineDomain: () => false },
    ontaskIPC: {
      requireChrome: () => {},
      requireContent: () => {},
      take: () => {},
      cleanTask: value => value,
      cleanDomain: value => value,
      cleanOverride: (event, value) => value
    },
    ipc: {
      handle: (name, fn) => { handlers[name] = fn },
      on: (name, fn) => { handlers[name] = fn }
    },
    webContents: { getAllWebContents: () => [] },
    sendIPCToWindow: () => {},
    windows: { getCurrent: () => null }
  }
  vm.createContext(context)
  const file = path.join(__dirname, '../../main/focusSession.js')
  vm.runInContext(fs.readFileSync(file, 'utf8') + '\nthis.store = focusSession', context)
  return { store: context.store, handlers, persistenceCalls }
}

test('an active task cannot be replaced', () => {
  const { store } = loadStore()
  store.start('first task')
  assert.throws(() => store.start('second task'), /already active/)
  assert.equal(store.get().task, 'first task')
})

test('resume restores allowlist, overrides, and start time', () => {
  const { handlers } = loadStore()
  const state = handlers['ontask-resume-session']()
  assert.equal(state.task, 'finish report')
  assert.equal(state.startedAt, 123)
  assert.equal(state.totalFocusMs, 60000)
  assert.deepEqual(Array.from(state.allowlist), ['docs.example.com'])
  assert.equal(state.overrides[0].id, 'item')
})

test('resume can target an older unfinished session', () => {
  const { handlers } = loadStore()
  const state = handlers['ontask-resume-session'](null, 456)
  assert.equal(state.task, 'review notes')
  assert.equal(state.startedAt, 456)
  assert.deepEqual(Array.from(state.allowlist), ['notes.example.com'])
})

test('editing keeps the active session and focus time', () => {
  const { store, handlers } = loadStore()
  const started = store.start('draft report')
  store.updateCurrentFocusMs(42000)

  const state = handlers['ontask-edit-session'](null, 'revise final report')

  assert.equal(state.task, 'revise final report')
  assert.equal(state.startedAt, started.startedAt)
  assert.equal(state.currentFocusMs, 42000)
  assert.deepEqual(Array.from(state.allowlist), [])
})

test('manual pause state is exposed without replacing the session', () => {
  const { store, handlers } = loadStore()
  store.start('focused task')

  const paused = handlers['ontask-set-paused'](null, true, 12000)
  assert.equal(paused.paused, true)
  assert.equal(paused.pauseCount, 1)
  assert.equal(paused.currentFocusMs, 12000)

  const resumed = handlers['ontask-set-paused'](null, false, 12000)
  assert.equal(resumed.paused, false)
  assert.equal(resumed.pauseCount, 1)
})

test('leaving returns to intake without completing the task', () => {
  const { store, handlers, persistenceCalls } = loadStore()
  store.start('unfinished task')

  const result = handlers['ontask-leave-session'](null, 18000)

  assert.equal(result, null)
  assert.equal(store.isActive(), false)
  assert.equal(persistenceCalls.updated, 1)
  assert.equal(persistenceCalls.completed, 0)
})
