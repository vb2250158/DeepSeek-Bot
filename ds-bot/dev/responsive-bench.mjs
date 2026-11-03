import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { createRuntime } from '../index.js'
import { fakeContext } from '../test/fake-ctx.js'

const stats = values => {
  const sorted = [...values].sort((left, right) => left - right)
  const percentile = ratio => sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)]
  return { n: sorted.length, p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1) }
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

async function bench(responsiveChat, startupOnly = false) {
  const started = performance.now()
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-responsive-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const bots = Object.fromEntries(Array.from({ length: 4 }, (_, index) => {
    const id = `bot-${index}`
    return [id, { id, sessionId: id, name: `Fixture${index}`, createdAt: index + 1, capabilities: [] }]
  }))
  writeFileSync(join(home, 'state.json'), JSON.stringify({
    version: 1, bots, mainBotIds: ['bot-0'], agents: {}, exchanges: [], exchangeTurns: {}, questions: {}, revision: 1,
    rooms: { room: { id: 'room', name: 'FixtureGroup', members: Object.keys(bots), mode: 'everyone', admin: 'bot-0', sessions: Object.fromEntries(Object.keys(bots).map(id => [id, `group-${id}`])), log: [], seq: 0, seen: {} } },
  }))
  const ctx = fakeContext()
  const agents = new Map()
  const tails = new Map()
  const turns = new Map()
  const pending = new Set()
  const replies = []
  const contexts = []
  const workers = []
  const faults = []
  let sequence = 0
  let route
  let rt
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = options => {
    if (options.path === '/api/bot') route = options
    return register(options)
  }
  const schemas = [
    ...['subagent', 'list_agents', 'job_list'].map(name => ({ name, description: 'Fixture dispatch or cached status', parameters: {} })),
    ...Array.from({ length: 80 }, (_, index) => ({ name: index === 0 ? 'slow_fixture' : `fixture_tool_${index}`, description: 'Fixture slow tool schema. '.repeat(16), parameters: { type: 'object' } })),
  ]
  ctx.tools.schemas = agent => schemas.filter(schema => !agent?.allow || agent.allow.has(schema.name))
  ctx.registeredTools.set('subagent', { execute: () => {
    const worker = { id: `fixture-child-${workers.length}`, state: 'running' }
    worker.completion = new Promise((resolve, reject) => {
      worker.finish = () => resolve('fixture result')
      worker.fail = () => reject(new Error('fixture worker failed'))
    }).then(() => { worker.state = 'completed' }, () => { worker.state = 'failed' })
    workers.push(worker)
    return `started subagent ${worker.id}`
  } })
  const emit = (id, type, data) => {
    for (const listener of ctx.listeners.get('session/event') ?? []) {
      if (listener.length >= 2) listener({ id }, { type, seq: ++sequence, data })
    }
  }
  const agentFor = async id => {
    if (agents.has(id)) return agents.get(id)
    const agent = {
      id, session: { id },
      ctx: { effect: execute => execute(), tools: { restrict: filter => { agent.allow = new Set(filter.allow ?? schemas.filter(schema => !filter.deny.includes(schema.name)).map(schema => schema.name)); return () => {} } } },
      followup: message => { track(enqueue(id, message)) },
      steer: message => { track(enqueue(id, message)) },
      inbox: { nextStep: [], nextTurn: [] },
    }
    agents.set(id, agent)
    for (const listener of ctx.listeners.get('agent/created') ?? []) await listener({ agent })
    return agent
  }
  const track = promise => {
    pending.add(promise)
    void promise.then(() => pending.delete(promise), error => { pending.delete(promise); faults.push(String(error)) })
  }
  const reply = async (id, message) => {
    const agent = await agentFor(id)
    const prompt = ctx.sections.get('bot-identity').text({ agent })
    const schemaText = JSON.stringify(ctx.tools.schemas(agent))
    contexts.push({ promptUtf8Bytes: Buffer.byteLength(prompt), schemaUtf8Bytes: Buffer.byteLength(schemaText), estimatedTokensCharsDiv4: Math.ceil((prompt.length + schemaText.length) / 4) })
    const turn = (turns.get(id) ?? 0) + 1
    turns.set(id, turn)
    emit(id, 'turn/start', { turn })
    emit(id, 'user/message', message)
    await delay(5)
    const slow = message.content.some(block => block.text?.includes('slow-fixture'))
    if (slow) {
      // The scripted model chooses dispatch; tool access itself stays unchanged.
      if (responsiveChat) ctx.registeredTools.get('subagent').execute()
      else await delay(11_000)
    }
    const text = slow && responsiveChat ? 'Fixture work dispatched.' : 'Fixture reply.'
    replies.push({ id, at: performance.now(), text })
    emit(id, 'assistant/message', { message: { content: [{ type: 'text', text }] } })
    emit(id, 'turn/end', { turn, reason: { kind: 'completed' } })
  }
  const enqueue = (id, message) => {
    const run = (tails.get(id) ?? Promise.resolve()).then(() => reply(id, message))
    tails.set(id, run.catch(() => {}))
    return run
  }
  Object.assign(ctx, {
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) },
    sessionTitle: { rename: async () => {} }, sessions: { flush: async () => {} },
    workspaceRegistry: { get: () => undefined, resolveByPath: async () => undefined, create: async () => ({ id: 'fixture-workspace' }), archiveSession: async () => {} },
    sessionController: {
      resolveAgent: async id => ({ agent: await agentFor(id) }),
      prompt: async request => {
        const message = { content: request.content, source: { kind: 'user' } }
        if (request.sessionId !== 'room') return enqueue(request.sessionId, message)
        emit('room', 'user/message', message)
        return rt.teamTools.find(tool => tool.name === 'group_relay').execute({}, { agent: { id: 'room' }, callId: `fixture-${++sequence}`, signal: AbortSignal.timeout(10_000) })
      },
    },
  })
  try {
    rt = createRuntime(ctx, { home, github: false, diagnosticsFile: false, responsiveChat })
    await rt.load()
    const readyMs = performance.now() - started
    if (startupOnly) return { readyMs, rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed }
    const send = async (sessionId, text) => {
      const start = performance.now()
      const response = await route.fetch(new Request('http://fixture/api/bot', { method: 'POST', body: JSON.stringify({ endpoint: 'send', payload: { sessionId, text } }) }))
      assert.equal((await response.json()).ok, true)
      return performance.now() - start
    }
    const direct = []
    for (let index = 0; index < 20; index++) direct.push(await send('bot-0', 'fixture hello'))
    const slow = await Promise.all(Object.keys(bots).slice(0, 3).map(id => send(id, 'slow-fixture')))
    const concurrent = await Promise.all(Array.from({ length: 20 }, (_, index) => send(`bot-${index % 4}`, 'fixture hello')))
    const group = []
    const beforeGroup = replies.length
    const groupStart = performance.now()
    for (let index = 0; index < 5; index++) group.push(await send('room', 'fixture group hello'))
    const groupElapsed = performance.now() - groupStart
    const groupReplies = replies.length - beforeGroup
    assert.equal(groupReplies, 20)
    const agent = await agentFor('bot-0')
    const prompt = ctx.sections.get('bot-identity').text({ agent })
    const schemaText = JSON.stringify(ctx.tools.schemas(agent))
    const context = { promptUtf8Bytes: Buffer.byteLength(prompt), schemaUtf8Bytes: Buffer.byteLength(schemaText), toolCount: ctx.tools.schemas(agent).length, estimatedTokensCharsDiv4: Math.ceil((prompt.length + schemaText.length) / 4), actualModelTokens: null }
    workers[0]?.fail()
    await workers[0]?.completion
    const afterFailure = await send('bot-0', 'fixture hello after worker failures')
    if (responsiveChat) {
      assert.equal(workers[0].state, 'failed')
      assert.equal(workers[1].state, 'running')
    }
    assert.deepEqual(faults, [])
    const timings = { direct: stats(direct), slowTool: stats(slow), concurrent: stats(concurrent), groupRound: stats(group) }
    if (responsiveChat) {
      for (const metric of Object.values(timings)) assert.ok(metric.max <= 10_000)
      assert.ok(afterFailure <= 10_000)
    }
    const contextDistributions = Object.fromEntries(Object.keys(contexts[0]).map(key => [key, stats(contexts.map(sample => sample[key]))]))
    return { responsiveChat, scope: 'keyless fakeContext API send to scripted reply; 5ms model stub, 11s slow tool stub; responsive dispatch is a scripted model choice; group relay is real plugin code, no real model or Host', unit: 'ms', ...timings, groupRepliesPerSecond: groupReplies / (groupElapsed / 1000), groupThroughputRepliesPerSecond: stats(group.map(elapsed => 4000 / elapsed)), context, contextDistributions, afterWorkerFailuresMs: afterFailure, failedFixtureWorkers: workers.filter(worker => worker.state === 'failed').length, stillRunningFixtureWorkers: workers.filter(worker => worker.state === 'running').length }
  } finally {
    for (const worker of workers) worker.finish()
    await Promise.all(workers.map(worker => worker.completion))
    await Promise.allSettled(pending)
    await ctx.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    const target = resolve(home)
    assert.ok(target.startsWith(resolve(tmpdir(), 'ds-bot-responsive-')))
    rmSync(target, { recursive: true, force: true, maxRetries: 5 })
  }
}

if (process.argv.includes('--startup-sample')) {
  console.log(JSON.stringify(await bench(process.argv.includes('--responsive'), true)))
} else {
  for (const responsiveChat of [false, true]) {
    console.log(JSON.stringify(await bench(responsiveChat)))
    const starts = []
    const rss = []
    const heap = []
    for (let index = 0; index < 5; index++) {
      const start = performance.now()
      const child = spawnSync(process.execPath, ['--import', './test/harness-resolve.mjs', fileURLToPath(import.meta.url), '--startup-sample', ...(responsiveChat ? ['--responsive'] : [])], { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8', windowsHide: true, timeout: 30_000 })
      assert.equal(child.status, 0, child.stderr)
      starts.push(performance.now() - start)
      const sample = JSON.parse(child.stdout.trim().split('\n').at(-1))
      rss.push(sample.rssBytes)
      heap.push(sample.heapUsedBytes)
    }
    console.log(JSON.stringify({ responsiveChat, scope: 'fresh Node process plus fakeContext runtime, not DSH Host startup', startupMs: stats(starts), rssBytes: stats(rss), heapUsedBytes: stats(heap) }))
  }
}
