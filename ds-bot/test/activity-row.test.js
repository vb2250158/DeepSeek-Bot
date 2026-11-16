import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const { JSDOM } = createRequire(join(process.env.DSH_HARNESS, 'package.json'))('jsdom')

const bundle = await build({ stdin: { contents: "export { ActivityIndicator, rabiFailureMessage } from './src/client/activity-row.js'", resolveDir: fileURLToPath(new URL('..', import.meta.url)) }, bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent', external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'] })

function fixture({ running = false, pending = [], live = {}, hook = null } = {}) {
  const slots = [], effects = [], layouts = []
  let cursor = 0, dirty = false
  const flow = { querySelectorAll: () => [], querySelector: () => null }
  const scroller = { scrollTop: 0, querySelector: () => flow }
  const nextSlot = initial => { const id = cursor++; return slots[id] ??= { value: typeof initial === 'function' ? initial() : initial } }
  const effect = queue => (callback, deps) => {
    const slot = nextSlot()
    if (slot.deps && deps && slot.deps.length === deps.length && deps.every((value, i) => value === slot.deps[i])) return
    slot.deps = deps
    queue.push(() => { slot.cleanup?.(); slot.cleanup = callback() })
  }
  const module = { exports: {} }
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports,
    require: name => name === 'react' ? {
  createContext: initial => { const ctx = { value: initial }; ctx.Provider = ({ value, children }) => { ctx.value = value; return children }; return ctx },
  useContext: ctx => ctx.value,
  useCallback: fn => fn,
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
      createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
      useState: initial => { const slot = nextSlot(initial); return [slot.value, value => { const next = typeof value === 'function' ? value(slot.value) : value; if (next !== slot.value) { slot.value = next; dirty = true } }] },
      useRef: initial => nextSlot(() => ({ current: initial })).value,
      useMemo: make => { cursor++; return make() },
      useEffect: effect(effects), useLayoutEffect: effect(layouts),
    } : name === 'react-dom' ? { createPortal: (node, host) => ({ node, host }) } : {},
    document: { querySelector: selector => selector === '[data-chat-flow]' ? flow : selector === '[data-conversation-scroll]' ? scroller : null },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: fn => { fn(); return 1 }, cancelAnimationFrame() {},
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  })
  const props = { sessionId: 'bot', useRoster: select => select({ byId: { bot: { id: 'bot' } }, roomsById: {} }),
    useSessionStatus: select => select(new Map([['bot', { running }]])), useSession: select => select({ pendingSubmissions: pending }),
    useLive: select => select({ bot: live }), useWork: select => select({ rabi: { bot: hook } }), actions: { clearLive() {}, openSettings() {} } }
  let view
  for (let i = 0; i < 6; i++) { cursor = 0; dirty = false; view = module.exports.ActivityIndicator(props); for (const run of layouts.splice(0)) run(); for (const run of effects.splice(0)) run(); if (!dirty) break }
  return { view, flow, message: module.exports.rabiFailureMessage }
}

// The activity row and the diagnostics it reports into, bundled once and run with a
// minimal React stand-in; the row's DOM helpers only read `document` at call time.
const { outputFiles } = await build({
  stdin: {
    contents: [
      "export { findHost, rowVisible, freshInputAt } from './src/client/activity-row.js'",
      "export { clientErrors } from './src/client/diagnostics.js'",
    ].join('\n'),
    resolveDir: PLUGIN,
  },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const react = {
  createContext: (initial) => { const ctx = { value: initial }; ctx.Provider = ({ value, children }) => { ctx.value = value; return children }; return ctx },
  useContext: ctx => ctx.value,
  useCallback: fn => fn,
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: Symbol('Fragment'),
  useEffect() {}, useLayoutEffect() {}, useState: initial => [initial, () => {}],
  useMemo: make => make(), useRef: current => ({ current }), useId: () => 'id',
}
const dom = new JSDOM('<!doctype html><body></body>')
const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports,
  document: dom.window.document,
  window: { matchMedia: () => ({ matches: false }) },
  MutationObserver: dom.window.MutationObserver,
  requestAnimationFrame: fn => setTimeout(fn, 0),
  cancelAnimationFrame: id => clearTimeout(id),
  require: name => (name === 'react' ? react : name === 'react-dom' ? { createPortal: node => node } : {}),
})
const { findHost, freshInputAt } = module.exports

test('submitting a message shows feedback before the Host running state exists', () => {
  const { view, flow } = fixture({ pending: [{ placement: 'transcript', time: 1 }] })
  assert.equal(view.host, flow)
  assert.equal(view.node.props.role, 'status')
  assert.match(JSON.stringify(view.node), /Sending message/)
})

