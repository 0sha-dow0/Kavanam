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
    allowlist: ['docs.example.com'],
    overrides: [{ page: 'https://example.com', id: 'item' }]
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
      load: () => {},
      save: () => {}
    },
    ontaskRelevanceEngine: {
      onSessionStart: () => Promise.resolve(),
      onSessionEnd: () => {}
    },
    ontaskGroqClient: { available: () => false },
    ontaskIPC: {
      requireChrome: () => {},
      requireContent: () => {},
      take: () => {},
      cleanTask: value => value,
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
  const state = handlers['ontask-resume-session']({})
  assert.equal(state.task, 'finish report')
  assert.equal(state.startedAt, 123)
  assert.deepEqual(Array.from(state.allowlist), ['docs.example.com'])
  assert.equal(state.overrides[0].id, 'item')
})
