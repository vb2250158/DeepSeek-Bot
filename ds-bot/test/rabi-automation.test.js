import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { install } from '../src/host/rabi-automation.js'

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'ds-bot-automation-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const bot = { id: 'bot', name: 'Personal', sessionId: 'part2', segments: [{ sessionId: 'bot' }] }
  const logs = new Map([['bot', []], ['part2', []]])
  const calls = [], disposers = []
  const rt = { dshHome: home, state: { workspaceId: 'workspace', bots: { bot }, rooms: { room: { id: 'room' } } }, ctx: { effect(execute) { const dispose = execute(); disposers.push(dispose); return dispose }, sessions: { flush: async () => {} } }, load: async () => {}, readOnly: () => undefined,
    botOf: id => id === bot.id ? bot : undefined, chatOf: () => bot.sessionId,
    resolveAgent: async id => { if (!logs.has(id)) throw new Error('missing'); return { session: { inheritedEventCount: 0, snapshotEvents: () => logs.get(id) } } },
    sendUser: async request => {
      calls.push(request)
      const sessionId = bot.sessionId
      logs.get(sessionId).push({ seq: logs.get(sessionId).length, type: 'agent/inbox/spliced', data: { inserted: [{ source: { kind: 'user', rpcId: request.requestId }, content: request.content }] } })
      return { sessionId, requestId: request.requestId }
    },
  }
  install(rt)
  const catalog = await rt.rabiAutomationEndpoint('rabi-automation-catalog', { schemaVersion: 1 })
  const body = { schemaVersion: 1, botScopeId: catalog.botScopeId, botId: 'bot', deliveryId: 'delivery', message: 'Check the report' }
  return { rt, bot, logs, calls, disposers, catalog, body, call: (op, payload = body) => rt.rabiAutomationEndpoint(`rabi-automation-${op}`, payload) }
}

test('native catalog identifies this workspace and personal Bots without groups or a primary role', async t => {
  const f = await fixture(t)
  assert.match(f.catalog.botScopeId, /^[a-f0-9]{64}$/)
  assert.deepEqual(f.catalog.bots, [{ botId: 'bot', botName: 'Personal' }])
  assert.equal((await f.call('catalog', { schemaVersion: 1 })).botScopeId, f.catalog.botScopeId)
  const before = f.catalog.runtimeId
  install(f.rt)
  const next = await f.call('catalog', { schemaVersion: 1 })
  assert.equal(next.botScopeId, f.catalog.botScopeId)
  assert.notEqual(next.runtimeId, before)
})

test('delivery follows stable Bot identity and reconciles the original receipt after rollover', async t => {
  const f = await fixture(t)
  assert.equal((await f.call('reconcile')).state, 'not_found')
  const accepted = await f.call('deliver')
  assert.equal(accepted.state, 'accepted')
  assert.equal(accepted.sessionId, 'part2')
  assert.equal(accepted.requestId, f.body.deliveryId)
  assert.equal(f.calls[0].sessionId, 'bot')
  f.bot.segments.push({ sessionId: 'part2' }); f.bot.sessionId = 'part3'; f.logs.set('part3', [])
  assert.deepEqual(await f.call('deliver'), accepted)
  assert.deepEqual(await f.call('reconcile'), accepted)
  assert.equal(f.calls.length, 1)
  assert.equal((await f.call('deliver', { ...f.body, message: 'Different' })).state, 'conflict')
  assert.equal(f.calls.length, 1)
})

test('native delivery rejects other workspace, groups, and malformed requests before sending', async t => {
  const f = await fixture(t)
  for (const change of [{ schemaVersion: 2 }, { botScopeId: 'other' }, { botId: 'room' }, { deliveryId: '' }, { message: '' }]) await assert.rejects(f.call('deliver', { ...f.body, ...change }), { code: 'bot/rabi-validation' })
  assert.equal(f.calls.length, 0)
})

test('unreadable historical parts and uncertain sends never trigger an automatic replay', async t => {
  const f = await fixture(t)
  f.logs.delete('bot')
  assert.equal((await f.call('deliver')).state, 'uncertain')
  assert.equal(f.calls.length, 0)
  f.logs.set('bot', [])
  f.rt.sendUser = async () => { f.calls.push('failed'); throw new Error('unknown') }
  assert.equal((await f.call('deliver')).state, 'uncertain')
  assert.equal((await f.call('reconcile')).state, 'uncertain')
  assert.equal((await f.call('deliver')).state, 'uncertain')
  assert.equal(f.calls.length, 1)
})

