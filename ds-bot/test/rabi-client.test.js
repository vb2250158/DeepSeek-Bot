import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rabiClient } from '../src/host/rabi-client.js'

test('a Manager storage timeout is a readable failed read, without replay', async () => {
  const calls = []
  const client = rabiClient({ tools: {
    get: () => ({}), execute: async input => {
      calls.push(input)
      return { isError: false, value: { ok: false, statusCode: 500, body: JSON.stringify({ code: -1, message: 'Manager read exceeded 30000 ms.' }), error: { message: 'Manager HTTP 500' } } }
    },
  } })
  await assert.rejects(client.json('/api/roles/fixture/memory?limit=20'), { code: 'bot/rabi-read-timeout' })
  assert.equal(calls.length, 1)
})

test('an uncertain mutation keeps its original outcome and is never presented as a failed read', async () => {
  let calls = 0
  const client = rabiClient({ tools: {
    get: () => ({}), execute: async () => {
      calls++
      return { isError: false, value: { ok: false, uncertain: true, statusCode: 500, body: JSON.stringify({ message: 'Manager read exceeded 30000 ms.' }) } }
    },
  } })
  await assert.rejects(client.json('/api/fixture', 'POST', {}), /outcome is uncertain/)
  assert.equal(calls, 1)
})
test('a stopped Host is reported explicitly without retrying discovery or business writes', async () => {
  let calls = 0
  const client = rabiClient({ tools: { get: () => ({}), execute: async () => { calls++; return { isError: false, value: { ok: false, error: { kind: 'host_stopped' } } } } } })
  await assert.rejects(client.json('/api/personas'), /Rabi is not running/)
  assert.equal(calls, 1)
})

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'

async function runtimeClient(t, receipt) {
  const ctx = new Context()
  t.after(async () => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (typeof ctx.tools.setExecutor === 'function') await ctx.plugin(await import('@deepseek-ai/dsh-tool-executor-native'))
  const calls = []
  const fixture = inner => {
    inner.tools.register(defineTool({
      name: 'rabiroute_manager_api',
      description: 'Isolated Manager fixture; never connects to a real Manager.',
      parameters: { method: { type: 'string', required: true }, path: { type: 'string', required: true }, bodyJson: { type: 'string' }, requestHeadersJson: { type: 'string' } },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute(args, exec) { calls.push({ args, signal: exec.signal }); return receipt },
    }))
  }
  fixture.inject = ['tools']
  await ctx.plugin(fixture)
  return { client: rabiClient(ctx), calls }
}

test('the installed tool runtime dispatches a Manager read exactly once', async t => {
  const { client, calls } = await runtimeClient(t, { ok: true, statusCode: 200, body: JSON.stringify({ code: 0, data: { count: 2 } }) })
  assert.deepEqual(await client.json('/api/fixture'), { code: 0, data: { count: 2 } })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args, { method: 'GET', path: '/api/fixture' })
  assert.equal(calls[0].signal.aborted, false)
})

test('the installed tool runtime retains one uncertain Manager write and its headers', async t => {
  const { client, calls } = await runtimeClient(t, { ok: false, uncertain: true, statusCode: 500 })
  await assert.rejects(client.json('/api/fixture', 'PATCH', { enabled: true }, undefined, { 'If-Match': '"fixture-revision"' }), /outcome is uncertain/)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args, { method: 'PATCH', path: '/api/fixture', bodyJson: JSON.stringify({ enabled: true }), requestHeadersJson: JSON.stringify({ 'If-Match': '"fixture-revision"' }) })
})
