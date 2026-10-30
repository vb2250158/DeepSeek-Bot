import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/member-status.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports,
  require: (name) => {
    const platform = {
      react: { createContext: (initial) => { const ctx = { value: initial }; ctx.Provider = ({ value, children }) => { ctx.value = value; return children }; return ctx }, useContext: ctx => ctx.value, useMemo: make => make(), useCallback: fn => fn, useId: () => 'dv-id', useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }), useState: initial => [initial, () => {}], useEffect: () => {}, useRef: initial => ({ current: initial }), useLayoutEffect: () => {}, Fragment: 'fragment' },
      'react-dom': {},
      '@deepseek-ai/dsh-client-ui-primitives': {},
    }
    if (!(name in platform)) throw new Error(`no platform module ${name}`)
    return platform[name]
  },
})
const { busyMembers, summaryText, splitBusy, MemberDock, groupWorkingText, MemberState, StopMemberWork, StopRoomWork, memberWork } = module.exports
// Values from the bundle's realm compare by content only.
const plain = value => JSON.parse(JSON.stringify(value))
// Renders the dock's own parts of an element tree, and lists its rows' labels.
const expand = (node) => {
  if (Array.isArray(node)) return node.flatMap(expand)
  if (node === null || typeof node !== 'object') return node
  if (['WorkRow', 'SummaryLine'].includes(node.type?.name)) return expand(node.type({ ...node.props, children: node.children }))
  return { ...node, children: node.children.map(expand) }
}
const rowLabels = (node) => {
  if (Array.isArray(node)) return node.flatMap(rowLabels)
  if (node === null || typeof node !== 'object') return []
  return [...(node.props.className === 'bt-mw-row' ? [node.props['aria-label']] : []), ...rowLabels(node.children)]
}

test('the members line names who waits for an approval first, then who is at work', () => {
  const names = { a: 'Anvil', b: 'Flint', c: 'Prism', d: 'Quill', e: 'King', f: 'Comet' }
  const roster = { byId: Object.fromEntries(Object.entries(names).map(([id, name]) => [id, { id, name }])) }
  const room = { members: ['e', 'd', 'a', 'b', 'c', 'f'] }
  const work = {
    bots: { d: { since: 1, tool: 'edit' }, a: { since: 1, tool: 'pwsh' }, f: { since: 1 } },
    approvals: [{ botId: 'a' }, { botId: 'b' }, { botId: 'c' }],
  }
  const busy = busyMembers(room, work, roster)
  assert.deepEqual(plain(busy.map(entry => [entry.bot.name, entry.state])), [['Anvil', 'ask'], ['Flint', 'ask'], ['Prism', 'ask'], ['Quill', 'work'], ['Comet', 'work']])
  assert.deepEqual(plain(summaryText(busy)), { waiting: 'Anvil, Flint and 1 more are waiting for your approval', doing: 'Quill · Writing changes… +1' })
  assert.deepEqual(plain(summaryText(busy.slice(1, 3))), { waiting: 'Flint and Prism are waiting for your approval', doing: '' })
  assert.deepEqual(plain(summaryText(busy.slice(4))), { waiting: '', doing: 'Comet · Thinking about it…' })
  assert.equal(busyMembers(room, { bots: {}, approvals: [] }, roster).length, 0)
})

const names = { a: 'Anvil', b: 'Flint', c: 'Prism', d: 'Quill' }
const team = {
  byId: Object.fromEntries(Object.entries(names).map(([id, name]) => [id, { id, name }])),
  roomsById: { r1: { id: 'r1', name: 'Ops', members: ['a', 'b', 'c', 'd'] }, r2: { id: 'r2', name: 'Docs', members: ['a', 'b'] } },
}

// #156: a member waiting for an approval keeps its work here, so Stop stays.
test('a member waiting for approval in this group can still be stopped', async () => {
  const stopped = []
  const room = team.roomsById.r1
  const entry = busyMembers(room, { rooms: { r1: [{ botId: 'a', since: 1 }] }, approvals: [{ botId: 'a', roomId: 'r1', at: 1 }] }, team)[0]
  assert.equal(entry.state, 'ask')
  const node = StopMemberWork({ entry, bot: team.byId.a, room, actions: { stopMemberWork: (...args) => stopped.push(args) } })
  assert.ok(node, 'waiting for approval must not hide Stop')
  node.props.onClick()
  await Promise.resolve()
  assert.deepEqual(stopped, [['r1', 'a']])
})

