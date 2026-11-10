import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'

function start(saved) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-pins-'))
  if (saved !== undefined) writeFileSync(join(home, 'state.json'), JSON.stringify(saved))
  const ctx = fakeContext()
  let sessions = 0
  Object.assign(ctx, {
    workspaceRegistry: {
      resolveByPath: async () => undefined,
      create: async path => ({ id: 'w1', path }),
      archiveSession: async () => {},
    },
    sessionController: {
      create: async () => ({ sessionId: `s${++sessions}` }),
      resolveAgent: async sessionId => ({ agent: { id: sessionId, session: { id: sessionId }, followup() {} } }),
      selectModel: async () => {},
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => {
    if (options.path === '/api/bot') route = options
    return register(options)
  }
  createRuntime(ctx, { home })
  const call = async (endpoint, payload) => {
    const response = await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))
    return response.json()
  }
  const stop = async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  }
  return { call, stop }
}

const baseTeam = () => ({
  version: 1,
  mainBotIds: ['chief'],
  bots: {
    chief: { id: 'chief', sessionId: 'chief', name: 'Chief', role: 'Lead', instructions: '', createdAt: 1 },
    writer: { id: 'writer', sessionId: 'writer', name: 'Writer', role: 'Copy', instructions: '', createdAt: 2 },
    editor: { id: 'editor', sessionId: 'editor', name: 'Editor', role: 'Video', instructions: '', createdAt: 3 },
  },
  rooms: {
    r1: { id: 'r1', sessionId: 'r1', name: 'Video Room', named: true, members: ['chief', 'writer', 'editor'], admin: 'chief', mode: 'admin', notice: '', createdAt: 4 },
  },
})

test('pin-order stores the slot a tile was dropped into, across bots, rooms and agents', async (t) => {
  const { call, stop } = start(baseTeam())
  t.after(stop)

  await call('set-flags', { id: 'chief', pinned: true })
  await call('set-flags', { id: 'writer', pinned: true })
  await call('set-flags', { id: 'r1', pinned: true })

  let state = (await call('state', {})).value
  assert.deepEqual(state.bots.filter(b => b.pinned).map(b => b.pinOrder), [undefined, undefined])
  assert.equal(state.rooms.find(r => r.id === 'r1').pinOrder, undefined)

  const reordered = await call('pin-order', { ids: ['r1', 'writer', 'chief'] })
  assert.equal(reordered.ok, true)

  state = (await call('state', {})).value
  const slotOf = id => [...state.bots, ...state.rooms].find(entry => entry.id === id).pinOrder
  assert.deepEqual([slotOf('r1'), slotOf('writer'), slotOf('chief')], [0, 1, 2])

  // Only pinned conversations take a slot; anything else in the list is ignored.
  await call('pin-order', { ids: ['editor', 'chief', 'missing', 'chief'] })
  state = (await call('state', {})).value
  const editor = state.bots.find(b => b.id === 'editor')
  assert.equal(editor.pinned, undefined)
  assert.equal(editor.pinOrder, undefined)
  assert.equal(state.bots.find(b => b.id === 'chief').pinOrder, 0)
})

test('pin-order rejects a payload that is not an id list', async (t) => {
  const { call, stop } = start(baseTeam())
  t.after(stop)

  await call('set-flags', { id: 'chief', pinned: true })
  const bad = await call('pin-order', { ids: 'chief' })
  assert.equal(bad.ok, false)
})

test('unpinning clears the slot, so pinning again returns as the newest pin', async (t) => {
  const { call, stop } = start(baseTeam())
  t.after(stop)

  await call('set-flags', { id: 'chief', pinned: true })
  await call('set-flags', { id: 'writer', pinned: true })
  await call('pin-order', { ids: ['writer', 'chief'] })

  let state = (await call('state', {})).value
  assert.equal(state.bots.find(b => b.id === 'chief').pinOrder, 1)

  await call('set-flags', { id: 'chief', pinned: false })
  state = (await call('state', {})).value
  const chief = state.bots.find(b => b.id === 'chief')
  assert.equal(chief.pinned, false)
  assert.equal(chief.pinOrder, undefined)
  assert.equal(chief.pinnedAt, undefined)

  await call('set-flags', { id: 'chief', pinned: true })
  state = (await call('state', {})).value
  const again = state.bots.find(b => b.id === 'chief')
  assert.equal(again.pinOrder, undefined)
  assert.equal(typeof again.pinnedAt, 'number')
})
