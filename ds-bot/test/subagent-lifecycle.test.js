import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { archivePreviousPart } from '../src/host/parts.js'
import { drainSelectedChildren } from '../src/host/turns.js'

async function liveSubagents(t) {
  const home = await mkdtemp(join(tmpdir(), 'ds-bot-child-lifecycle-'))
  const previousHome = process.env.DSH_HOME
  t.diagnostic(`syntheticHome=${home}`)
  process.env.DSH_HOME = home
  const ctx = new Context()
  t.after(async () => {
    await ctx.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true, maxRetries: 5 })
  })
  class ScriptedModel extends LlmAdapter {
    constructor() { super('child-lifecycle-fixture') }
    async *stream() {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'The original fixture task has settled.' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'The original fixture task has settled.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime, NativeToolExecutor, AgentRegistry, FsLocal, WorkingDirectory]) await ctx.plugin(plugin)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['child-lifecycle-fixture'], new ScriptedModel())
  await ctx.plugin(SubagentRuntime)
  const workers = new Map()
  const provider = {
    name: 'independent-lifecycle-fixture', inheritsParentContext: false,
    capabilities: { depthLimit: true, outputSchema: false, agentOptions: false, agentPreset: false },
    async start(request) {
      const id = SessionId(`owned-fixture-worker-${workers.size + 1}`)
      const settled = Promise.withResolvers()
      const worker = { id, parentId: request.parent.id, state: 'running', disposed: 0 }
      const finish = (state, stopReason, text) => {
        if (worker.state !== 'running') return
        worker.state = state
        settled.resolve({ stopReason, output: [{ type: 'text', text }] })
      }
      worker.finish = text => finish('completed', 'completed', text)
      workers.set(id, worker)
      return { id, result: settled.promise, dispose: async () => { worker.disposed += 1; finish('aborted', 'aborted', 'The selected fixture worker was stopped.') } }
    },
  }
  await ctx.plugin({ name: 'child-lifecycle-provider', inject: ['subagents'], apply: scope => scope.subagents.registerProvider(provider) })
  const parent = await ctx.agentLoop.create(SessionId('old-chat-part'), { provider: 'child-lifecycle-fixture', model: 'scripted' }, { cwd: home })
  const fresh = await ctx.agentLoop.create(SessionId('new-chat-part'), { provider: 'child-lifecycle-fixture', model: 'scripted' }, { cwd: home })
  const other = await ctx.agentLoop.create(SessionId('other-bot-chat'), { provider: 'child-lifecycle-fixture', model: 'scripted' }, { cwd: home })
  const start = agent => {
    const request = { parent: agent, prompt: [{ type: 'text', text: 'Independent synthetic work' }], maxDepth: 1 }
    return ctx.subagents.startActivation({
      provider: provider.name, label: `task for ${agent.id}`,
      ...request,
      signal: new AbortController().signal, delivery: 'parent',
    })
  }
  const archived = []
  const rt = { ctx: { get: key => ctx.get(key), subagents: ctx.subagents, workspaceRegistry: { archiveSession: async (id, options) => archived.push({ id, options }) } }, resolveAgent: id => Promise.resolve(ctx.agents.get(id)) }
  return { ctx, workers, parent, fresh, other, start, archived, rt }
}

test('a previous part waits only for its Core-owned workers and keeps exact-parent completion', async t => {
  const { ctx, workers, parent, fresh, other, start, archived, rt } = await liveSubagents(t)
  const child = await start(parent)
  const foreign = await start(other)
  const wait = archivePreviousPart(rt, parent)
  await Promise.resolve()
  assert.deepEqual(archived, [])
  fresh.followup(createUserMessage({ content: [{ type: 'text', text: 'A new part remains usable.' }], source: { kind: 'user' } }))
  await fresh.whenIdle()
  assert.equal(workers.get(foreign.childId).state, 'running')
  assert.deepEqual(archived, [])
  workers.get(child.childId).finish('Original task completed in its original parent.')
  await child.result
  await wait
  assert.deepEqual(archived, [{ id: parent.id, options: { stopActivity: true } }])
  const sourceEvents = parent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source?.kind === 'subagent-settled')
  assert.equal(sourceEvents.length, 1)
  assert.equal(sourceEvents[0].data.source.senderSessionId, child.childId)
  assert.equal(fresh.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source?.kind === 'subagent-settled').length, 0)
  assert.equal(workers.get(foreign.childId).state, 'running')
  await ctx.fiber.dispose()
  assert.equal(workers.get(foreign.childId).state, 'aborted')
  assert.ok(workers.get(foreign.childId).disposed > 0)
})

test('selected child teardown rejects a foreign child, awaits only owned cleanup and permits later work', async t => {
  const { ctx, workers, parent, other, start, rt } = await liveSubagents(t)
  const foreign = await start(other)
  const selected = await start(parent)
  const sibling = await start(parent)
  await assert.rejects(drainSelectedChildren(rt, parent.id, [selected.childId, foreign.childId]), { code: 'UNAUTHORIZED' })
  assert.equal(workers.get(selected.childId).state, 'running')
  assert.equal(workers.get(foreign.childId).state, 'running')
  await drainSelectedChildren(rt, parent.id, [selected.childId])
  await selected.result
  assert.equal(workers.get(selected.childId).state, 'aborted')
  assert.equal(workers.get(sibling.childId).state, 'running')
  assert.equal(workers.get(foreign.childId).state, 'running')
  const later = await start(parent)
  workers.get(later.childId).finish('A later task remains independent of the earlier stop.')
  await later.result
  await parent.whenIdle()
  assert.equal(workers.get(later.childId).state, 'completed')
  await ctx.fiber.dispose()
  assert.equal(workers.get(foreign.childId).state, 'aborted')
  assert.ok(workers.get(foreign.childId).disposed > 0)
})

test('missing scoped child capabilities retain the original part and reject teardown', async () => {
  const archived = []
  const parent = { id: 'original-part' }
  const rt = {
    ctx: { subagents: {}, workspaceRegistry: { archiveSession: async id => archived.push(id) } },
    hasSubagents: id => id === parent.id,
  }
  await assert.rejects(archivePreviousPart(rt, parent), /original Session remains available/)
  await assert.rejects(drainSelectedChildren(rt, parent.id, ['child']), { code: 'SUBAGENT_TEARDOWN_UNAVAILABLE' })
  assert.deepEqual(archived, [])
})
