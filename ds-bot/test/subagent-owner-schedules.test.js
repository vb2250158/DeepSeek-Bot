import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'

import { install as installSchedules } from '../src/host/schedules.js'

test('real Core child Agents inherit only their live Bot owner for Schedule access', { timeout: 15000 }, async t => {
  const home = await mkdtemp(join(tmpdir(), 'dsbot-owner-schedule-'))
  const previousHome = process.env.DSH_HOME
  const previousAgents = process.env.AGENTS_HOME
  process.env.DSH_HOME = home
  process.env.AGENTS_HOME = join(home, 'agents')
  const ctx = new Context()
  const finished = Promise.withResolvers()
  t.after(async () => {
    finished.resolve()
    try { await ctx.fiber.dispose() } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      if (previousAgents === undefined) delete process.env.AGENTS_HOME
      else process.env.AGENTS_HOME = previousAgents
      await rm(home, { recursive: true, force: true, maxRetries: 5 })
    }
  })
  class Model extends LlmAdapter {
    constructor() { super('owner-schedule-fixture') }
    async *stream() { await finished.promise; yield { type: 'finish', reason: { kind: 'stop' } } }
  }
  const { default: WorkingDirectory } = await import('@deepseek-ai/dsh-working-directory')
  const executor = await import('@deepseek-ai/dsh-tool-executor-native')
  for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime, executor, AgentRegistry, FsLocal, WorkingDirectory]) await ctx.plugin(plugin)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['owner-schedule-fixture'], new Model())
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin({ name: 'owner-local-provider', inject: ['subagents'], apply: scope => scope.subagents.registerProvider({
    name: 'owner-local-fixture', inheritsParentContext: true,
    capabilities: { depthLimit: true, outputSchema: false, agentOptions: true, agentPreset: false },
    prepareContinuable: async () => ({}),
  }) })
  const make = id => ctx.agentLoop.create(SessionId(id), { provider: 'owner-schedule-fixture', model: 'synthetic' }, { cwd: home })
  const a = await make('bot-a'), b = await make('bot-b'), human = await make('human-chat')
  const activation = await ctx.subagents.startActivation({ provider: 'owner-local-fixture', label: 'Synthetic owner child', parent: a, prompt: [{ type: 'text', text: 'Synthetic child' }], maxDepth: 1, signal: new AbortController().signal, delivery: 'caller' })
  const child = ctx.agents.get(activation.childId)
  assert.ok(child)
  assert.equal(ctx.subagents.rootOf(child), a)
  assert.equal(ctx.subagents.rootOf(human), human)
  assert.throws(() => ctx.subagents.rootOf({ id: child.id }), /exact live caller/)
  const tasks = [a, b].map((agent, i) => ({ id: 'task-' + i, target: { kind: 'session', sessionId: agent.id }, status: 'active' }))
  ctx.provide('schedule', { edit() {}, catalog: async () => tasks })
  const owners = new Map([[a.id, 'a'], [b.id, 'b']])
  const rt = { ctx, load: async () => {}, chatOwners: owners, groupOwners: new Map(), pastOwners: new Map(), roomOf: () => undefined, botOf: id => ({ id }), isBotSession: id => owners.has(id) }
  installSchedules(rt)
  await Promise.resolve()
  const gate = (agent, id) => ctx.waterfall('tools/pre-execute', { name: 'schedule_edit', arguments: { id, action: 'delete' }, agent }, async () => ({ kind: 'allow' }))
  assert.deepEqual(await gate(child, 'task-0'), { kind: 'allow' })
  assert.equal((await gate(child, 'task-1')).kind, 'deny')
  assert.deepEqual(await gate(human, 'task-1'), { kind: 'allow' })
  const list = agent => { const exec = { name: 'schedule_list', arguments: {}, agent }; return ctx.waterfall('tools/execute', exec, async () => ({ isError: false, value: { items: tasks, total: tasks.length } })) }
  assert.deepEqual((await list(child)).value.items.map(item => item.id), ['task-0'])
  assert.deepEqual((await list(human)).value.items.map(item => item.id), ['task-0', 'task-1'])
  assert.equal(ctx.agents.get(child.id), child, 'the true execution Agent remains unchanged')
  finished.resolve()
  await activation.result
})
