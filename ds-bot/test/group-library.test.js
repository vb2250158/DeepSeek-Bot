import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, symlink, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { install } from '../src/host/group-library.js'

async function start(t, config = {}) {
  const home = await mkdtemp(join(tmpdir(), 'ds-bot-group-library-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const rooms = { first: { id: 'first', name: 'First' }, second: { id: 'second', name: 'Second' } }
  const tools = new Map()
  let readOnly
  const rt = { home, config, roomOf: id => rooms[id], readOnly: () => readOnly, warn() {},
    ctx: { tools: { register: tool => tools.set(tool.name, tool) } }, load: async () => {}, selfOf: id => id,
    botOf: id => id === 'member' ? { id } : undefined, pickRoom: name => ({ room: Object.values(rooms).find(room => room.name === name) }) }
  install(rt)
  return { rt, home, rooms, tools, lock: () => { readOnly = 'Another Host owns this team' },
    call: (endpoint, body = {}) => rt.groupLibraryEndpoint(`group-library-${endpoint}`, { roomId: 'first', ...body }) }
}

test('group folders survive renaming and reloading without sharing documents', async t => {
  const { rt, home, rooms, call } = await start(t)
  await rt.ensureGroupLibrary('first')
  await call('add', { name: '计划.md', text: '# 计划\n验收三个标签\n' })
  assert.equal(await readFile(join(home, 'groups/first/library/计划.md'), 'utf8'), '# 计划\n验收三个标签\n')
  rooms.first.name = 'Renamed'
  install(rt)
  assert.equal((await call('read', { name: '计划.md' })).text, '# 计划\n验收三个标签\n')
  assert.deepEqual((await call('list')).files, [{ name: '计划.md' }])
  assert.deepEqual((await call('list', { roomId: 'second' })).files, [])
  await assert.rejects(call('read', { roomId: 'second', name: '计划.md' }), { code: 'ENOENT' })
})

test('concurrent additions preserve the first document and reject duplicate names', async t => {
  const { call } = await start(t)
  const results = await Promise.allSettled(['one', 'two'].map(text => call('add', { name: 'notes.txt', text })))
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.match(results.find(result => result.status === 'rejected').reason.message, /already exists/)
  assert.ok(['one', 'two'].includes((await call('read', { name: 'notes.txt' })).text))
})

test('library pages are bounded, stable and skip links and binary files', async t => {
  const { call, rt } = await start(t, { groupLibraryPageSize: 2 })
  for (const name of ['c.md', 'a.md', 'b.md']) await call('add', { name, text: name })
  await writeFile(join(rt.groupLibraryPath('first'), 'image.png'), 'binary')
  const first = await call('list')
  assert.deepEqual(first.files, [{ name: 'a.md' }, { name: 'b.md' }])
  assert.equal(first.nextCursor, 'b.md')
  const next = await call('list', { cursor: first.nextCursor })
  assert.deepEqual(next.files, [{ name: 'c.md' }])
  assert.equal(next.nextCursor, null)
})

test('unknown groups, traversal, device names, oversize and binary content are refused', async t => {
  const { call } = await start(t, { groupLibraryMaxBytes: 8 })
  for (const name of ['../outside.md', '..\\outside.md', '/outside.md', 'NUL.txt', 'C:outside.md', 'file.exe', 'bad\n.md']) {
    await assert.rejects(call('add', { name, text: 'test' }), { code: 'bot/invalid' })
  }
  await assert.rejects(call('list', { roomId: '../first' }), /Unknown group/)
  await assert.rejects(call('list', { roomId: 'missing' }), /Unknown group/)
  await assert.rejects(call('add', { name: 'big.md', text: 'too large' }), /file limit/)
  await assert.rejects(call('add', { name: 'bin.md', text: '\0' }), /UTF-8/)
  await assert.rejects(call('list', { cursor: 42 }), /cursor/)
})

test('linked group directories and linked documents cannot expose other files', async t => {
  const { rt, call, home } = await start(t)
  const outside = join(home, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'private.md'), 'private')
  await rt.ensureGroupLibrary('first')
  await symlink(outside, join(rt.groupLibraryPath('first'), 'linked'), 'junction')
  await symlink(outside, join(home, 'groups/second'), 'junction')
  await assert.rejects(call('list', { roomId: 'second' }), /must not contain links/)
  assert.deepEqual((await call('list')).files, [])
})

test('read-only Hosts list existing files and refuse additions', async t => {
  const { call, lock } = await start(t)
  await call('add', { name: 'note.md', text: 'saved' })
  lock()
  assert.equal((await call('read', { name: 'note.md' })).text, 'saved')
  assert.equal((await call('list')).files.length, 1)
  await assert.rejects(call('add', { name: 'new.md', text: 'not saved' }), /Another Host/)
})

test('files changed outside the app still obey text and size limits on read', async t => {
  const { rt, call } = await start(t, { groupLibraryMaxBytes: 8 })
  await rt.ensureGroupLibrary('first')
  await writeFile(join(rt.groupLibraryPath('first'), 'bad.md'), Buffer.from([0xff, 0xfe]))
  await writeFile(join(rt.groupLibraryPath('first'), 'big.md'), 'too large')
  await assert.rejects(call('read', { name: 'bad.md' }), /UTF-8 text/)
  await assert.rejects(call('read', { name: 'big.md' }), /file limit/)
})

test('the library tool returns recorded file data only to team Bots', async t => {
  const { call, tools } = await start(t)
  await call('add', { name: 'guide.md', text: 'Reference only' })
  const tool = tools.get('read_group_library')
  const result = await tool.execute({ group: 'First' }, { agent: { id: 'member' } })
  assert.deepEqual(JSON.parse(result), { files: [{ name: 'guide.md' }], nextCursor: null })
  assert.equal(JSON.parse(await tool.execute({ group: 'First', file: 'guide.md' }, { agent: { id: 'member' } })).text, 'Reference only')
  assert.match(await tool.execute({ group: 'First' }, { agent: { id: 'outsider' } }), /Only Bots/)
})
