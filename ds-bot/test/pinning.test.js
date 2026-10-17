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
function sidebar(team, actions = {}) {
  return TeamSidebar({
    wide: true, useRoster: select => select(team), useUi: select => select({ unread: {} }),
    useSessions: select => select({ ids: [], byId: {} }), useSessionStatus: select => select(new Map()), useRegistry() {}, actions,
  })
}

test('the former Main Bot has the same pin menu as any other Bot', async () => {
  const changed = []
  const tree = ContextMenu({ menu: { kind: 'bot', id: 'former-main', x: 0, y: 0 }, roster: roster(), actions: {
    closeMenu() {}, setFlags: async (id, flags) => changed.push([id, flags.pinned]),
  } })
  const buttons = nodes(tree, node => node.props.role === 'menuitem')
  assert.ok(!buttons.some(node => node.children.some(text => typeof text === 'string' && text.includes('Main Bot'))))
  await buttons.find(node => node.children.includes('Pin')).props.onClick()
  assert.deepEqual(changed, [['former-main', true]])
})

test('only pinned conversations become tiles; no Bot is implicitly first', () => {
  const team = roster()
  assert.equal(nodes(sidebar(team), node => node.props.entry !== undefined).length, 0)
  team.bots[1].pinned = true
  const tree = sidebar(team)
  const tiles = nodes(tree, node => node.props.entry !== undefined)
  assert.equal(tiles.length, 1)
  assert.equal(tiles[0].props.entry.item.id, 'other')
  const rows = nodes(tree, node => node.props.bot !== undefined && node.props.actions !== undefined)
  assert.deepEqual(rows.map(node => node.props.bot.id), ['former-main'])
})

test('dragging a team row into the pin region persists through the same action as the menu', () => {
  const changed = []
  const tree = sidebar(roster(), { setFlags: async (id, flags) => changed.push([id, flags.pinned]) })
  const target = nodes(tree, node => node.props['aria-label'] === 'Pinned chats')[0]
  target.props.ref.current = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 100 }) }
  const event = (x, y) => ({ clientX: x, clientY: y, pointerId: 1, button: 0, preventDefault() {},
    target: { closest: () => ({ dataset: { botId: 'other' } }) },
    currentTarget: { setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} },
  })
  tree.props.onPointerUp(event(50, 40))
  assert.equal(changed.length, 0)
  tree.props.onPointerDown(event(50, 200))
  tree.props.onPointerMove(event(50, 40))
  tree.props.onPointerUp(event(50, 40))
  assert.deepEqual(changed, [['other', true]])
  let suppressed = false
  tree.props.onClickCapture({ preventDefault() { suppressed = true }, stopPropagation() {} })
  assert.equal(suppressed, true)
  tree.props.onPointerDown(event(50, 200))
  tree.props.onPointerMove(event(50, 40))
  tree.props.onPointerCancel()
  tree.props.onPointerUp(event(50, 40))
  assert.equal(changed.length, 1, 'cancelled drags never write')
})
