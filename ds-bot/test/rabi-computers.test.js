import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { install } from '../src/host/rabi-computers.js'

function fixture({ enabled, installed = true, response, legacy = false } = {}) {
  const requests = [], guards = [], listeners = new Map(), sections = []
  const state = { prefs: { ...(enabled === undefined ? {} : { rabiRemoteControl: enabled }), rabiComputers: legacy } }
  const rt = { state, load: async () => {}, isBotSession: id => ['bot', 'group-part'].includes(id), ctx: {
    on: (name, listener) => listeners.set(name, listener), effect: fn => fn(),
    systemPrompt: { section: value => sections.push(value) },
    tools: {
      guard: fn => guards.push(fn),
      get: name => installed && name === 'rabiroute_manager_api' ? {} : undefined,
      async execute(input) {
        requests.push(input)
        assert.equal(input.name, 'rabiroute_manager_api')
        assert.ok(input.signal instanceof AbortSignal)
        const args = input.arguments
        const value = args.path === '/meta' ? { managerBaseUrl: 'http://127.0.0.1:47831' }
          : args.path === '/api/webgui-access' ? { data: { token: 'fixture-access' } }
          : response ? response(args) : { instances: [] }
        return { isError: false, value: { ok: true, statusCode: 200, body: JSON.stringify(value) } }
      },
    },
  } }
  install(rt)
  return { rt, requests, sections, listeners, guard: exec => guards.map(fn => fn(exec)).find(Boolean) }
}
const remoteCall = (path = '/api/lan-agent/instances/node/terminals', id = 'bot') => ({ name: 'rabiroute_manager_api', arguments: { method: 'POST', path }, agent: { id } })

test('remote computers default on without a saved preference; the old panel preference has no authority', async () => {
  const { rt, requests } = fixture({ legacy: false })
  assert.deepEqual(await rt.rabiComputerEndpoint('rabi-computers-status'), { enabled: true, available: true })
  assert.equal(requests.length, 0)
  assert.deepEqual((await rt.rabiComputerEndpoint('rabi-computers-list')).computers, [])
})

test('the disabled team switch blocks every Bot and group part before a remote call', async () => {
  const f = fixture({ enabled: false })
  let loaded = false
  f.rt.load = async () => { loaded = true }
  const exec = remoteCall()
  await f.listeners.get('tools/pre-execute')(exec, async () => ({ kind: 'continue' }))
  assert.equal(loaded, true)
  assert.match(f.guard(exec), /disabled for all Bots/)
  assert.match(f.guard(remoteCall('/api/lan-agent/instances/node/terminals', 'group-part')), /disabled/)
  await assert.rejects(f.rt.rabiComputerEndpoint('rabi-computers-list'), /disabled/)
  assert.equal(f.requests.length, 0)
})

test('normalization applies the disabled switch to encoded paths and path traversal', () => {
  const f = fixture({ enabled: false })
  for (const path of ['/api/%6can-agent/instances', '/api/other/../lan-agent/instances?x=1', '/API/LAN-AGENT', '/api/lan-agent%2Finstances']) assert.match(f.guard(remoteCall(path)), /disabled/, path)
})

test('the switch does not change ordinary DSH sessions or unrelated Rabi operations and follows live changes', () => {
  const f = fixture({ enabled: false })
  assert.equal(f.guard(remoteCall('/api/lan-agent/instances', 'ordinary')), undefined)
  assert.equal(f.guard(remoteCall('/api/roles')), undefined)
  assert.equal(f.guard(remoteCall('/api/lan-agent-not-a-computer')), undefined)
  assert.equal(f.guard({ ...remoteCall(), name: 'shell' }), undefined)
  f.rt.state.prefs.rabiRemoteControl = true
  assert.equal(f.guard(remoteCall()), undefined)
  f.rt.state.prefs.rabiRemoteControl = false
  assert.match(f.guard(remoteCall()), /disabled/)
})

test('the model receives the team computer policy through its logged system prompt', () => {
  const f = fixture()
  const section = f.sections[0]
  assert.equal(section.text({ agent: { id: 'bot' } }), readFileSync(new URL('./fixtures/rabi-computer-context.txt', import.meta.url), 'utf8').trimEnd())
  assert.equal(section.text({ agent: { id: 'ordinary' } }), '')
  f.rt.state.prefs.rabiRemoteControl = false
  assert.match(section.text({ agent: { id: 'group-part' } }), /disabled for all Bots/)
})

test('computer settings return only remote summaries and a credential-free Rabi WebGUI link', async () => {
  const { rt, requests } = fixture({ response: () => ({ instances: [
    { instanceId: 'local', local: true, connected: true },
    { instanceId: 'node:one', name: 'Build computer', connected: true, platform: 'win32', local: false, agents: [{ private: 'omitted' }], token: 'omitted' },
  ] }) })
  const result = await rt.rabiComputerEndpoint('rabi-computers-list')
  assert.deepEqual(result.computers, [{ instanceId: 'node:one', name: 'Build computer', connected: true, platform: 'win32' }])
  assert.equal(result.managementUrl, 'http://127.0.0.1:47831/#/lan-agents')
  assert.ok(!JSON.stringify(result).includes('fixture-access'))
  assert.deepEqual(JSON.parse(requests[2].arguments.requestHeadersJson), { 'x-rabiroute-webgui-token': 'fixture-access' })
  assert.ok(requests.every(input => input.arguments.method === 'GET'))
})

test('the settings API cannot open, write or close remote terminals', async () => {
  const f = fixture()
  for (const endpoint of ['rabi-computer-terminal', 'rabi-computer-terminals', 'rabi-computer-output']) await assert.rejects(f.rt.rabiComputerEndpoint(endpoint, { action: 'close' }), /Unknown computer settings/)
  assert.equal(f.requests.length, 0)
})

test('missing Rabi adapter reports setup requirements without a replacement transport', async () => {
  const { rt, requests } = fixture({ installed: false })
  assert.equal((await rt.rabiComputerEndpoint('rabi-computers-status')).available, false)
  await assert.rejects(rt.rabiComputerEndpoint('rabi-computers-list'), /Install and configure/)
  assert.equal(requests.length, 0)
})

test('read-only catalog retains a visible failure when DSH refuses a Manager request', async () => {
  const { rt } = fixture()
  rt.ctx.tools.execute = async () => ({ isError: true, error: { message: 'Operation denied by policy' } })
  const result = await rt.rabiComputerEndpoint('rabi-computers-list')
  assert.match(result.error, /denied by policy/)
  assert.deepEqual(result.computers, [])
})

test('untrusted navigation addresses cannot obtain or expose Rabi access credentials', async () => {
  const { rt, requests } = fixture()
  rt.ctx.tools.execute = async input => { requests.push(input); return { isError: false, value: { ok: true, body: JSON.stringify({ managerBaseUrl: 'javascript:alert(1)' }) } } }
  const result = await rt.rabiComputerEndpoint('rabi-computers-list')
  assert.match(result.error, /address is unavailable/)
  assert.equal(requests.length, 1)
  assert.equal(result.managementUrl, '')
})

test('a computer catalog refusal preserves the management link so authorization can be fixed in Rabi', async () => {
  const f = fixture()
  const execute = f.rt.ctx.tools.execute
  f.rt.ctx.tools.execute = input => input.arguments.path === '/api/webgui-access'
    ? { isError: true, error: { message: 'Access denied' } } : execute(input)
  const result = await f.rt.rabiComputerEndpoint('rabi-computers-list')
  assert.match(result.error, /Access denied/)
  assert.equal(result.managementUrl, 'http://127.0.0.1:47831/#/lan-agents')
})
