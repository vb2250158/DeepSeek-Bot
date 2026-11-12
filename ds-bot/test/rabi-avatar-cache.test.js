import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { test } from 'node:test'
import { createRabiAvatarCache } from '../src/host/rabi-avatar-cache.js'

test('a cancelled cold avatar viewer settles while another viewer keeps the shared fetch', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsbot-avatar-cancel-'))
  const shutdown = new AbortController()
  const caller = new AbortController()
  const started = Promise.withResolvers()
  const remote = Promise.withResolvers()
  const image = { bytes: Buffer.from('avatar fixture'), contentType: 'image/png' }
  let requests = 0
  let remoteSignal
  const cache = createRabiAvatarCache({ home, signal: shutdown.signal, fetchImage: async (_roleId, signal) => {
    requests++
    remoteSignal = signal
    started.resolve()
    return remote.promise
  } })
  const first = cache.get('fixture', caller.signal)
  const firstOutcome = first.then(value => ({ kind: 'resolved', value }), error => ({ kind: 'rejected', error }))
  const second = cache.get('fixture')
  try {
    await started.promise
    caller.abort()
    await setImmediate()
    const outcome = await Promise.race([firstOutcome, Promise.resolve({ kind: 'pending' })])
    assert.equal(outcome.kind, 'rejected', 'the viewer must leave before the remote request finishes')
    assert.equal(outcome.error.name, 'AbortError')
    assert.equal(getEventListeners(caller.signal, 'abort').length, 0)
    assert.equal(remoteSignal.aborted, false)
    assert.equal(requests, 1)
    remote.resolve(image)
    assert.deepEqual(await second, image)
    assert.equal(requests, 1)
  } finally {
    remote.resolve(image)
    await Promise.allSettled([first, second])
    shutdown.abort()
    await cache.dispose()
    await rm(home, { recursive: true, force: true })
  }
})
