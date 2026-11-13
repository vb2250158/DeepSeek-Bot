import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { install as installGroups } from '../src/host/groups.js'
import { install as installLedger, parseBook } from '../src/host/ledger.js'
import { fakeContext } from './fake-ctx.js'

function legacyGroup(t, { whole, oldLog } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-legacy-group-'))
  const line = { seq: 1, who: 'Chief', botId: 'a', text: 'prefix', length: 9000, time: 1 }
  const room = { id: 'r1', name: 'Ops', members: ['a'], seq: 1, seen: {}, log: [line] }
  const ctx = fakeContext()
  const rt = { home, ctx, config: {}, state: {}, teamTools: [], roomProgress: new Map(), live: new Map(),
    roomOf: id => id === room.id ? room : undefined, botOf: id => id === 'a' ? { id, name: 'Chief' } : undefined,
    selfOf: id => id, pickRoom: () => ({ room }), load: async () => {}, warn() {} }
  const sidecar = join(home, 'group-lines', room.id, '1.txt')
  const log = join(home, 'group-logs', 'r1.jsonl')
  if (whole !== undefined) { mkdirSync(join(home, 'group-lines', room.id), { recursive: true }); writeFileSync(sidecar, whole) }
  if (oldLog !== undefined) { mkdirSync(join(home, 'group-logs'), { recursive: true }); writeFileSync(log, `${JSON.stringify(oldLog)}\n`) }
  installLedger(rt)
  installGroups(rt)
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  const read = args => rt.teamTools.find(tool => tool.name === 'read_group_chat').execute({ group: 'Ops', ...args }, { agent: { id: 'a' } })
  return { rt, room, line, home, sidecar, log, read }
}

test('real group importer preserves a known prefix when both whole-text sources are missing', async t => {
  const { rt, room, line, home, read } = legacyGroup(t)
  const imported = await rt.groupLine('r1', 1)
  assert.deepEqual(imported, line)
  assert.equal(imported.length, 9000)
  assert.match(await read({ seq: 1 }), /prefix… \(cut; 9000 characters in all, the rest was not kept\)/)
  assert.match(await read({}), /the rest was not kept/)
  room.log = []
  assert.match(await read({ seq: 1 }), /the rest was not kept/)
  const persisted = parseBook(readFileSync(join(home, 'ledger', 'group-r1.jsonl'), 'utf8'))
  assert.deepEqual(persisted, [line])
})

test('real group importer recovers the whole group-lines text and keeps the original source', async t => {
  const whole = 'W'.repeat(9000)
  const { rt, line, sidecar, read } = legacyGroup(t, { whole })
  const imported = await rt.groupLine('r1', 1)
  assert.equal(imported.text, whole)
  assert.equal(imported.length, undefined)
  assert.ok((await read({ seq: 1 })).includes(whole))
  assert.equal(readFileSync(sidecar, 'utf8'), whole)
  assert.equal(line.text, 'prefix')
  assert.equal(line.length, 9000)
})

test('real group importer lets the old group-log replace the same seq with or without a sidecar', async t => {
  const oldLog = { seq: 1, who: 'Chief', botId: 'a', text: 'L'.repeat(9000), time: 2 }
  for (const whole of [undefined, 'W'.repeat(9000)]) {
    const { rt, log, sidecar, read } = legacyGroup(t, { whole, oldLog })
    assert.deepEqual(await rt.groupLine('r1', 1), oldLog)
    assert.ok((await read({ seq: 1 })).includes(oldLog.text))
    assert.deepEqual(parseBook(readFileSync(log, 'utf8')), [oldLog])
    assert.equal(existsSync(sidecar), whole !== undefined)
  }
})
