import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// jsdom comes from the harness that test/harness-resolve.mjs found, like the dsh packages.
const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const { JSDOM } = createRequire(join(process.env.DSH_HARNESS ?? join(PLUGIN, '..', 'deepseek-harness'), 'package.json'))('jsdom')

// The memory dialog's history page, bundled once and run with a minimal React
// stand-in; state comes back from a seed list so each render is deterministic.
const { outputFiles } = await build({
  stdin: {
    contents: "export { History, HistoryRow } from './src/client/memory-panel.js'",
    resolveDir: PLUGIN,
  },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
let seeds = []
let setters = []
const react = {
  createContext: (initial) => { const ctx = { value: initial }; ctx.Provider = ({ value, children }) => { ctx.value = value; return children }; return ctx },
  useContext: ctx => ctx.value,
  useCallback: fn => fn,
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  Fragment: Symbol('Fragment'),
  useEffect() {}, useLayoutEffect() {},
  useState: (initial) => {
    const index = setters.length
    setters.push([])
    const value = index < seeds.length ? seeds[index] : initial
    return [value, next => setters[index].push(next)]
  },
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
const { History, HistoryRow } = module.exports

// A vnode tree's function components are run as they are found, so text and
// handlers read as they would in the DOM.
function* walk(node) {
  if (node === null || node === undefined || node === false) return
  if (Array.isArray(node)) { for (const item of node) yield* walk(item); return }
  if (typeof node === 'object' && node.type !== undefined) {
    if (typeof node.type === 'function') { yield* walk(node.type(node.props)); return }
    yield node
    yield* walk(node.props?.children)
    return
  }
  yield node
}
const render = (component, props, stateSeeds) => {
  seeds = stateSeeds ?? []
  setters = []
  return component(props)
}
const texts = tree => [...walk(tree)].filter(node => typeof node === 'string').join(' ')
const buttons = tree => [...walk(tree)].filter(node => typeof node === 'object' && node?.type === 'button')

const owner = { id: 'b2', name: 'Writer', group: false }
const NOW = new Date('2026-11-02T12:00:00Z').getTime()
const row = (over) => ({ id: `r-${Math.random()}`, time: '2026-11-02T11:00:00Z', op: 'add', scope: 'own', text: 'Likes tea', by: 'user', restored: false, ...over })

test('a history row shows the change, who made it, and an undo button', () => {
  const tree = render(HistoryRow, { row: row({ op: 'add', scope: 'team', by: 'Coder' }), undo: async () => true, now: NOW })
  const text = texts(tree)
  assert.match(text, /Added to team memory: Likes tea/)
  assert.match(text, /an hour ago · by Coder|1 hour ago · by Coder|hour.*by Coder/)
  const undo = buttons(tree)[0]
  assert.equal(undo.props['aria-label'], 'Undo this change')
})

test('an undone row shows the muted label instead of the button', () => {
  const tree = render(HistoryRow, { row: row({ restored: true, op: 'remove' }), undo: async () => true, now: NOW })
  const text = texts(tree)
  assert.match(text, /Removed: Likes tea/)
  assert.match(text, /Undone/)
  assert.equal(buttons(tree).length, 0)
})

test('undo asks for a second click before it calls memoryRestore', async () => {
  const calls = []
  // confirming=false, busy=false: the first click only arms the confirm state.
  let tree = render(HistoryRow, { row: row(), undo: async r => calls.push(r) ?? true, now: NOW }, [false, false])
  await buttons(tree)[0].props.onClick()
  assert.deepEqual(calls, [])
  assert.deepEqual(setters[0], [true])
  // confirming=true: the second click runs the undo.
  tree = render(HistoryRow, { row: row({ id: 'row-9' }), undo: async r => calls.push(r.id) ?? true, now: NOW }, [true, false])
  await buttons(tree)[0].props.onClick()
  assert.deepEqual(calls, ['row-9'])
})

test('the page lists rows, an empty state, and Load more asks for the next page', async () => {
  const asked = []
  const actions = { memoryHistory: async (id, before) => { asked.push([id, before]); return { rows: [row()], more: null } } }
  const rows = [row({ text: 'Kept one' }), row({ op: 'replace', text: 'Kept two' })]
  const tree = render(History, { owner, actions, undo: async () => true, now: NOW }, [rows, 'cursor-1', false])
  const text = texts(tree)
  assert.match(text, /Added: Kept one/)
  assert.match(text, /Updated: Kept two/)
  const more = buttons(tree).find(node => node.props.className === 'bt-soft bt-soft-sm')
  assert.ok(more, 'Load more renders while more is set')
  await more.props.onClick()
  assert.deepEqual(asked, [['b2', 'cursor-1']])

  const empty = render(History, { owner, actions, undo: async () => true, now: NOW }, [[], null, false])
  assert.match(texts(empty), /No changes yet/)
})

// Keep state and refs across renders so rejected and late requests are observed
// through the same mounted page, rather than only through a seeded success state.
function mountHistory(t, props) {
  const original = { useState: react.useState, useRef: react.useRef, useEffect: react.useEffect }
  const slots = []
  const writes = []
  let cursor = 0
  let pending = []
  react.useState = (initial) => {
    const index = cursor++
    if (!(index in slots)) slots[index] = initial
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; writes.push(index) }]
  }
  react.useRef = initial => {
    const index = cursor++
    if (!(index in slots)) slots[index] = { current: initial }
    return slots[index]
  }
  react.useEffect = (effect, deps) => {
    const index = cursor++
    if (slots[index]?.deps.every((value, at) => value === deps[at])) return
    slots[index]?.cleanup?.()
    slots[index] = { deps }
    pending.push(() => { slots[index].cleanup = effect() })
  }
  const draw = (next = props) => {
    props = next
    cursor = 0
    pending = []
    const tree = History(props)
    for (const effect of pending) effect()
    return tree
  }
  const unmount = () => { for (const slot of slots) slot?.cleanup?.() }
  t.after(() => { unmount(); Object.assign(react, original) })
  return { draw, slots, writes, unmount }
}

const settle = () => new Promise(resolve => setImmediate(resolve))

test('an initial history failure reports the error and Try again loads the real rows', async (t) => {
  let count = 0
  const actions = { memoryHistory: async () => { if (++count === 1) throw new Error('History is offline'); return { rows: [row({ text: 'Kept after retry' })], more: null } } }
  const page = mountHistory(t, { owner, actions, undo: async () => true, now: NOW })
  page.draw()
  await settle()
  const failure = page.draw()
  assert.match(texts(failure), /History is offline/)
  assert.doesNotMatch(texts(failure), /No changes yet/)
  assert.ok([...walk(failure)].some(node => node?.props?.role === 'alert'))
  buttons(failure).find(button => texts(button) === 'Try again').props.onClick()
  await settle()
  assert.equal(count, 2)
  assert.equal(page.slots[0][0].text, 'Kept after retry')
  assert.equal(page.slots[3], '')
})

test('a failed next page retains rows and retries the same cursor without duplicates', async (t) => {
  const calls = []
  let count = 0
  const actions = { memoryHistory: async (id, before) => {
    calls.push([id, before])
    if (++count === 1) return { rows: [row({ id: 'first', text: 'First kept row' })], more: 'cursor-1' }
    if (count === 2) throw new Error('Next page failed')
    return { rows: [row({ id: 'second', text: 'Second kept row' })], more: null }
  } }
  const page = mountHistory(t, { owner, actions, undo: async () => true, now: NOW })
  page.draw()
  await settle()
  buttons(page.draw()).find(button => texts(button) === 'Load more').props.onClick()
  await settle()
  assert.deepEqual(Array.from(page.slots[0], entry => entry.id), ['first'])
  assert.equal(page.slots[1], 'cursor-1')
  const failure = page.draw()
  assert.match(texts(failure), /First kept row.*Next page failed|Next page failed.*First kept row/)
  buttons(failure).find(button => texts(button) === 'Try again').props.onClick()
  await settle()
  assert.deepEqual(Array.from(page.slots[0], entry => entry.id), ['first', 'second'])
  assert.deepEqual(calls, [[owner.id, undefined], [owner.id, 'cursor-1'], [owner.id, 'cursor-1']])
})

test('closing history ignores a late success or failure', async (t) => {
  let resolve
  let reject
  const actions = { memoryHistory: () => new Promise((yes, no) => { resolve = yes; reject = no }) }
  const page = mountHistory(t, { owner, actions, undo: async () => true, now: NOW })
  page.draw()
  page.unmount()
  const before = page.writes.length
  resolve({ rows: [row()], more: null })
  await settle()
  assert.equal(page.writes.length, before)
  page.draw({ owner: { ...owner, id: 'another-bot' }, actions, undo: async () => true, now: NOW })
  page.unmount()
  const again = page.writes.length
  reject(new Error('Late failure'))
  await settle()
  assert.equal(page.writes.length, again)
})

test('changing the memory owner ignores the old page reply', async (t) => {
  const pending = new Map()
  const actions = { memoryHistory: id => new Promise(resolve => pending.set(id, resolve)) }
  const props = { owner, actions, undo: async () => true, now: NOW }
  const page = mountHistory(t, props)
  page.draw()
  page.draw({ ...props, owner: { ...owner, id: 'another-bot' } })
  pending.get('another-bot')({ rows: [row({ text: 'New owner memory' })], more: null })
  await settle()
  pending.get(owner.id)({ rows: [row({ text: 'Old owner memory' })], more: 'old-cursor' })
  await settle()
  assert.equal(page.slots[0][0].text, 'New owner memory')
  assert.equal(page.slots[1], null)
})
