import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as sleep } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentTool from '@deepseek-ai/dsh-tool-subagent'
import { install as installBotTools } from '../src/host/tools.js'
import { install as installBotPrompt } from '../src/host/prompt.js'
import { resolveResponsiveChat } from '../src/host/responsive-chat.js'

const stats = samples => {
  const sorted = [...samples].sort((left, right) => left - right)
  const at = fraction => sorted[Math.ceil(sorted.length * fraction) - 1]
  return { n: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted.at(-1) }
}

async function measure(responsiveChat) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-native-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const ctx = new Context()
  const plans = new Map()
  const bots = new Map()
  const pendingReplies = new Map()
  const workers = []
  const notices = []
  let callSequence = 0
  let lateToolExecutions = 0
  class ScriptedModel extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async *stream(options) {
      const plan = plans.get(options.sessionId)
      assert.ok(plan, `No fixture plan for ${options.sessionId}`)
      await sleep(5, undefined, { signal: options.signal })
      const phase = plan.phase++
      if (plan.task !== 'hello' && phase === 0) {
        const name = plan.task === 'late-tool' ? 'late_scoped_fixture' : responsiveChat ? 'subagent' : 'slow_fixture'
        const args = responsiveChat && plan.task !== 'late-tool' ? { description: 'Isolated latency fixture task', prompt: plan.task } : {}
        const block = { type: 'tool-call', id: ToolCallId(`native-call-${++callSequence}`), name, arguments: JSON.stringify(args) }
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: block.id, name, argumentsDelta: block.arguments }
        yield { type: 'block-end', index: 0, block }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
      const text = plan.task === 'late-tool' ? 'Fixture late scoped call completed.' : phase === 1 && plan.task !== 'hello' && responsiveChat ? 'Fixture task accepted; result pending.' : 'Fixture response.'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const provider = {
    name: 'latency-fixture', inheritsParentContext: false,
    capabilities: { depthLimit: true, outputSchema: false, agentOptions: false, agentPreset: false },
    async start(request) {
      const task = request.prompt.map(block => block.text ?? '').join('')
      const worker = { id: SessionId(`native-fixture-worker-${workers.length}`), state: 'running' }
      workers.push(worker)
      let finish
      let taskTimer
      const result = new Promise(resolve => { finish = resolve })
      const settle = (state, stopReason, text) => {
        if (worker.state !== 'running') return
        worker.state = state
        clearTimeout(taskTimer)
        clearTimeout(deadline)
        request.signal.removeEventListener('abort', abort)
        finish({ output: [{ type: 'text', text }], stopReason, ...(stopReason === 'completed' ? {} : { diagnostic: text }) })
      }
      const abort = () => settle('aborted', 'aborted', 'Fixture worker cancelled')
      const deadline = setTimeout(() => settle('timeout', 'error', 'Fixture worker exceeded its 120ms budget'), task === 'hang' ? 120 : 20_000)
      request.signal.addEventListener('abort', abort, { once: true })
      if (task !== 'hang') taskTimer = setTimeout(() => settle(task === 'fail' ? 'failed' : 'completed', task === 'fail' ? 'error' : 'completed', task === 'fail' ? 'Fixture worker failed' : 'Fixture worker completed'), task === 'fail' ? 30 : 11_000)
      if (request.signal.aborted) abort()
      worker.result = result
      return { id: worker.id, result, dispose: async () => abort() }
    },
  }
  try {
    for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime, NativeToolExecutor, AgentRegistry, FsLocal, WorkingDirectory]) await ctx.plugin(plugin)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['latency-fixture'], new ScriptedModel())
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin({ name: 'native-latency-provider', inject: ['subagents'], apply: scope => scope.subagents.registerProvider(provider) })
    await ctx.plugin(SubagentTool, { provider: provider.name, toolName: 'subagent', maxDepth: 1 })
    ctx.tools.register(defineTool({
      name: 'slow_fixture', description: 'An isolated 11-second slow tool; never touches user data.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
      async execute(_args, exec) { await sleep(11_000, undefined, { signal: exec.signal }); return 'Fixture slow work finished' },
    }))
    await ctx.plugin({
      name: 'ds-bot-native-latency-policy',
      inject: ['tools', 'systemPrompt'],
      apply(scope) {
        const rt = {
          ctx: scope, teamTools: [], state: { bots: {}, rooms: {} }, responsiveChat: resolveResponsiveChat({ responsiveChat }),
          load: async () => {}, selfOf: id => bots.has(id) ? id : undefined,
          botOf: id => bots.get(id), roomOf: () => undefined, isBotSession: id => bots.has(id),
          warn: (...args) => console.warn(...args),
        }
        installBotTools(rt)
        installBotPrompt(rt)
      },
    })
    ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      if (frame.type !== 'chunk' || frame.chunk.type !== 'text-delta') return
      pendingReplies.get(agent.id)?.resolve(performance.now())
    })
    ctx.on('subagent/end', info => notices.push(info))
    const create = async id => {
      bots.set(id, { id, name: id, instructions: '' })
      return ctx.agentLoop.create(SessionId(id), { provider: 'latency-fixture', model: 'scripted' }, { cwd: home })
    }
    const send = async (agent, task) => {
      await agent.whenIdle()
      plans.set(agent.id, { task, phase: 0 })
      const first = Promise.withResolvers()
      pendingReplies.set(agent.id, first)
      const started = performance.now()
      agent.followup(createUserMessage({ content: [{ type: 'text', text: task }], source: { kind: 'user' } }))
      const timeout = setTimeout(() => first.reject(new Error(`No reply within 25000ms: ${agent.id}; events=${JSON.stringify(agent.session.snapshotEvents().slice(-8))}`)), 25_000)
      try {
        const at = await first.promise
        await agent.whenIdle()
        return at - started
      } finally {
        clearTimeout(timeout)
        pendingReplies.delete(agent.id)
      }
    }
    const roots = await Promise.all(Array.from({ length: 4 }, (_, index) => create(`native-root-${index}`)))
    const short = []
    for (let index = 0; index < 10; index++) short.push(await send(roots[0], 'hello'))
    const slow = await Promise.all(roots.slice(0, 3).map(agent => send(agent, 'slow')))
    const duringWorkers = await Promise.all(roots.map(agent => send(agent, 'hello')))
    const afterFailure = []
    const faultDispatch = []
    let lateToolCallMs
    if (responsiveChat) {
      assert.equal(workers.filter(worker => worker.state === 'running').length, 3)
      roots[3].ctx.tools.register(defineTool({
        name: 'late_scoped_fixture', description: 'A late scoped fixture which remains available.', parameters: {},
        output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
        execute: async () => { lateToolExecutions += 1; return 'Fixture late scoped result' },
      }))
      lateToolCallMs = await send(roots[3], 'late-tool')
      assert.equal(lateToolExecutions, 1)
      assert.ok(roots[3].session.snapshotEvents().some(event => event.type === 'tool/result' && JSON.stringify(event.data).includes('Fixture late scoped result')))
      faultDispatch.push(await send(roots[3], 'fail'))
      faultDispatch.push(await send(roots[3], 'hang'))
      await sleep(200)
      for (let index = 0; index < 4; index++) afterFailure.push(await send(roots[index], 'hello'))
      assert.ok(workers.some(worker => worker.state === 'failed'))
      assert.ok(workers.some(worker => worker.state === 'timeout'))
    }
    await Promise.all(workers.map(worker => worker.result))
    await sleep(50)
    for (const root of roots) await root.whenIdle()
    if (responsiveChat) {
      assert.ok(notices.length >= 5)
      assert.ok(lateToolCallMs <= 10_000)
      for (const sample of [...short, ...slow, ...duringWorkers, ...afterFailure, ...faultDispatch]) assert.ok(sample <= 10_000)
    }
    const deliveredNotices = roots.reduce((total, root) => total + root.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source?.kind === 'subagent-settled').length, 0)
    if (responsiveChat) assert.equal(deliveredNotices, 5)
    return { responsiveChat, scope: 'real DSH AgentLoop + native tool executor + managed subagent runtime + ds-bot tools/prompt; scripted 5ms LLM and bounded fixture worker; no full Web Host or real model', unit: 'ms', short: stats(short), slow: stats(slow), whileWorkersRun: stats(duringWorkers), faultDispatch: faultDispatch.length ? stats(faultDispatch) : null, afterWorkerFailureOrTimeout: afterFailure.length ? stats(afterFailure) : null, lateToolCallMs, lateToolExecutions, workerStates: workers.map(worker => worker.state), nativeCompletionNotices: notices.length, deliveredNotices, visibleRootTools: ctx.tools.schemas(roots[0]).map(tool => tool.name) }
  } finally {
    await ctx.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    const target = resolve(home)
    assert.ok(target.startsWith(resolve(tmpdir(), 'ds-bot-native-')))
    rmSync(target, { recursive: true, force: true, maxRetries: 5 })
  }
}

for (const enabled of [false, true]) console.log(JSON.stringify(await measure(enabled)))
