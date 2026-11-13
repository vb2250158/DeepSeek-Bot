import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { install } from '../src/host/chat-index.js'
import { fakeContext } from './fake-ctx.js'

function start(t) {
  const home = mkdtempSync(join(tmpdir(), 'dsbot-index-lifetime-'))
  const ctx = fakeContext()
  const rt = { ctx, home, partsOf: () => [], warn() {}, clock: () => '' }
  install(rt)
  t.after(async () => {
    const disposed = await ctx.dispose()
    assert.ok(disposed.every(result => result.status === 'fulfilled'))
    await rm(home, { recursive: true, force: true, maxRetries: 5 })
  })
  return { home, ctx, rt }
}

test('a late group brief cannot open the chat index after its owner unloads', async t => {
  const { home, ctx, rt } = start(t)
  await ctx.dispose()
  assert.deepEqual(await rt.latestOwnChat('synthetic-bot'), [])
  assert.equal(existsSync(join(home, 'chat-index.sqlite')), false)
})

test('unload waits for an opening index and closes it before releasing its Home', async t => {
  const { home, ctx, rt } = start(t)
  const opening = rt.latestOwnChat('synthetic-bot')
  const disposed = await ctx.dispose()
  assert.ok(disposed.every(result => result.status === 'fulfilled'))
  await opening
  await rm(home, { recursive: true, force: true, maxRetries: 5 })
  assert.equal(existsSync(home), false)
})