test('concurrent repeated delivery admits one native prompt', async t => {
  const f = await fixture(t)
  const results = await Promise.all([f.call('deliver'), f.call('deliver')])
  assert.equal(results[0].state, 'accepted')
  assert.deepEqual(results[0], results[1])
  assert.equal(f.calls.length, 1)
})


test('different Home and workspace identities have different opaque Bot scopes', async t => {
  const left = await fixture(t), right = await fixture(t)
  assert.notEqual(left.catalog.botScopeId, right.catalog.botScopeId)
  const original = left.rt.rabiAutomationIdentity().botScopeId
  left.rt.state.workspaceId = 'another-workspace'
  assert.notEqual(left.rt.rabiAutomationIdentity().botScopeId, original)
})

test('an accepted queue whose durable flush fails stays uncertain without another prompt', async t => {
  const f = await fixture(t)
  f.rt.ctx.sessions.flush = async () => { throw new Error('disk unavailable') }
  assert.equal((await f.call('deliver')).state, 'uncertain')
  assert.equal((await f.call('reconcile')).state, 'uncertain')
  assert.equal(f.calls.length, 1)
  f.rt.ctx.sessions.flush = async () => {}
  assert.equal((await f.call('reconcile')).state, 'accepted')
  assert.equal(f.calls.length, 1)
})


test('disposal closes native admission and waits for a deferred delivery before replacement', async t => {
  const f = await fixture(t)
  const entered = Promise.withResolvers(), release = Promise.withResolvers()
  const send = f.rt.sendUser
  f.rt.sendUser = async request => { entered.resolve(); await release.promise; return send(request) }
  const oldEndpoint = f.rt.rabiAutomationEndpoint
  const delivery = f.call('deliver')
  await entered.promise
  let finished = false
  const cleanup = f.disposers.at(-1)().then(() => { finished = true })
  await Promise.resolve()
  assert.equal(finished, false)
  for (const endpoint of ['catalog', 'deliver', 'reconcile']) await assert.rejects(oldEndpoint(`rabi-automation-${endpoint}`, endpoint === 'catalog' ? { schemaVersion: 1 } : f.body), { code: 'bot/rabi-unavailable' })
  release.resolve()
  const accepted = await delivery
  assert.equal(accepted.state, 'accepted')
  await cleanup
  assert.equal(finished, true)
  install(f.rt)
  const reconciled = await f.call('deliver')
  assert.equal(reconciled.state, 'accepted')
  assert.equal(reconciled.sessionId, accepted.sessionId)
  assert.equal(reconciled.requestId, accepted.requestId)
  assert.equal(f.calls.length, 1)
})

test('disposal includes callers still loading and a failed reconciliation flush', async t => {
  const f = await fixture(t)
  const loading = Promise.withResolvers()
  f.rt.load = () => loading.promise
  const catalog = f.call('catalog', { schemaVersion: 1 })
  let finished = false
  const cleanup = f.disposers.at(-1)().then(() => { finished = true })
  await Promise.resolve()
  assert.equal(finished, false)
  loading.resolve()
  await catalog; await cleanup
  f.rt.load = async () => {}
  install(f.rt)
  await f.call('deliver')
  const flushing = Promise.withResolvers(), entered = Promise.withResolvers()
  f.rt.ctx.sessions.flush = async () => { entered.resolve(); await flushing.promise; throw new Error('flush failed') }
  const reconciliation = f.call('reconcile')
  await entered.promise
  finished = false
  const secondCleanup = f.disposers.at(-1)().then(() => { finished = true })
  await Promise.resolve()
  assert.equal(finished, false)
  flushing.resolve()
  assert.equal((await reconciliation).state, 'uncertain')
  await secondCleanup
  assert.equal(finished, true)
  assert.equal(f.calls.length, 1)
})


test('long Unicode-role automation IDs enter the native queue unchanged and reconcile without duplicate delivery', async t => {
  const f = await fixture(t)
  const roleId = '合法角色'.repeat(40)
  const deliveryId = `automation:${Buffer.from(roleId).toString('base64url')}:daily-rule:${'a'.repeat(64)}`
  assert.ok(deliveryId.length > 200)
  const body = { ...f.body, deliveryId }
  const accepted = await f.call('deliver', body)
  assert.equal(accepted.state, 'accepted')
  assert.equal(accepted.requestId, deliveryId)
  assert.equal(f.calls[0].requestId, deliveryId)
  assert.deepEqual(await f.call('reconcile', body), accepted)
  assert.deepEqual(await f.call('deliver', body), accepted)
  assert.equal(f.calls.length, 1)
})