test('an approval for work elsewhere never offers to stop work in this group', () => {
  const room = team.roomsById.r1
  const entry = busyMembers(room, { rooms: { r2: [{ botId: 'a', since: 1 }] }, approvals: [{ botId: 'a', roomId: 'r2', at: 1 }] }, team)[0]
  assert.equal(StopMemberWork({ entry, bot: team.byId.a, room, actions: {} }), null)
  // Work here stays stoppable while it runs.
  const working = busyMembers(room, { rooms: { r1: [{ botId: 'a', since: 1 }] }, approvals: [] }, team)[0]
  assert.ok(StopMemberWork({ entry: working, bot: team.byId.a, room, actions: {} }))
})

test('a failed stop is reported and never answers the approval', async () => {
  const reported = []
  const room = team.roomsById.r1
  const entry = busyMembers(room, { rooms: { r1: [{ botId: 'a', since: 1 }] }, approvals: [{ botId: 'a', roomId: 'r1', at: 1 }] }, team)[0]
  const node = StopMemberWork({ entry, bot: team.byId.a, room, actions: {
    stopMemberWork: () => Promise.reject(new Error('connection lost')),
    reportError: (error, action) => reported.push([error.message, action]),
  } })
  assert.ok(node)
  node.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(reported, [['connection lost', 'stop']])
})
// #592: DSH's own stop reaches only the round; a member the round moved on from kept working.
test('the stop button of a group\'s details stops all work there, and shows only while work is here', async () => {
  const stopped = []
  const room = team.roomsById.r1
  const actions = { stopRoomWork: id => stopped.push(id) }
  const shown = work => StopRoomWork({ room, entries: memberWork(room, work), actions })
  const button = shown({ bots: {}, rooms: { r1: [{ botId: 'a', since: 1, tool: 'pwsh' }] }, approvals: [] })
  assert.equal(button.props['aria-label'], 'Stop all work in this group')
  button.props.onClick()
  await Promise.resolve()
  assert.deepEqual(stopped, ['r1'])
  // Members busy only in their own chats or in another group have nothing here to stop.
  assert.equal(shown({ bots: { a: { since: 1, tool: 'pwsh' }, b: { since: 1, roomId: 'r2' } }, rooms: { r2: [{ botId: 'b', since: 1 }] }, approvals: [] }), null)
  assert.equal(shown({ bots: {}, rooms: { r2: [{ botId: 'a', since: 1 }] }, approvals: [{ botId: 'a', roomId: 'r2', at: 1 }] }), null)
  // A turn waiting for an approval here still holds its work.
  assert.ok(shown({ bots: {}, rooms: { r1: [{ botId: 'a', since: 1 }] }, approvals: [{ botId: 'a', roomId: 'r1', at: 1 }] }))
})

test('a failed stop of a group\'s work is reported', async () => {
  const reported = []
  const room = team.roomsById.r1
  const button = StopRoomWork({ room, entries: memberWork(room, { bots: {}, rooms: { r1: [{ botId: 'a', since: 1 }] }, approvals: [] }), actions: {
    stopRoomWork: () => Promise.reject(new Error('connection lost')),
    reportError: (error, action) => reported.push([error.message, action]),
  } })
  button.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(reported, [['connection lost', 'stop']])
})
const dock = (sessionId, work) => expand(MemberDock({ sessionId, useRoster: pick => pick(team), useWork: pick => pick(work), actions: {} }))

