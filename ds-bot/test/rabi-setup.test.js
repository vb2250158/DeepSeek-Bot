import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { install, RABI_REPOSITORY } from '../src/host/rabi-setup.js'

function fixture(initial = 'stopped') {
  let lifecycle = initial, inspected = 0, started = 0, catalogs = 0
  const sent = [], warnings = []
  const controller = { inspect: async () => { inspected++; return { state: lifecycle, installed: lifecycle !== 'not-found', canStart: lifecycle === 'stopped' } }, start: async () => { started++; return { state: 'starting', installed: true, canStart: false, launchAccepted: true } } }
  const services = { rabiHost: controller, rabiAgentHooks: { requireBinding() {} } }
  const bots = { chief: { id: 'chief', model: 'mock/model' }, second: { id: 'second', model: 'mock/model' } }
  const rt = { state: { mainBotIds: ['chief', 'second'] }, load: async () => {}, warn: (...args) => warnings.push(args), botOf: id => bots[id], chatOf: id => `${id}-current`, ensureCapabilities: async () => {},
    rabiPersonaEndpoint: async () => { catalogs++; return { connected: true, personas: [{ id: 'fixture', name: 'Fixture' }] } },
    ctx: { get: key => services[key], tools: { get: () => ({}) }, sessionController: { prompt: async request => { sent.push(request) } } },
  }
  install(rt)
  return { rt, services, bots, sent, warnings, call: (endpoint, body) => rt.rabiSetupEndpoint(endpoint, body), setState: value => { lifecycle = value }, counts: () => ({ inspected, started, catalogs }) }
}

test('opening setup distinguishes a stopped Host without starting it or reading personas', async () => {
  const f = fixture()
  const status = await f.call('rabi-connection-status')
  assert.equal(status.state, 'stopped'); assert.equal(status.canStart, true); assert.equal(status.repositoryUrl, RABI_REPOSITORY)
  assert.deepEqual(f.counts(), { inspected: 1, started: 0, catalogs: 0 })
})

test('starting remains an explicit action and connecting is an explicit later retry', async () => {
  const f = fixture()
  assert.equal((await f.call('rabi-start')).state, 'starting')
  assert.equal(f.counts().catalogs, 0)
  assert.equal((await f.call('rabi-connect')).connected, false)
  f.setState('ready')
  assert.equal((await f.call('rabi-connect')).connected, true)
  assert.equal(f.counts().catalogs, 1)
})

test('missing and outdated adapters are reported as setup states instead of protocol errors', async () => {
  const f = fixture('not-found')
  assert.equal((await f.call('rabi-connection-status')).state, 'not-found')
  delete f.services.rabiHost
  assert.equal((await f.call('rabi-connection-status')).state, 'adapter-update')
  f.rt.ctx.tools.get = () => undefined
  assert.equal((await f.call('rabi-connection-status')).state, 'adapter-missing')
})

test('a Host stopping during connection is re-inspected without returning the raw transport exception', async () => {
  const f = fixture('ready')
  f.rt.rabiPersonaEndpoint = async () => { f.setState('stopped'); throw Error('private transport diagnostic') }
  const result = await f.call('rabi-connect')
  assert.equal(result.state, 'stopped'); assert.equal(result.connectionIssue, true)
  assert.ok(!JSON.stringify(result).includes('private transport diagnostic'))
  assert.equal(f.warnings.length, 1)
})

test('setup requests go once to the selected existing Bot and ask preferences before installation', async () => {
  const f = fixture('not-found'), requestId = randomUUID()
  const first = await f.call('rabi-install-request', { botId: 'second', requestId, locale: 'zh' })
  assert.deepEqual(await f.call('rabi-install-request', { botId: 'second', requestId, locale: 'zh' }), first)
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].sessionId, 'second-current'); assert.equal(f.sent[0].mode, 'queue')
  const text = f.sent[0].content[0].text
  for (const phrase of [RABI_REPOSITORY, 'ask me which installation directory', 'which persona', 'Wait for my answers', 'Chinese']) assert.ok(text.includes(phrase), phrase)
  assert.equal(f.counts().started, 0)
})

test('an unknown target uses the existing landing Bot and missing model selection is actionable', async () => {
  const f = fixture('not-found')
  await f.call('rabi-install-request', { botId: 'ordinary', requestId: randomUUID() })
  assert.equal(f.sent[0].sessionId, 'chief-current')
  delete f.bots.chief.model
  await assert.rejects(f.call('rabi-install-request', { requestId: randomUUID() }), { code: 'bot/rabi-setup-model' })
  assert.equal(f.sent.length, 1)
})
