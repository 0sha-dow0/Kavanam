const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadBoundary () {
  const context = {
    URL,
    Buffer,
    Date,
    windows: { windowFromContents: () => null },
    ontaskNavigationGuard: { isWebView: () => false }
  }
  vm.createContext(context)
  const file = path.join(__dirname, '../../main/ontaskIPC.js')
  vm.runInContext(fs.readFileSync(file, 'utf8') + '\nthis.boundary = ontaskIPC', context)
  return { boundary: context.boundary, context }
}

test('only the exact browser chrome main frame is trusted', () => {
  const { boundary, context } = loadBoundary()
  const frame = { url: 'min://app/index.html' }
  const sender = { id: 1, mainFrame: frame, isDestroyed: () => false, getURL: () => frame.url }
  context.windows.windowFromContents = value => value === sender ? {} : null
  assert.equal(boundary.requireChrome({ sender, senderFrame: frame }), sender)
  frame.url = 'min://app/pages/settings/index.html'
  assert.throws(() => boundary.requireChrome({ sender, senderFrame: frame }), /Invalid OnTask IPC/)
})

test('content IPC is restricted to registered HTTP main frames', () => {
  const { boundary, context } = loadBoundary()
  const frame = { url: 'https://example.com/feed#section' }
  const sender = { id: 2, mainFrame: frame, isDestroyed: () => false, getURL: () => frame.url }
  context.ontaskNavigationGuard.isWebView = value => value === sender
  assert.equal(boundary.requireContent({ sender, senderFrame: frame }).url, 'https://example.com/feed')
  assert.throws(() => boundary.requireContent({ sender, senderFrame: { url: frame.url } }), /Invalid OnTask IPC/)
})

test('domains are canonical and paths or credentials are rejected', () => {
  const { boundary } = loadBoundary()
  assert.equal(boundary.cleanDomain('https://www.Example.com/'), 'example.com')
  assert.throws(() => boundary.cleanDomain('https://example.com/path'), /Invalid OnTask IPC/)
  assert.throws(() => boundary.cleanDomain('https://user@example.com'), /Invalid OnTask IPC/)
})

test('card batches are bounded and deduplicated', () => {
  const { boundary, context } = loadBoundary()
  const frame = { url: 'https://example.com/feed' }
  const sender = { id: 3, mainFrame: frame, isDestroyed: () => false, getURL: () => frame.url }
  context.ontaskNavigationGuard.isWebView = () => true
  const event = { sender, senderFrame: frame }
  // duplicate or malformed items are skipped (first occurrence wins) —
  // one bad card must not disable curation for the whole page
  const deduped = boundary.cleanItems(event, {
    items: [{ id: 'same', text: 'one' }, { id: 'same', text: 'two' }, { id: 7, text: 'bad id' }]
  })
  assert.equal(deduped.items.length, 1)
  assert.equal(deduped.items[0].text, 'one')
  // structural abuse still rejects wholesale
  assert.throws(() => boundary.cleanItems(event, {
    items: Array.from({ length: 51 }, (_, i) => ({ id: String(i), text: 'text' }))
  }), /Invalid OnTask IPC/)
})
