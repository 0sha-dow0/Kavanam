const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadGuard () {
  const session = { task: 'write a thesis', expandedIntent: '', allowlist: [], keywords: [] }
  const context = {
    URL,
    WeakSet,
    Date,
    console,
    setTimeout,
    clearTimeout,
    focusSession: {
      isActive: () => true,
      get: () => session,
      setSubtask: () => {}
    },
    ontaskRelevanceEngine: {
      scoreText: async () => 0.5,
      band: score => score >= 0.55 ? 'on' : score < 0.4 ? 'off' : 'ambiguous',
      enforcing: () => true,
      onSubtask: () => {}
    },
    ontaskGroqClient: {
      available: () => false,
      tiebreak: async () => 'off'
    },
    ontaskPersistence: { onSessionUpdate: () => {} },
    ipc: { on: () => {}, handle: () => {} },
    sendIPCToWindow: () => {},
    windows: { getCurrent: () => null }
  }
  vm.createContext(context)
  const file = path.join(__dirname, '../../main/navigationGuard.js')
  vm.runInContext(fs.readFileSync(file, 'utf8') + '\nthis.guard = ontaskNavigationGuard', context)
  return { guard: context.guard, context, session }
}

test('unknown cross-domain navigation is locally scored with an empty allowlist', () => {
  const { guard } = loadGuard()
  const decision = guard.decide('https://example.com/articles/writing', 'https://school.edu/')
  assert.equal(decision.defer, true)
})

test('registered content views are recognized independent of partition', () => {
  const { guard } = loadGuard()
  const listeners = {}
  const wc = { id: 1, on: (name, fn) => { listeners[name] = fn } }
  guard.register(wc)
  assert.equal(guard.isWebView(wc), true)
  assert.equal(typeof listeners['will-navigate'], 'function')
})

test('ambiguous navigation waits for and applies the Groq verdict', async () => {
  const { guard, context } = loadGuard()
  context.ontaskGroqClient.available = () => true
  context.ontaskGroqClient.tiebreak = async () => 'off'
  const decision = await guard.resolve('https://example.com/possibly-related-topic', 'https://school.edu/')
  assert.equal(decision.allow, false)
  assert.equal(decision.reason, 'tiebreak off-task')
})

test('navigation scoring outages fail open', async () => {
  const { guard, context } = loadGuard()
  context.ontaskRelevanceEngine.scoreText = async () => { throw new Error('model failed') }
  const decision = await guard.resolve('https://example.com/some-topic', 'https://school.edu/')
  assert.equal(decision.allow, true)
  assert.equal(decision.reason, 'scoring-outage')
})
