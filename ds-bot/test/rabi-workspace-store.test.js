import assert from 'node:assert/strict'
import test from 'node:test'
import { createRabiWorkspaceStore } from '../src/client/rabi-workspace-store.js'

const scope = { botId: 'bot', roleId: 'fixture', resource: 'memory', kind: 'recent' }
const page = (ids, nextCursor = null) => ({ roleId: 'fixture', items: ids.map(id => ({ id })), nextCursor })
const deferred = () => { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail }); return { promise, resolve, reject } }

test('A to B to A shares the pending read and keeps the completed result after the observer leaves', async () => {
  const pending = deferred(), calls = []
  const store = createRabiWorkspaceStore((query, signal) => { calls.push({ query, signal }); return pending.promise })
  const leave = store.subscribe(scope, () => {})
  const first = store.visit(scope)
  leave()
  assert.equal(store.visit(scope), first)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].signal.aborted, false)
  pending.resolve(page(['one']))
  await first
  assert.deepEqual(store.snapshot(scope).value.items, [{ id: 'one' }])
  store.dispose()
})

test('revisiting keeps content during background refresh and retains it on failure', async () => {
  const pending = deferred()
  let count = 0
  const store = createRabiWorkspaceStore(() => ++count === 1 ? page(['saved']) : pending.promise)
  await store.visit(scope)
  const refresh = store.visit(scope)
  assert.equal(store.snapshot(scope).pending, true)
  assert.equal(store.snapshot(scope).value.items[0].id, 'saved')
  assert.equal(store.visit(scope), refresh)
  pending.reject(new Error('offline'))
  await refresh
  assert.equal(store.snapshot(scope).value.items[0].id, 'saved')
  assert.equal(store.snapshot(scope).error.message, 'offline')
  store.dispose()
})

test('pagination resumes without clearing earlier pages and a changed cursor discards stale continuation', async () => {
  const responses = [page(['one'], 'p2'), page(['two'], 'p3'), page(['one-new'], 'p2'), page(['new-range'], 'other')]
  const seen = []
  const store = createRabiWorkspaceStore(query => { seen.push(query.cursor); return responses.shift() })
  await store.visit(scope); await store.more(scope)
  assert.deepEqual(store.snapshot(scope).value.items.map(item => item.id), ['one', 'two'])
  await store.visit(scope)
  assert.deepEqual(store.snapshot(scope).value.items.map(item => item.id), ['one-new', 'two'])
  assert.equal(store.snapshot(scope).value.nextCursor, 'p3')
  await store.visit(scope)
  assert.deepEqual(store.snapshot(scope).value.items.map(item => item.id), ['new-range'])
  assert.deepEqual(seen, [undefined, 'p2', undefined, undefined])
  store.dispose()
})

test('different Bots and role bindings never share cached documents; invalidation drops late results', async () => {
  const pending = deferred()
  const store = createRabiWorkspaceStore(query => query.roleId === 'other' ? { ...page(['other']), roleId: 'other' } : pending.promise)
  const first = store.visit(scope)
  const other = { ...scope, roleId: 'other' }
  await store.visit(other)
  store.invalidateBot(scope.botId)
  pending.resolve(page(['stale'])); await first
  assert.equal(store.snapshot(scope).value, null)
  assert.equal(store.snapshot(other).value, null)
  assert.equal(store.snapshot({ ...scope, botId: 'second' }).value, null)
  store.dispose()
})

test('queued reads respect concurrency and disposal aborts the owner lifetime', async () => {
  const pending = deferred(), signals = []
  const store = createRabiWorkspaceStore((query, signal) => { signals.push(signal); return pending.promise }, { concurrency: 1 })
  const first = store.visit(scope)
  const second = store.visit({ ...scope, resource: 'plans' })
  assert.equal(signals.length, 1)
  store.dispose()
  assert.equal(signals[0].aborted, true)
  pending.resolve(page([]))
  await Promise.all([first, second])
  assert.equal(signals.length, 1)
})

test('a response for a changed persona cannot enter the previous persona cache', async () => {
  const store = createRabiWorkspaceStore(() => ({ ...page(['wrong']), roleId: 'other' }))
  await store.visit(scope)
  assert.equal(store.snapshot(scope).value, null)
  assert.match(store.snapshot(scope).error.message, /binding changed/)
  store.dispose()
})

test('least recently used inactive views are bounded and selection survives panel remounts', async () => {
  const store = createRabiWorkspaceStore(() => page(['cached']), { capacity: 1 })
  await store.visit(scope)
  store.select('bot', 'fixture', { resource: 'plans', query: { itemId: 'plan' } })
  assert.deepEqual(store.selection('bot', 'fixture'), { resource: 'plans', query: { itemId: 'plan' } })
  await store.visit({ ...scope, botId: 'other' })
  assert.equal(store.snapshot(scope).value, null)
  store.dispose()
})
