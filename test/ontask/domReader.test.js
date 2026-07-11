const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadReader (adapter, generic) {
  const context = {
    console,
    setTimeout,
    clearTimeout,
    MutationObserver: function () {},
    document: { readyState: 'loading', documentElement: {} },
    window: {
      location: { protocol: 'https:', href: 'https://example.com' },
      addEventListener: () => {}
    },
    ontaskActiveAdapter: () => adapter,
    ontaskGenericExtractor: generic,
    ontaskBridge: { getStatus: cb => cb({ enforcing: true }), sendCards: () => {} },
    ontaskSurfaceApplier: { markPending: () => {} }
  }
  vm.createContext(context)
  const file = path.join(__dirname, '../../js/preload/domReader.js')
  vm.runInContext(fs.readFileSync(file, 'utf8') + '\nthis.reader = ontaskDomReader', context)
  return context.reader
}

test('SPA node replacements with the same id are rescored', () => {
  const first = {}
  const second = {}
  let current = first
  const adapter = {
    getRecommendationCards: () => [current],
    cardId: () => 'stable-id',
    extractText: () => 'A sufficiently descriptive recommendation title'
  }
  const reader = loadReader(adapter, adapter)
  assert.equal(reader.collect().length, 1)
  assert.equal(reader.collect().length, 0)
  current = second
  assert.equal(reader.collect().length, 1)
})

test('a broken adapter falls back to the generic extractor', () => {
  const node = {}
  const adapter = { getRecommendationCards: () => { throw new Error('selector broke') } }
  const generic = {
    getRecommendationCards: () => [node],
    cardId: () => 'generic-id',
    extractText: () => 'A sufficiently descriptive generic recommendation'
  }
  const reader = loadReader(adapter, generic)
  assert.equal(reader.collect().length, 1)
})
