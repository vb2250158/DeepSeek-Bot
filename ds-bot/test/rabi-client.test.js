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
