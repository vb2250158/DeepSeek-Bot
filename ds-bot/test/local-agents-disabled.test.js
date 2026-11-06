import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { test } from 'node:test'
import { install } from '../src/host/local-agents/index.js'

test('a disabled local-agent integration does not discover, register, probe, spawn or change saved bindings', async t => {
  const unexpected = () => { throw new Error('The disabled integration reached a machine resource') }
  t.mock.method(fs, 'existsSync', unexpected)
  t.mock.method(childProcess, 'spawn', unexpected)
  t.mock.method(childProcess, 'execFile', unexpected)
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  const state = { localAgents: { custom: [{ id: 'fixture', name: 'Fixture', command: 'fake-agent', args: [] }], sessions: { bot: { cliSessionId: 'saved-cli-session' } } } }
  const before = structuredClone(state)
  const bot = { model: 'codex-cli/default' }
  const rt = {
    config: { localAgentsEnabled: false }, state,
    ctx: { llm: { registerAdapter: unexpected }, effect: unexpected },
    load: unexpected, save: unexpected, botOf: () => bot, selfOf: () => 'bot',
  }
  install(rt)
  assert.deepEqual(rt.localAgentRoutes(), [])
  assert.deepEqual(rt.localAgentTools, [])
  assert.equal(rt.localAgentOf(bot), bot.model)
  assert.equal(rt.isLocalAgentSession('bot'), true)
  assert.equal(rt.localAgentBadge(bot.model), 'codex-cli')
  const disabled = { available: false, enabled: false, detected: [], custom: [] }
  assert.deepEqual(await rt.localAgentsEndpoint('local-agents'), disabled)
  assert.deepEqual(await rt.localAgentsEndpoint('local-agent-refresh'), disabled)
  for (const endpoint of ['local-agent-add', 'local-agent-update', 'local-agent-remove']) {
    await assert.rejects(rt.localAgentsEndpoint(endpoint, { command: 'fake-agent' }), { code: 'LOCAL_AGENTS_DISABLED' })
  }
  assert.deepEqual(state, before)
})

test('the local-agent enablement field rejects a non-boolean value before startup', () => {
  assert.throws(() => install({ config: { localAgentsEnabled: 'false' }, ctx: {}, state: {} }), /localAgentsEnabled must be a boolean/)
})
