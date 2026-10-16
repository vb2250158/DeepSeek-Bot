import assert from 'node:assert/strict'
import { test } from 'node:test'
import { install } from '../src/host/rabi-computers.js'

function fixture({ enabled = true, installed = true, response } = {}) {
  const requests = []
  const state = { prefs: { rabiComputers: enabled } }
  const rt = { state, load: async () => {}, ctx: { tools: {
    get: name => installed && name === 'rabiroute_manager_api' ? {} : undefined,
    async execute(input) {
      requests.push(input)
      assert.equal(input.name, 'rabiroute_manager_api')
      assert.ok(input.signal instanceof AbortSignal)
      const args = input.arguments
      const value = args.path === '/api/webgui-access' ? { data: { token: 'fixture-access' } }
        : response ? response(args) : { code: 0, data: { shells: ['powershell'], sessions: [] } }
      return { isError: false, value: { ok: true, statusCode: 200, body: JSON.stringify(value) } }
    },
  } } }
  install(rt)
  return { rt, requests }
}

test('panel status does not discover or change Rabi while disabled', async () => {
  const { rt, requests } = fixture({ enabled: false })
  assert.deepEqual(await rt.rabiComputerEndpoint('rabi-computers-status'), { enabled: false, available: true })
  await assert.rejects(rt.rabiComputerEndpoint('rabi-computers-list'), /Enable/)
  assert.equal(requests.length, 0)
})

test('missing Rabi adapter reports setup requirements without a replacement transport', async () => {
  const { rt, requests } = fixture({ installed: false })
  assert.equal((await rt.rabiComputerEndpoint('rabi-computers-status')).available, false)
  await assert.rejects(rt.rabiComputerEndpoint('rabi-computers-list'), /Install and configure/)
  assert.equal(requests.length, 0)
})

test('computer catalog excludes access credentials and Agent configuration', async () => {
  const { rt, requests } = fixture({ response: () => ({ instances: [{ instanceId: 'node:one', name: 'Build computer', connected: true, local: false, agents: [{ private: 'omitted' }], token: 'omitted' }] }) })
  const result = await rt.rabiComputerEndpoint('rabi-computers-list')
  assert.equal(result.computers[0].instanceId, 'node:one')
  assert.equal(result.computers[0].agents, undefined)
  assert.ok(!JSON.stringify(result).includes('fixture-access'))
  assert.deepEqual(JSON.parse(requests[1].arguments.requestHeadersJson), { 'x-rabiroute-webgui-token': 'fixture-access' })
})

test('opening uses the caller original id and actual Rabi terminal receipt', async () => {
  const { rt, requests } = fixture({ response: args => ({ code: 0, data: JSON.parse(args.bodyJson) }) })
  const body = { instanceId: 'node:one', terminalId: 'original-terminal', action: 'open', shell: 'powershell', cwd: 'C:\\Work' }
  assert.equal((await rt.rabiComputerEndpoint('rabi-computer-terminal', body)).terminalId, body.terminalId)
  assert.equal(requests[1].arguments.path, '/api/lan-agent/instances/node%3Aone/terminals')
  assert.deepEqual(JSON.parse(requests[1].arguments.bodyJson), { action: 'open', terminalId: body.terminalId, shell: body.shell, cwd: body.cwd })
})

test('input forwards the original sequence exactly once', async () => {
  const { rt, requests } = fixture({ response: () => ({ code: 0, data: { nextInputSequence: 8 } }) })
  const receipt = await rt.rabiComputerEndpoint('rabi-computer-terminal', { instanceId: 'node:one', terminalId: 'original-terminal', action: 'input', sequence: 7, data: 'echo hello\r' })
  assert.equal(receipt.nextInputSequence, 8)
  assert.equal(requests.filter(input => input.arguments.method === 'POST').length, 1)
  assert.equal(JSON.parse(requests[1].arguments.bodyJson).sequence, 7)
})

test('invalid input is rejected before terminal mutation', async () => {
  const { rt, requests } = fixture()
  await assert.rejects(rt.rabiComputerEndpoint('rabi-computer-terminal', { instanceId: 'node:one', terminalId: 'original-terminal', action: 'input', sequence: 0, data: 'bad' }), /Invalid terminal input/)
  assert.ok(requests.every(input => input.arguments.method === 'GET'))
})

test('uncertain input is not replayed or changed into a new terminal', async () => {
  const { rt, requests } = fixture()
  const execute = rt.ctx.tools.execute
  rt.ctx.tools.execute = async input => input.arguments.method === 'POST'
    ? (requests.push(input), { isError: false, value: { ok: false, uncertain: true, statusCode: 0, body: '{}' } })
    : execute(input)
  await assert.rejects(rt.rabiComputerEndpoint('rabi-computer-terminal', { instanceId: 'node:one', terminalId: 'original-terminal', action: 'input', sequence: 1, data: 'echo hello\r' }), /outcome is uncertain/)
  assert.equal(requests.filter(input => input.arguments.method === 'POST').length, 1)
})

test('output observation preserves terminal identity and output cursor', async () => {
  const { rt, requests } = fixture({ response: () => ({ code: 0, data: { terminal: { terminalId: 'original-terminal' }, outputEvents: [], nextOutputSequence: 42 } }) })
  const value = await rt.rabiComputerEndpoint('rabi-computer-output', { instanceId: 'node:one', terminalId: 'original-terminal', after: 41 })
  assert.equal(value.nextOutputSequence, 42)
  assert.equal(requests[1].arguments.path, '/api/lan-agent/instances/node%3Aone/terminals/original-terminal?after=41&waitMs=1000')
})

test('DSH tool guards can refuse a Rabi GUI operation', async () => {
  const { rt } = fixture()
  rt.ctx.tools.execute = async () => ({ isError: true, error: { message: 'Operation denied by policy' } })
  const result = await rt.rabiComputerEndpoint('rabi-computers-list')
  assert.match(result.error, /denied by policy/)
  assert.deepEqual(result.computers, [])
})
