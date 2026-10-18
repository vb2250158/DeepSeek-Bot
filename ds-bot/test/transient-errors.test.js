import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/client/transient-errors.js', import.meta.url))], bundle: true, format: 'cjs', platform: 'node', write: false, external: ['react'] })
const module = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, performance: { timeOrigin: 100 }, require: () => ({ createElement: (type, props) => ({ type, props }) }) })
const { installTransientErrors, isCurrentPageFailure } = module.exports

function registry() {
  const entries = new Map(), listeners = new Map()
  const publish = name => queueMicrotask(() => { for (const listener of listeners.get(name) ?? []) listener() })
  return {
    entries: name => entries.get(name) ?? [],
    register(options, component) {
      const entry = { options, component, locale: options.locale, inject: options.inject }
      entries.set(options.name, [...(entries.get(options.name) ?? []), entry].sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0)))
      publish(options.name)
      return () => { entries.set(options.name, entries.get(options.name).filter(item => item !== entry)); publish(options.name) }
    },
    subscribe(name, fn) {
      const current = listeners.get(name) ?? new Set()
      listeners.set(name, current); current.add(fn)
      return () => current.delete(fn)
    },
    listeners: () => [...listeners.values()].reduce((sum, value) => sum + value.size, 0),
  }
}
const NODE = 'conversation.chat.node', TAIL = 'conversation.chat.turnTail'
const tailProps = (time, kind = 'error') => ({ turn: { end: { time, data: { reason: { kind } } } } })
const flush = () => new Promise(resolve => setImmediate(resolve))

test('historical failure rows disappear on refresh while new failures retain the original localized renderer', async () => {
  const slots = registry()
  slots.register({ name: NODE, key: 'turn-error', locale: 'chat' }, 'NativeError')
  const dispose = installTransientErrors(slots)
  await flush()
  const entry = slots.entries(NODE)[0]
  assert.equal(entry.locale, 'chat')
  assert.equal(entry.component({ node: { data: { time: 99 } } }), null)
  const props = { node: { data: { time: 101, message: 'new failure' } } }
  assert.equal(entry.component(props).type, 'NativeError')
  assert.equal(entry.component(props).props, props)
  dispose()
  assert.equal(slots.entries(NODE).length, 1)
  assert.equal(slots.listeners(), 0)
})

test('manual continuation buttons never appear for failed or interrupted Bot turns', async () => {
  const slots = registry(), inject = () => ({ continueTurn() {} })
  slots.register({ name: TAIL, id: 'turn-continuation', priority: 20, inject }, 'RetryAction')
  const dispose = installTransientErrors(slots)
  await flush()
  const entry = slots.entries(TAIL)[0]
  assert.equal(entry.inject, inject)
  assert.equal(entry.component(tailProps(99)), null)
  assert.equal(entry.component(tailProps(100)), null)
  assert.equal(entry.component(tailProps(50, 'interrupted')), null)
  assert.equal(entry.component(tailProps(101, 'interrupted')), null)
  slots.register({ name: TAIL, id: 'deliverables', priority: 30 }, 'Files')
  await flush()
  assert.equal(slots.entries(TAIL).find(item => item.options.id === 'deliverables').component, 'Files')
  dispose()
})

test('late plugin registration and replacement are followed and teardown restores the installed renderer', async () => {
  const slots = registry(), dispose = installTransientErrors(slots)
  const remove = slots.register({ name: NODE, key: 'turn-error' }, 'FirstError')
  await flush()
  assert.equal(slots.entries(NODE)[0].component({ node: { data: { time: 101 } } }).type, 'FirstError')
  remove()
  slots.register({ name: NODE, key: 'turn-error' }, 'ReplacementError')
  await flush()
  assert.equal(slots.entries(NODE)[0].component({ node: { data: { time: 101 } } }).type, 'ReplacementError')
  dispose()
  assert.equal(slots.entries(NODE).length, 1)
  assert.equal(slots.entries(NODE)[0].component, 'ReplacementError')
})

test('navigation time stays fixed across conversation switches and undated failures stay visible', () => {
  assert.equal(isCurrentPageFailure(99), false)
  assert.equal(isCurrentPageFailure(100), true)
  assert.equal(isCurrentPageFailure(undefined), true)
  assert.equal(isCurrentPageFailure(101, 102), false)
})
