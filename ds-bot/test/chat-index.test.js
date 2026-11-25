import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { install, termQuery } from '../src/host/chat-index.js'
import { historyEntry } from '../src/host/parts.js'

function runtime(t) {
  const home = mkdtempSync(join(tmpdir(), 'dsb-chat-index-'))
  const events = Array.from({ length: 12 }, (_, seq) => ({ seq, time: seq, text: `message 会议 ${seq}` }))
  const dispose = []
  const rt = {
    home,
    ctx: {
      effect: fn => dispose.push(fn()),
      sessionController: { page: async () => ({ records: events.map(event => ({ event })), hasMore: false }) },
    },
    partsOf: () => [{ sessionId: 's1', number: 1, startedAt: 0 }],
    resolveAgent: async () => ({ session: { seq: events.length } }),
    loadAssistantChat: async () => undefined,
    historyEntry: event => ({ text: event.text, who: 'user', keepAnswers: true }),
    clock: time => String(time),
    warn: (...args) => assert.fail(args.join(' ')),
  }
  t.after(async () => {
    for (const close of dispose) await close()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  install(rt)
  return { rt, events, path: join(home, 'chat-index.sqlite') }
}

test('v3 marks and content are rebuilt from logs on the first read', async t => {
  const { rt, path } = runtime(t)
  const old = new DatabaseSync(path)
  old.exec(`
    CREATE VIRTUAL TABLE lines USING fts5(text, session UNINDEXED, seq UNINDEXED, time UNINDEXED, who UNINDEXED, tokenize = 'trigram');
    CREATE TABLE marks (session TEXT PRIMARY KEY, through INTEGER NOT NULL, keep INTEGER NOT NULL, sealed INTEGER NOT NULL, turn INTEGER NOT NULL);
    INSERT INTO lines VALUES ('stale', 's1', 0, 0, 'user');
    INSERT INTO marks VALUES ('s1', 11, 1, 1, -1);
    PRAGMA user_version = 3;
  `)
  old.close()
  const latest = await rt.latestOwnChat('b', { limit: 12 })
  assert.equal(latest.length, 12)
  assert.equal(latest[0], '[#0 · 0] User: message 会议 0')
  const db = new DatabaseSync(path)
  try { assert.equal(db.prepare('PRAGMA user_version').get().user_version, 4) } finally { db.close() }
})

test('FTS and indexed history agree, including subsequent catch-up and empty reads', async t => {
  const { rt, events, path } = runtime(t)
  const latest = await rt.latestOwnChat('b', { limit: 12 })
  assert.deepEqual((await rt.aroundOwnChat('b', '#6')).lines, latest)
  for (const query of ['message', '会议', 'message 会议']) {
    assert.deepEqual((await rt.searchOwnChat('b', query, { limit: 12 })).lines, latest)
  }
  assert.deepEqual((await rt.searchOwnChat('b', 'absent')).lines, [])
  assert.deepEqual((await rt.aroundOwnChat('b', '#99')).lines, latest.slice(-6))
  assert.match((await rt.aroundOwnChat('b', 'invalid')).error, /not an anchor/)
  const db = new DatabaseSync(path)
  try {
    db.exec("INSERT INTO lines (lines, rank) VALUES ('integrity-check', 1)")
    assert.equal(db.prepare('SELECT count(*) AS n FROM messages').get().n, 12)
    for (const query of ['message', '会议']) {
      const { sql, args } = termQuery([query], ['s1'], 20)
      assert.equal(db.prepare(sql).all(...args).length, 12)
    }
    const source = readFileSync(new URL('../src/host/chat-index.js', import.meta.url), 'utf8')
    for (const name of ['before', 'from']) {
      const sql = new RegExp(`${name}: db.prepare\\('([^']+)'\\)`).exec(source)?.[1]
      assert.ok(sql)
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('s1', 6, 6).map(row => row.detail).join('\n')
      assert.match(plan, /USING INDEX messages_session_seq/)
      assert.doesNotMatch(plan, /SCAN|TEMP B-TREE/)
    }
    events.push({ seq: 12, time: 12, text: 'message 会议 12' })
    const appended = await rt.latestOwnChat('b', { limit: 13 })
    assert.deepEqual(appended, [...latest, '[#12 · 12] User: message 会议 12'])
    assert.deepEqual((await rt.searchOwnChat('b', 'message', { limit: 13 })).lines, appended)
    db.exec("INSERT INTO lines (lines, rank) VALUES ('integrity-check', 1)")
    assert.equal(db.prepare('SELECT count(*) AS n FROM messages').get().n, 13)
  } finally { db.close() }
  rt.partsOf = () => []
  assert.deepEqual(await rt.latestOwnChat('b'), [])
  assert.deepEqual((await rt.searchOwnChat('b', 'message')).lines, [])
})


test('catch-up indexes native replies when the previous cursor ended inside the turn', async t => {
  const { rt, events } = runtime(t)
  rt.loadAssistantChat = async () => ({ since: 0, nativeSince: 0 })
  rt.historyEntry = historyEntry
  const event = (seq, type, data) => ({ seq, time: seq, type, data })
  const text = text => ({ type: 'text', text })
  const reply = (seq, step, content) => event(seq, 'assistant/message', { turn: 1, step, message: { content } })
  events.splice(0, events.length,
    event(0, 'rabiroute/assistant-mode', { version: 2 }),
    event(1, 'turn/start', { turn: 1 }),
    event(2, 'rabiroute/assistant-native-reply', { turn: 1, step: 1 }),
    event(3, 'user/message', { source: { kind: 'user' }, content: [text('Check fixture')] }),
  )
  assert.deepEqual((await rt.searchOwnChat('b', 'native')).lines, [])
  const tool = { type: 'tool-call', name: 'fixture' }
  events.push(reply(4, 1, [text('Native opening'), tool]), reply(5, 2, [text('Native narration'), tool]),
    reply(6, 3, [text('Native result')]), event(7, 'turn/end', { turn: 1 }))
  const expected = ['[#4 · 4] You: Native opening', '[#6 · 6] You: Native result']
  assert.deepEqual((await rt.searchOwnChat('b', 'native')).lines, expected)
  assert.deepEqual((await rt.searchOwnChat('b', 'native')).lines, expected)
})