// The shell renders its running status inside the flow, before the pending steering
// rows, so hosting the row there puts it above an interjection's echo until the echo
// commits to the transcript — the row first sits between two user messages and then
// jumps below the new one. The row mounts at the flow (the column around the shell's
// slot), where it stays after those rows, even under an extra wrapper.
test('the activity row mounts at the flow around the running slot, not at the slot', () => {
  dom.window.document.body.innerHTML = '<div data-chat-flow id="flow"><div class="wrap"><div data-chat-running id="slot"></div></div></div>'
  const host = findHost()
  assert.equal(host?.id, 'flow')
})

test('the activity row stays after a pending steer echo, and after the message once it commits', () => {
  dom.window.document.body.innerHTML = [
    '<div data-chat-flow id="flow">',
    '<div data-slot="conversation.chat.flow">',
    '<div data-chat-flow-key="u1" data-chat-flow-kind="user" id="first">first message</div>',
    '<div data-chat-running id="slot"></div>',
    '<div data-chat-flow-key="s1" data-chat-flow-kind="steering" id="echo">a steer</div>',
    '</div>',
    '</div>',
  ].join('')
  const doc = dom.window.document
  const row = doc.createElement('div')
  row.className = 'bt-typing'
  findHost().appendChild(row)
  const echo = doc.getElementById('echo')
  const first = doc.getElementById('first')
  // Document order is what the eye reads: the pending echo draws before the row.
  assert.ok(echo.compareDocumentPosition(row) & doc.defaultView.Node.DOCUMENT_POSITION_FOLLOWING, 'the pending steer draws above the row')
  assert.ok(first.compareDocumentPosition(echo) & doc.defaultView.Node.DOCUMENT_POSITION_FOLLOWING)
  // The echo commits into the transcript: the row must still come after it.
  echo.remove()
  const committed = doc.createElement('div')
  committed.id = 'committed'
  committed.setAttribute('data-chat-flow-key', 's1')
  committed.setAttribute('data-chat-flow-kind', 'steering')
  doc.getElementById('slot').before(committed)
  assert.ok(committed.compareDocumentPosition(row) & doc.defaultView.Node.DOCUMENT_POSITION_FOLLOWING, 'the committed steer still draws above the row')
})

test('a live Rabi Hook names the wait and a streaming reply needs no duplicate typing row', () => {
  const waiting = fixture({ running: true, hook: { state: 'running', point: 'SessionStart' } })
  assert.match(JSON.stringify(waiting.view), /Connecting to Rabi and reading context/)
  assert.equal(fixture({ running: true, live: { reply: { text: true } } }).view, null)
  assert.equal(fixture().view, null)
})

test('stopped Rabi and incomplete plan recovery remain explicit after the run ends', () => {
  const stopped = fixture({ hook: { state: 'failed', code: 'host_stopped' } })
  assert.equal(stopped.view.node.props.role, 'alert')
  assert.match(JSON.stringify(stopped.view), /Rabi is not running/)
  assert.match(stopped.message({ code: 'PLAN_STORAGE_STARTUP_UNAVAILABLE' }), /restoring its plan service/)
  assert.match(stopped.message({ uncertain: true }), /original receipt/)
})

test('refresh does not replay an old Rabi Hook failure notice', () => {
  assert.equal(fixture({ hook: { state: 'failed', code: 'host_stopped', at: 1 } }).view, null)
  assert.equal(fixture({ hook: { state: 'failed', code: 'host_stopped', at: Date.now() + 1000 } }).view.node.props.role, 'alert')
})

test('streamed text followed by running work keeps the activity row', () => {
  const { view } = fixture({ running: true, live: { reply: { text: true }, tool: { label: 'Reading file', at: 1 } } })
  assert.equal(view.node.props.role, 'status')
  assert.match(JSON.stringify(view.node), /Reading file/)
})

// A queued message waits for the next turn; a transcript or steering send counts
// as fresh input, and a steer the host saw counts from when it landed.
test('fresh input ignores queued sends and takes the newest of the rest', () => {
  const submissions = [
    { placement: 'queued', time: 300 },
    { placement: 'steering', time: 100 },
    { placement: 'transcript', time: 200 },
  ]
  assert.equal(freshInputAt(submissions, undefined), 200)
  assert.equal(freshInputAt(submissions, 400), 400)
  assert.equal(freshInputAt(submissions, 50), 200)
  assert.equal(freshInputAt([{ placement: 'queued', time: 300 }], undefined), 0)
  assert.equal(freshInputAt(undefined, 400), 400)
  assert.equal(freshInputAt([], undefined), 0)
})
