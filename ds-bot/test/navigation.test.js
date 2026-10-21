import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSessionNavigator } from '../src/client/navigation.js'

test('a known host session opens without refreshing or changing its identity', async () => {
  const opened = []
  const navigate = createSessionNavigator({
    sessions: { list: { getSnapshot: () => ({ byId: { original: {} } }) }, refresh: () => assert.fail('unnecessary refresh') },
    openSession: id => opened.push(id), onError: error => { throw error },
  })
  await navigate('original')
  assert.deepEqual(opened, ['original'])
})

test('a paged host resolves only the selected session instead of refreshing history', async () => {
  const calls = []
  const navigate = createSessionNavigator({
    sessions: {
      list: { getSnapshot: () => ({ phase: 'pending', byId: {} }) },
      ensureListed: async id => { calls.push(['lookup', id]); return true },
      refresh: () => assert.fail('unnecessary full refresh'),
    },
    openSession: id => calls.push(['open', id]), onError: error => { throw error },
  })
  await navigate('original')
  assert.deepEqual(calls, [['lookup', 'original'], ['open', 'original']])
})

test('a new browser waits for the host catalog before retaining its exact session', async () => {
  const byId = {}
  const calls = []
  const navigate = createSessionNavigator({
    sessions: {
      list: { getSnapshot: () => ({ byId }) },
      refresh: async () => { calls.push('refresh'); byId.original = {} },
    },
    openSession: id => { assert.ok(byId[id]); calls.push(id) },
    onError: error => { throw error },
  })
  await navigate('original')
  assert.deepEqual(calls, ['refresh', 'original'])
})

test('a reconnect refreshes a pending catalog even when its old row remains visible', async () => {
  const calls = []
  const navigate = createSessionNavigator({
    sessions: { list: { getSnapshot: () => ({ phase: 'pending', byId: { original: {} } }) }, refresh: async () => { calls.push('refresh') } },
    openSession: id => calls.push(id), onError: error => { throw error },
  })
  await navigate('original')
  assert.deepEqual(calls, ['refresh', 'original'])
})

test('a slower catalog refresh cannot replace the user latest selection', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const opened = []
  const navigate = createSessionNavigator({
    sessions: { list: { getSnapshot: () => ({ byId: { latest: {} } }) }, refresh: () => pending },
    openSession: id => opened.push(id), onError: error => { throw error },
  })
  const earlier = navigate('earlier')
  await navigate('latest')
  release()
  await earlier
  assert.deepEqual(opened, ['latest'])
})

test('an unavailable host reports the error and never opens a substitute session', async () => {
  const offline = new Error('offline')
  const errors = []
  const navigate = createSessionNavigator({
    sessions: { list: { getSnapshot: () => ({ byId: {} }) }, refresh: async () => { throw offline } },
    openSession: () => assert.fail('host is unavailable'), onError: error => errors.push(error),
  })
  await navigate('original')
  assert.deepEqual(errors, [offline])
})

test('a session absent from a refreshed host catalog retains the native refusal', async () => {
  const missing = new Error('unknown session original')
  const errors = []
  const navigate = createSessionNavigator({
    sessions: { list: { getSnapshot: () => ({ byId: {} }) }, refresh: async () => {} },
    openSession: id => { assert.equal(id, 'original'); throw missing }, onError: error => errors.push(error),
  })
  await navigate('original')
  assert.deepEqual(errors, [missing])
})
