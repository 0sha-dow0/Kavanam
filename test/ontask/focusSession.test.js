const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadStore () {
  const handlers = {}
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
      onSessionUpdate: () => {},
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
  return { store: context.store, handlers }
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
