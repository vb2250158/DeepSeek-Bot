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
  const rt = { dshHome: home, state: { workspaceId: 'workspace', bots: { bot }, rooms: { room: { id: 'room' } } }, ctx: { effect(execute) { const dispose = execute(); disposers.push(dispose); return dispose }, sessions: { flush: async () => true } }, load: async () => {}, readOnly: () => undefined,
    botOf: id => id === bot.id ? bot : undefined, chatOf: () => bot.sessionId,
    ensureCapabilities: async () => {},
    resolveAgent: async id => {
      if (!logs.has(id)) throw new Error('missing')
      return {
        session: { inheritedEventCount: 0, snapshotEvents: () => logs.get(id) },
        followup(message) {
          const idLine = /^schedule_id_json: (.*)$/m.exec(message.content[0].text)
          calls.push({ sessionId: id, requestId: JSON.parse(idLine[1]) })
          logs.get(id).push({
            seq: logs.get(id).length,
            type: 'agent/inbox/spliced',
            data: { inserted: [message] },
          })
        },
      }
    },
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
  assert.equal(f.calls[0].sessionId, 'part2')
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
  f.rt.ensureCapabilities = async () => { f.calls.push('failed'); throw new Error('unknown') }
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
  f.rt.ctx.sessions.flush = async () => true
  assert.equal((await f.call('reconcile')).state, 'accepted')
  assert.equal(f.calls.length, 1)
})


test('disposal closes native admission and waits for a deferred delivery before replacement', async t => {
  const f = await fixture(t)
  const entered = Promise.withResolvers(), release = Promise.withResolvers()
  const prepare = f.rt.ensureCapabilities
  f.rt.ensureCapabilities = async id => { entered.resolve(); await release.promise; return prepare(id) }
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


test('Rabi reminders enter with native schedule source and public reminder framing', async t => {
  const f = await fixture(t)
  await f.call('deliver')
  const message = f.logs.get('part2')[0].data.inserted[0]
  assert.deepEqual(message.source, { kind: 'schedule' })
  assert.match(message.content[0].text, /^\[SCHEDULE REMINDER\]/)
  assert.match(message.content[0].text, /schedule_id_json: "delivery"/)
  assert.match(message.content[0].text, /reminder_prompt_json: "Check the report"/)
})


test('schedule framing retains escaped IDs, original prompts and supplied occurrence time', async t => {
  const f = await fixture(t)
  const body = { ...f.body, deliveryId: 'id:"quoted"\\path', message: 'Line one\nLine "two"', scheduledAt: '2030-01-01T09:30:00.000Z' }
  assert.equal((await f.call('deliver', body)).state, 'accepted')
  const text = f.logs.get('part2')[0].data.inserted[0].content[0].text
  assert.match(text, /occurrence_at: 2030-01-01T09:30:00.000Z/)
  assert.equal((await f.call('reconcile', body)).state, 'accepted')
  assert.equal((await f.call('reconcile', { ...body, message: 'Other' })).state, 'conflict')
  for (const scheduledAt of ['bad', '2030-02-30T09:30:00Z', '2030-01-01T09:30:00+08:00', 1]) await assert.rejects(f.call('deliver', { ...body, scheduledAt }), { code: 'bot/rabi-validation' })
})

test('old user receipts reconcile without another reminder and false flush remains uncertain', async t => {
  const f = await fixture(t)
  f.logs.get('bot').push({ seq: 0, type: 'agent/inbox/spliced', data: { inserted: [{ source: { kind: 'user', rpcId: f.body.deliveryId }, content: [{ type: 'text', text: f.body.message }] }] } })
  const timedBody = { ...f.body, scheduledAt: '2020-01-01T09:30:00.000Z' }
  assert.equal((await f.call('reconcile', timedBody)).state, 'accepted')
  assert.equal((await f.call('deliver', timedBody)).state, 'accepted')
  assert.equal(f.calls.length, 0)
  f.rt.ctx.sessions.flush = async () => false
  assert.equal((await f.call('reconcile')).state, 'uncertain')
  const fresh = await fixture(t)
  fresh.rt.ctx.sessions.flush = async () => false
  assert.equal((await fresh.call('deliver')).state, 'uncertain')
  assert.equal((await fresh.call('reconcile')).state, 'uncertain')
  assert.equal(fresh.calls.length, 1)
})

test('broken schedule JSON cannot acknowledge or repeat an unknown reminder', async t => {
  const f = await fixture(t)
  f.logs.get('part2').push({ seq: 0, type: 'agent/inbox/spliced', data: { inserted: [{ source: { kind: 'schedule' }, content: [{ type: 'text', text: '[SCHEDULE REMINDER]\nschedule_id_json: broken\nreminder_prompt_json: "Check"' }] }] } })
  assert.equal((await f.call('deliver')).state, 'uncertain')
  assert.equal(f.calls.length, 0)
})


test('native admission-time receipts accept a later request carrying the original earlier occurrence', async t => {
  const f = await fixture(t)
  await f.call('deliver')
  const originalCalls = f.calls.length
  const timedBody = { ...f.body, scheduledAt: '2020-01-01T09:30:00.000Z' }
  assert.equal((await f.call('reconcile', timedBody)).state, 'accepted')
  assert.equal((await f.call('deliver', timedBody)).state, 'accepted')
  assert.equal(f.calls.length, originalCalls)
})
