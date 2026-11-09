import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// The composer's "+" bundled with a React stand-in that counts hook calls. React needs a
// component to call the same hooks on every render: one render that calls a hook the
// previous render did not is an error, and the composer's slot drops the "+" for good.
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/composer.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom'],
})
let hooks = 0
const react = {
  Fragment: 'fragment',
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useState: initial => { hooks += 1; return [initial, () => {}] },
  useRef: current => { hooks += 1; return { current } },
  useEffect: () => { hooks += 1 },
  useLayoutEffect: () => { hooks += 1 },
  useMemo: make => { hooks += 1; return make() },
}
const module = { exports: {} }
const listeners = new Map()
const page = {
  matchMedia: () => ({ matches: false }),
  addEventListener(name, listener) {
    if (!listeners.has(name)) listeners.set(name, new Set())
    listeners.get(name).add(listener)
  },
  removeEventListener: (name, listener) => listeners.get(name)?.delete(listener),
}
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports, document: { body: {} },
  window: page, setTimeout, clearTimeout,
  require: name => (name === 'react' ? react : name === 'react-dom' ? { createPortal: node => node } : {}),
})
const { ComposerPlus } = module.exports

// Renders the "+" for a chat whose Bot is in the roster as `roster` says, and counts its hook calls.
function render(roster) {
  hooks = 0
  const tree = ComposerPlus({
    sessionId: 'chief', useRoster: select => select(roster),
    useInput: select => select({ phase: 'plain', draft: '', attachmentIds: [], queue: [] }),
    actions: { canReferenceChat: () => false },
  })
  return { tree, hooks }
}

// A group whose own Session moved to a fresh part (`room.sessionId`), with the Main
// Bot as its admin so the goal entry is offered.
const movedRoom = { id: 'g', sessionId: 'g-part2', name: 'Ops', members: ['a'], admin: 'a' }
const movedRoster = { byId: { a: { id: 'a', name: 'Chief' } }, roomsById: { g: movedRoom, 'g-part2': movedRoom } }
const hooksFor = (roster, actions) => ComposerPlus({
  sessionId: 'g-part2', useRoster: select => select(roster),
  useInput: select => select({ phase: 'plain', draft: '', attachmentIds: [], queue: [] }),
  actions,
})

test('the + Set a goal entry stores the room id when the Session moved', () => {
  const calls = []
  const original = react.useState
  // Seed the menu open; the test's real useState never re-renders.
  react.useState = initial => [initial === null ? { files: false } : initial, () => {}]
  try {
    const tree = hooksFor(movedRoster, { canReferenceChat: () => false, composeGoal: id => calls.push(id) })
    const items = []
    const walk = (node) => {
      if (node === null || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (typeof node.type === 'function') { walk(node.type(node.props)); return }
      if (node.props?.role === 'menuitem') items.push(node)
      for (const child of node.children ?? []) walk(child)
    }
    walk(tree)
    const entry = items.find(item => JSON.stringify(item).includes('Set a goal'))
    assert.ok(entry)
    entry.props.onClick()
    assert.deepEqual(calls, ['g'])
  } finally { react.useState = original }
})

test('the "+" calls the same hooks whether or not its roster knows the Bot yet', () => {
  const roster = { ready: false }
  const unknown = render(roster)
  roster.byId = { chief: { id: 'chief' } }
  const known = render(roster)
  roster.byId = {}
  const forgotten = render(roster)
  assert.equal(unknown.tree, null)
  assert.equal(known.tree.type, 'fragment')
  assert.equal(forgotten.tree, null)
  assert.equal(known.hooks, unknown.hooks)
  assert.equal(forgotten.hooks, unknown.hooks)
})

// Keep the same mounted button through preference changes so the listener's
// dependencies and placeholder cleanup are exercised as React applies them.
function mountComposer(t, prefs) {
  const original = { useState: react.useState, useRef: react.useRef, useEffect: react.useEffect }
  const slots = []
  const effects = []
  let cursor = 0
  react.useState = initial => {
    const index = cursor++
    if (!(index in slots)) slots[index] = initial
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
  }
  react.useRef = initial => {
    const index = cursor++
    if (!(index in slots)) slots[index] = { current: initial }
    return slots[index]
  }
  react.useEffect = (effect, deps) => {
    const index = cursor++
    const old = slots[index]
    if (deps !== undefined && old?.deps?.every((value, at) => value === deps[at])) return
    old?.cleanup?.()
    slots[index] = { deps }
    effects.push(() => { slots[index].cleanup = effect() })
  }
  const styles = new Map()
  const card = { style: { setProperty: (name, value) => styles.set(name, value), removeProperty: name => styles.delete(name) } }
  const button = { closest: () => card }
  const calls = []
  const roster = { byId: { chief: { id: 'chief' } }, prefs }
  const input = { phase: 'plain', draft: '', attachmentIds: [], queue: [{ id: 'u1', source: { kind: 'user' } }] }
  const actions = { canReferenceChat: () => false, steerQueued: async id => { calls.push(id) } }
  const draw = next => {
    if (next !== undefined) roster.prefs = next
    cursor = 0
    effects.length = 0
    const tree = ComposerPlus({ sessionId: 'chief', useRoster: pick => pick(roster), useInput: pick => pick(input), actions })
    tree.children.find(node => node?.props?.className === 'bt-plus').props.ref.current = button
    for (const effect of effects) effect()
  }
  const key = (over = {}, { composing = false } = {}) => {
    const target = { ownerDocument: { querySelector: () => null }, closest: selector => selector === '[data-composer-card]' ? card : selector === '[contenteditable=true]' ? target : selector === '[data-composer-composing]' && composing ? target : null }
    const event = { key: 'Enter', target, prevented: false, preventDefault() { this.prevented = true }, stopPropagation() {}, ...over }
    for (const listener of listeners.get('keydown') ?? []) listener(event)
    return event
  }
  t.after(() => { for (const slot of slots) slot?.cleanup?.(); listeners.clear(); Object.assign(react, original) })
  draw()
  return { draw, key, calls, styles }
}

test('disabled Enter sending leaves queued messages alone and toggling on takes effect immediately', async (t) => {
  const composer = mountComposer(t, { enterToSend: false })
  assert.equal(composer.styles.has('--bt-placeholder'), false)
  assert.equal(composer.key().prevented, false)
  assert.deepEqual(composer.calls, [])

  composer.draw({ enterToSend: true })
  assert.match(composer.styles.get('--bt-placeholder'), /Press Enter to steer queued messages/)
  assert.equal(composer.key().prevented, true)
  assert.deepEqual(composer.calls, ['chief'])
  await Promise.resolve()

  composer.draw({ enterToSend: false })
  assert.equal(composer.styles.has('--bt-placeholder'), false)
  assert.equal(composer.key().prevented, false)
  assert.deepEqual(composer.calls, ['chief'])
})

test('default Enter steering still ignores IME confirmation and an active composition', (t) => {
  const composer = mountComposer(t, {})
  for (const over of [{ isComposing: true }, { keyCode: 229 }]) {
    assert.equal(composer.key(over).prevented, false)
  }
  assert.equal(composer.key({}, { composing: true }).prevented, false)
  assert.deepEqual(composer.calls, [])
  assert.equal(composer.key().prevented, true)
  assert.deepEqual(composer.calls, ['chief'])
})
