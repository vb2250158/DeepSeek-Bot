import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'

async function clientModule(name) {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL(`../src/client/${name}.js`, import.meta.url))],
    bundle: true, format: 'cjs', platform: 'node', write: false,
    external: ['react', 'react-dom', '@deepseek-ai/*'],
  })
  const module = { exports: {} }
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, console,
    require: name => name === 'react' ? {
      createContext: initial => { const ctx = { value: initial }; ctx.Provider = ({ value, children }) => { ctx.value = value; return children }; return ctx }, useContext: ctx => ctx.value,
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
      useState: initial => [initial, () => {}], useRef: current => ({ current }),
      useEffect() {}, useLayoutEffect() {}, useMemo: make => make(), useCallback: fn => fn,
    } : name === 'react-dom' ? { createPortal: node => node } : {},
  })
  return module.exports
}
const { TeamSidebar } = await clientModule('sidebar')
const { ContextMenu } = await clientModule('context-menu')
const nodes = (tree, match) => !tree || typeof tree !== 'object' ? [] : [
  ...(match(tree) ? [tree] : []), ...(tree.children ?? []).flatMap(child => nodes(child, match)),
]
const roster = () => {
  const bots = [{ id: 'former-main', name: 'First', createdAt: 1 }, { id: 'other', name: 'Other', createdAt: 2 }]
  return { bots, rooms: [], agents: [], mainBotId: 'former-main', mainBotIds: ['former-main'], byId: Object.fromEntries(bots.map(bot => [bot.id, bot])), roomsById: {}, exchangeTurns: {}, prefs: {}, ready: true }
}
function sidebar(team, { wide = true, unread = {}, sessions = {} } = {}) {
  return TeamSidebar({
    wide, useRoster: select => select(team), useUi: select => select({ unread }),
    useSessions: select => select({ ids: Object.keys(sessions), byId: sessions }), useSessionStatus: select => select(new Map()),
    useSessionRetainInfo: (_id, select) => select(undefined), useActivity: select => select({}), useRegistry() {}, actions: {},
  })
}

test('the former Main Bot has the same pin menu as any other Bot', async () => {
  const changed = []
  const tree = ContextMenu({ menu: { kind: 'bot', id: 'former-main', x: 0, y: 0 }, roster: roster(), actions: {
    closeMenu() {}, setFlags: async (id, flags) => changed.push([id, flags.pinned]),
  } })
  const buttons = nodes(tree, node => node.props.role === 'menuitem')
  assert.ok(!buttons.some(node => node.children.some(text => typeof text === 'string' && text.includes('Main Bot'))))
  await buttons.find(node => JSON.stringify(node.children).includes('Pin')).props.onClick()
  assert.deepEqual(changed, [['former-main', true]])
})

test('pinned chats use the normal rows, retain their saved order, and precede recent chats', () => {
  const team = roster()
  team.sections = [{ id: 'work', name: 'Work', collapsed: true }]
  Object.assign(team.bots[1], { pinned: true, pinnedAt: 10, lastAt: 1500 })
  team.rooms.push({ id: 'room', name: 'Team', sectionId: 'work', members: [], createdAt: 3, pinned: true, pinOrder: 0, lastAt: 1000, preview: 'Group message' })
  team.agents.push({ id: 'agent', name: 'DSH Agent', createdAt: 4, pinned: true, pinnedAt: 5, sessions: [] })
  const listRows = (tree) => nodes(nodes(tree, node => node.props.className === 'bt-list')[0],
    node => node.props.bot !== undefined || node.props.room !== undefined || node.props.agent !== undefined)
  const sessions = { other: { updatedAt: 2000, projectionValues: { turnOutline: [{ turn: 1, response: 'Bot message' }] } } }
  const rows = listRows(sidebar(team, { sessions }))
  assert.deepEqual(rows.map(row => (row.props.bot ?? row.props.room ?? row.props.agent).id), ['room', 'other', 'agent', 'former-main'])

  for (const [index, preview] of [[0, 'Group message'], [1, 'Bot message']]) {
    const row = rows[index].type(rows[index].props)
    assert.equal(row.props.className, 'bt-row')
    assert.match(row.props['aria-label'], /Pinned/)
    assert.equal(nodes(row, node => node.props.className === 'bt-row-preview')[0].children[0], preview)
    assert.equal(nodes(row, node => node.type === 'time')[0].props.dateTime, new Date(index === 0 ? 1000 : 1500).toISOString())
  }
  assert.match(rows[2].type(rows[2].props).children[0].props['aria-label'], /Pinned/)
  const railRoom = listRows(sidebar(team, { wide: false, unread: { room: true } }))[0]
  const rail = railRoom.type(railRoom.props)
  assert.equal(rail.props.className, 'bt-row')
  assert.match(rail.props['aria-label'], /Unread activity/)
  assert.equal(nodes(rail, node => node.props.className === 'bt-dot').length, 1)

  team.rooms[0].pinned = false
  const unpinned = sidebar(team)
  assert.deepEqual(listRows(unpinned).map(row => (row.props.bot ?? row.props.agent).id), ['other', 'agent', 'former-main'])
  const section = nodes(unpinned, node => node.props.section?.id === 'work')[0]
  assert.equal(section.props.entries[0].item.id, 'room')
})