test('a member at work in the group gets a row; the speaker, work elsewhere and approvals do not', () => {
  const work = {
    // Anvil runs in its own chat too; its work here wins.
    bots: { a: { since: 1, tool: 'pwsh' }, b: { since: 1, roomId: 'r2', tool: 'edit' } },
    rooms: { r1: [{ botId: 'a', since: 1, tool: 'write' }, { botId: 'd', since: 1, speaking: true }], r2: [{ botId: 'b', since: 1, tool: 'edit' }] },
    approvals: [{ botId: 'c', roomId: 'r1' }],
  }
  const busy = busyMembers(team.roomsById.r1, work, team)
  const { rows, rest } = splitBusy(busy)
  assert.deepEqual(plain(rows.map(entry => [entry.bot.name, entry.doing.tool, entry.doing.roomId])), [['Anvil', 'write', 'r1']])
  assert.deepEqual(plain(rest.map(entry => [entry.bot.name, entry.state])), [['Prism', 'ask'], ['Flint', 'work']])
  assert.deepEqual(rowLabels(dock('r1', work)), ['Anvil and Quill working…'])
  assert.equal(groupWorkingText(busy), 'Anvil and Quill working…')
  assert.equal(busyMembers(team.roomsById.r2, work, team).length, 2)
})

test('a Bot\'s own chat shows the groups it is at work in, unless its own chat runs', () => {
  const away = { bots: { a: { since: 1, roomId: 'r1', tool: 'pwsh' } }, rooms: { r1: [{ botId: 'a', since: 1, tool: 'pwsh' }], r2: [{ botId: 'a', since: 1 }] }, approvals: [] }
  assert.deepEqual(rowLabels(dock('a', away)), ['in Ops · Running shell commands…', 'in Docs · Thinking about it…'])
  assert.deepEqual(rowLabels(dock('a', { ...away, bots: { a: { since: 1 } } })), [])
  assert.equal(dock('b', away), null)
})

test('a row says what a member does in its call\'s own words, and that it moves to a fresh conversation', () => {
  const work = {
    bots: {},
    rooms: { r1: [
      { botId: 'a', since: 1, tool: 'pwsh', note: 'Download Ghidra 12.1.4 and check its hash.' },
      { botId: 'b', since: 1, tool: 'read', target: 'dump.py' },
      { botId: 'c', since: 1, switching: true },
      { botId: 'd', since: 1, tool: 'pwsh', said: '解压 Ghidra，顺便写脚本。', note: 'Expand-Archive' },
    ] },
    approvals: [],
  }
  assert.match(JSON.stringify(dock('r1', work)), /Anvil, Flint, Prism, and Quill working…/)
})

test('group feedback removes finished members and excludes work elsewhere and approval waits', () => {
  const room = team.roomsById.r1
  const work = { bots: { b: { roomId: 'r2' } }, rooms: { r1: [{ botId: 'a' }, { botId: 'd', speaking: true }] }, approvals: [{ botId: 'c' }] }
  assert.equal(groupWorkingText(busyMembers(room, work, team)), 'Anvil and Quill working…')
  work.rooms.r1.pop()
  assert.equal(groupWorkingText(busyMembers(room, work, team)), 'Anvil working…')
  work.rooms.r1 = []
  assert.equal(groupWorkingText(busyMembers(room, work, team)), '')
})

test('a member\'s line runs a clock from its turn\'s start or its approval\'s', () => {
  // The clock renders as `{since}` here; it ticks on its own.
  const flat = node => (node === null || node === '' ? '' : typeof node === 'string' ? node
    : node.props.at !== undefined ? `{${node.props.at}}` : node.children.map(flat).join(''))
  const stateText = entry => flat(MemberState({ entry, bot: { id: 'a', name: 'Anvil' }, room: { id: 'r1' }, roster: team }))
  assert.equal(stateText({ state: 'work', doing: { roomId: 'r1', tool: 'pwsh', since: 1_000 } }), 'Running shell commands…{1000}')
  assert.equal(stateText({ state: 'work', doing: { roomId: 'r2', tool: 'pwsh', since: 1_000 } }), 'Running shell commands… in Docs{1000}')
  assert.equal(stateText({ state: 'ask', approvals: [{ at: 2_000 }] }), 'Waiting for your approval{2000}')
  assert.equal(flat(MemberState({ entry: { state: 'idle' }, bot: { id: 'a', name: 'Anvil', role: 'Writer' }, room: { id: 'r1' }, roster: team })), 'Writer')
})
