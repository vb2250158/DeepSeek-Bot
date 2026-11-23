import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'

// DSH 0.2.2 exports the JSONL persistence as a plugin module; earlier DSH as a default class.
const SessionPersistence = typeof Jsonl.apply === 'function' ? Jsonl : Jsonl.default

// DSH's own Workspace registry, which holds the archive, on files in a temporary folder.
// The listed Sessions count as live, so they can be archived. The plugin's archive hooks
// on `plugin` (a fake context) run inside an archive as DSH runs them.
async function dshRegistry(t, root, live, plugin) {
  const host = new Context()
  t.after(() => host.fiber.dispose())
  await host.plugin(Storage)
  await host.plugin(StorageJson, { root: join(root, 'storage') })
  await host.plugin(StorageDomain, { backend: 'json' })
  await host.plugin(SessionPersistence, { root: join(root, 'sessions') })
  await host.plugin({ name: 'live-sessions', apply: inner => inner.provide('sessions', { list: () => [], get: id => (live.includes(id) ? {} : undefined) }) })
  await host.plugin({
    name: 'plugin-hooks',
    apply: (inner) => {
      const hooks = name => plugin.listeners.get(name) ?? []
      inner.on('workspace/session-stop', payload => Promise.all(hooks('workspace/session-stop').map(listener => listener(payload))))
      inner.on('workspace/session-activity', (payload, next) => hooks('workspace/session-activity').reduceRight((rest, listener) => () => listener(payload, rest), next)())
    },
  })
  await host.plugin(WorkspaceRegistry)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the Workspace registry did not start')), 5000)
    host.inject(['workspaceRegistry'], inner => {
      clearTimeout(timer)
      resolve(inner.workspaceRegistry)
    })
  })
}

// Writer's current part is `w2`, its earlier part `w1`; the group's own Session is `g1`
// and Writer's Session in the group `gw`.
const TEAM = {
  version: 1,
  mainBotIds: ['m1'],
  revision: 1,
  bots: {
    m1: { id: 'm1', sessionId: 'm1', name: 'Chief', role: 'Chief of Staff', instructions: '', createdAt: 1 },
    w1: { id: 'w1', sessionId: 'w2', name: 'Writer', role: '', instructions: '', createdAt: 2, segments: [{ sessionId: 'w1', endedAt: 3 }] },
  },
  rooms: { g1: { id: 'g1', name: 'Launch', named: true, members: ['m1', 'w1'], admin: 'm1', mode: 'admin', notice: '', createdAt: 4, sessions: { w1: 'gw' } } },
  exchanges: [],
  exchangeTurns: {},
  questions: {},
}

async function team(t, archived) {
  const home = mkdtempSync(join(tmpdir(), 'dsb-archived-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(TEAM))
  const ctx = fakeContext({})
  const registry = await dshRegistry(t, join(home, 'dsh'), ['m1', 'w1', 'w2', 'g1', 'gw', 'outside'], ctx)
  for (const id of archived) await registry.archiveSession(SessionId(id), { stopActivity: true })
  ctx.workspaceRegistry = registry
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (route) => { if (route.path === '/api/bot') ctx.route = route; return register(route) }
  const rt = createRuntime(ctx, { home })
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  const call = async (endpoint, payload = {}) => (await ctx.route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))).json()
  return { home, registry, call, rt }
}

const settled = async (check) => {
  for (let i = 0; i < 50 && !check(); i += 1) await new Promise(resolve => setTimeout(resolve, 10))
}

test('Agent roster keeps the team live without opening chats; the Bot sidebar receives its previews once ready', async t => {
  const { call, rt } = await team(t, [])
  const gate = Promise.withResolvers()
  const reads = []
  const pages = []
  rt.ctx.sessionController = {
    async projections(req) { reads.push(req); return { values: { dsBotAssistantChat: { since: null } } } },
    async page({ address }) {
      pages.push(address.sessionId)
      await gate.promise
      return { hasMore: false, records: [{ event: { type: 'assistant/message', seq: 7, time: 20,
        data: { turn: 1, message: { content: [{ type: 'text', text: 'Last reply: ' + address.sessionId }] } } } }] }
    },
  }
  const agent = (await call('state', { chatPreviews: false })).value
  assert.equal(agent.bots.length, 2)
  assert.ok(agent.work.approvals)
  assert.deepEqual(reads, [])
  assert.deepEqual(pages, [])
  const opening = (await call('state', { since: agent.revision, chatPreviews: true })).value
  assert.equal(opening.bots.length, 2)
  await settled(() => pages.length === 2)
  assert.deepEqual(reads.map(r => r.keys), [['dsBotAssistantChat'], ['dsBotAssistantChat']])
  gate.resolve()
  await settled(() => rt.chatPreviewRevision() === 2)
  const loaded = (await call('state', { since: opening.revision, chatPreviews: true, previewKey: opening.previewKey })).value
  assert.equal(loaded.revision, opening.revision)
  assert.notEqual(loaded.previewKey, opening.previewKey)
  assert.deepEqual(loaded.bots.map(b => b.preview), ['Last reply: m1', 'Last reply: w2'])
  const current = (await call('state', { since: loaded.revision, chatPreviews: true, previewKey: loaded.previewKey })).value
  assert.equal(current.unchanged, true)
  const reconnected = (await call('state', { since: loaded.revision, chatPreviews: true, previewKey: 'previous-process:2' })).value
  assert.deepEqual(reconnected.bots, loaded.bots)
  const olderClient = (await call('state')).value
  assert.deepEqual(olderClient.bots, loaded.bots)
  assert.equal(pages.length, 2)
  assert.equal(reads.length, 2)
})

test('the removed manual switch keeps the active and archived Session identities', async (t) => {
  const { home, registry, call } = await team(t, ['w1'])
  await call('state')
  const result = await call('bot-open-part', { botId: 'w1', sessionId: 'w1' })
  assert.equal(result.error?.code, 'bot/not-found')
  assert.deepEqual([...registry.archivedSessionIds], ['w1'])
  const saved = JSON.parse(readFileSync(join(home, 'state.json'), 'utf8')).bots.w1
  assert.equal(saved.sessionId, 'w2')
  assert.deepEqual(saved.segments.map(segment => segment.sessionId), ['w1'])
})

test('loading the team preserves current and earlier DSH Session archives', async (t) => {
  const { registry, call } = await team(t, ['w1', 'w2', 'g1', 'gw', 'outside'])
  const unarchive = t.mock.method(registry, 'unarchiveSession')
  await call('state')
  assert.equal(unarchive.mock.callCount(), 0)
  assert.deepEqual([...registry.archivedSessionIds].sort(), ['g1', 'gw', 'outside', 'w1', 'w2'])
})

test('indexing the team preserves a current Session explicitly archived with stopActivity', async (t) => {
  const { registry, call, rt } = await team(t, [])
  const unarchive = t.mock.method(registry, 'unarchiveSession')
  await call('state')
  await registry.archiveSession(SessionId('w2'), { stopActivity: true })
  await registry.archiveSession(SessionId('gw'))
  await registry.archiveSession(SessionId('outside'))
  await rt.save()
  assert.equal(unarchive.mock.callCount(), 0)
  assert.deepEqual([...registry.archivedSessionIds].sort(), ['gw', 'outside', 'w2'])
})
