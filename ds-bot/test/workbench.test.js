import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const { outputFiles } = await build({
  stdin: { contents: "export { BotWorkbench, BotConversation } from './src/client/workbench.js'", resolveDir: fileURLToPath(new URL('..', import.meta.url)) },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const effects = []
const h = (type, props, ...children) => ({ type, props: { ...props, children } })
const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports,
  require: name => name === 'react' ? { createContext: initial => { const ctx = { value: initial }; ctx.Provider = ({ value, children }) => { ctx.value = value; return children }; return ctx }, useContext: ctx => ctx.value,
  createElement: h, Fragment: 'fragment', useEffect: effect => effects.push(effect), useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}] }
    : name === 'react-dom' ? { createPortal: node => node } : {},
})
const { BotWorkbench, BotConversation } = module.exports

test('the group goal and activity have distinct sibling keys', () => {
  const tree = BotConversation({
    sessionId: 'room',
    useRoster: select => select({ byId: {}, roomsById: { room: { id: 'room', name: 'Ops' } } }),
    useUi: select => select({ goalCompose: 'room', goalOpen: 'room' }),
    actions: {}, renderFactorySlot: () => 'conversation',
  })
  const children = tree.props.children[0].props.children.filter(Boolean)
  const keys = children.map(child => child.props.key)
  assert.equal(new Set(keys).size, children.length)
})

test('the mounted group goal keeps input across updates and closes locally on Cancel and Escape', async t => {
  const anchors = [join(process.env.DSH_HARNESS, 'packages/client/ui-primitives/package.json'), join(process.env.DSH_HARNESS, 'package.json')].filter(existsSync)
  const load = (name) => {
    let missing
    for (const anchor of anchors) {
      try { return createRequire(anchor)(name) } catch (error) {
        if (error?.code !== 'MODULE_NOT_FOUND' || !error.message.includes(`'${name}'`)) throw error
        missing = error
      }
    }
    throw missing
  }
  const { JSDOM } = createRequire(join(process.env.DSH_HARNESS, 'package.json'))('jsdom')
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' })
  dom.window.matchMedia = () => ({ matches: true })
  dom.window.HTMLElement.prototype.getAnimations = () => []
  const previous = new Map()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  let root, act
  t.after(async () => {
    if (root) await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  const React = load('react')
  const ReactDOM = load('react-dom')
  const { createRoot } = load('react-dom/client')
  act = React.act
  const built = await build({
    stdin: { contents: "export { BotConversation } from './src/client/workbench.js'; export { createSource } from './src/client/sources.js'; export { teamActions } from './src/client/team-actions.js'", resolveDir: fileURLToPath(new URL('..', import.meta.url)) },
    bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
    external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
    plugins: [{ name: 'unrelated-workbench-panels', setup(builder) {
      builder.onLoad({ filter: /[\\/]src[\\/]client[\\/](details-drawer|activity-row|column-resizer)\.js$/ }, args => ({
        contents: args.path.endsWith('details-drawer.js') ? 'export function DetailsDrawer(){return null}'
          : args.path.endsWith('activity-row.js') ? 'export function ActivityIndicator(){return null}; export const reducedMotion=()=>true'
            : 'export function ColumnResizer(){return null}; export function useColumnWidth(){return [320,()=>{}]}', loader: 'js',
      }))
    } }],
  })
  const mounted = { exports: {} }
  runInNewContext(built.outputFiles[0].text, {
    module: mounted, exports: mounted.exports, window: dom.window, document: dom.window.document, setTimeout, clearTimeout, URL, URLSearchParams,
    require: name => name === 'react' ? React : name === 'react-dom' ? ReactDOM : {},
  })
  const { BotConversation: Conversation, createSource, teamActions } = mounted.exports
  const room = { id: 'room', name: 'Ops', admin: 'chief', members: ['chief'] }
  const roster = createSource({ byId: { chief: { id: 'chief', name: 'Chief' } }, roomsById: { room }, prefs: {} })
  const ui = createSource({ goalCompose: 'room', goalOpen: 'room', visits: {} })
  let networkCalls = 0
  const actions = { ...teamActions({
    call: () => { networkCalls++; throw new Error('Goal form close must stay local') }, after: value => value,
    partFor: value => value, roster, ui, live: createSource({}), cards: createSource({}), heldCards: createSource({}), turnClock: createSource({}),
  }), beginVisit() {}, endVisit() {} }
  const sourceHook = source => selector => React.useSyncExternalStore(source.subscribe, () => selector(source.getSnapshot()))
  const props = { sessionId: 'room', useRoster: sourceHook(roster), useUi: sourceHook(ui), useWork: () => '', actions, renderFactorySlot: () => React.createElement('div') }
  root = createRoot(dom.window.document.getElementById('root'))
  await act(async () => root.render(React.createElement(Conversation, props)))
  const input = dom.window.document.querySelector('.bt-goal-input')
  assert.ok(input)
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, 'Only check this form')
    input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Only check this form' }))
  })
  await act(async () => {
    ui.set(state => ({ ...state, visits: { room: { entered: 1 } } }))
    roster.set(state => ({ ...state, revision: 2 }))
  })
  assert.equal(dom.window.document.querySelector('.bt-goal-input') === input, true, 'The same goal input survives source updates')
  assert.equal(input.value, 'Only check this form')
  const button = text => [...dom.window.document.querySelectorAll('button')].find(node => node.textContent === text)
  assert.equal(button('Start').disabled, false)
  await act(async () => button('Cancel').click())
  assert.equal(ui.getSnapshot().goalCompose, null)
  assert.equal(ui.getSnapshot().goalOpen, null)
  assert.equal(dom.window.document.querySelector('.bt-goal-compose') === null, true, 'Cancel removes the goal form')
  await act(async () => actions.composeGoal('room'))
  const reopened = dom.window.document.querySelector('.bt-goal-input')
  assert.ok(reopened)
  assert.equal(reopened.value, '')
  await act(async () => reopened.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  assert.equal(ui.getSnapshot().goalCompose, null)
  assert.equal(ui.getSnapshot().goalOpen, null)
  assert.equal(dom.window.document.querySelector('.bt-goal-compose') === null, true, 'Escape removes the goal form')
  assert.equal(networkCalls, 0)
})

test('the team list precedes the conversation inside the plugin panel', () => {
  const rendered = []
  const tree = BotWorkbench({ renderSlot: name => { rendered.push(name); return name } })
  assert.equal(tree.props['data-dsh-private-ui'], 'ds-bot')
  assert.deepEqual(rendered, ['bot.team', 'bot.conversation'])
})

test('the selected Bot uses the shared conversation factory and its existing details', () => {
  const calls = []
  const bot = { id: 'bot-one', sessionId: 'part-two', name: 'Chief' }
  const tree = BotConversation({
    sessionId: 'part-two',
    useRoster: select => select({ byId: { 'bot-one': bot }, roomsById: {} }),
    useUi: select => select({ details: 'bot-one', renaming: true }),
    actions: {},
    renderFactorySlot: (name, props) => { calls.push({ name, ...props }); return 'shared conversation' },
  })
  assert.deepEqual(calls, [{ name: 'conversation.content', variant: 'embedded', phase: 'active', hero: false, busyEnterOverride: 'steer' }])
  const [chat, details] = tree.props.children
  assert.equal(chat.props.className, 'bt-chat-column')
  assert.equal(chat.props.children[1].type.name, 'ActivityIndicator')
  assert.equal(chat.props.children[1].props.sessionId, 'part-two')
  assert.equal(details.props.className, 'bt-info-column')
  assert.equal(details.props.children[0].props.sessionId, 'bot-one')
  assert.equal(details.props.children[0].props.startRenaming, true)
})

test('a group chat requests immediate delivery', () => {
  const calls = []
  BotConversation({ sessionId: 'room', useRoster: select => select({ byId: {}, roomsById: { room: { id: 'room', name: 'Team' } } }), useUi: select => select({}), actions: {}, renderFactorySlot: (_name, props) => { calls.push(props); return 'chat' } })
  assert.equal(calls[0].busyEnterOverride, 'steer')
})

test('an unowned session has no misleading Bot details', () => {
  const calls = []
  const tree = BotConversation({ sessionId: 'outside', useRoster: select => select({ byId: {}, roomsById: {} }), useUi: select => select({}), actions: {}, renderFactorySlot: (_name, props) => { calls.push(props); return 'chat' } })
  assert.equal(calls[0].busyEnterOverride, undefined)
  assert.equal(tree.props.children[1], null)
})


test('the panel keeps visit readback and the selected Bot input hint without a floating header', () => {
  effects.length = 0
  const log = []
  const tree = BotConversation({
    sessionId: 'chief', useRoster: select => select({ byId: { chief: { id: 'chief', name: 'Chief' } }, roomsById: {} }),
    useUi: select => select({}), renderFactorySlot: () => 'chat',
    actions: { beginVisit: id => log.push(['begin', id]), endVisit: id => log.push(['end', id]) },
  })
  const cleanups = effects.map(effect => effect()).filter(Boolean)
  assert.deepEqual(log, [['begin', 'chief']])
  assert.match(tree.props.children[0].props.style['--bt-placeholder'], /Chief/)
  for (const dispose of cleanups) dispose()
  assert.deepEqual(log, [['begin', 'chief'], ['end', 'chief']])
})


test('switching the selected Bot gives its details editor a separate lifecycle', () => {
  const roster = { byId: { first: { id: 'first', name: 'First' }, second: { id: 'second', name: 'Second' } }, roomsById: {} }
  const render = sessionId => BotConversation({ sessionId, useRoster: select => select(roster), useUi: select => select({}), actions: {}, renderFactorySlot: () => 'chat' })
  const first = render('first').props.children[1].props.children[0]
  const second = render('second').props.children[1].props.children[0]
  assert.notEqual(first.props.key, second.props.key)
})


test('the embedded group conversation renders its goal editor in the chat column', () => {
  const room = { id: 'room', name: 'Team', members: [] }
  const tree = BotConversation({ sessionId: room.id,
    useRoster: select => select({ byId: {}, roomsById: { room } }),
    useUi: select => select({ goalCompose: room.id, goalOpen: room.id }), actions: {},
    renderFactorySlot: () => 'shared conversation',
  })
  const [island, conversation] = tree.props.children[0].props.children
  assert.equal(island.type.name, 'GoalIsland')
  assert.equal(island.props.room.id, room.id)
  assert.equal(island.props.composing, true)
  assert.equal(island.props.open, true)
  assert.equal(island.props.view, null)
  assert.equal(conversation.type, 'fragment')
  assert.equal(conversation.props.key, 'conversation')
  assert.equal(conversation.props.children[0], 'shared conversation')
})

test('a later group part keeps goal state and room work on the original group id', () => {
  effects.length = 0
  const visits = [], factory = []
  const room = { id: 'original', sessionId: 'part-two', name: 'Team', members: [] }
  const roomWork = [{ botId: 'chief' }]
  const tree = BotConversation({ sessionId: 'part-two',
    useRoster: select => select({ byId: {}, roomsById: { original: room, 'part-two': room } }),
    useUi: select => select({ goalCompose: 'original', goalOpen: 'original' }),
    useWork: select => select({ rooms: { original: roomWork, 'part-two': [{ botId: 'wrong-room' }] } }),
    actions: { beginVisit: id => visits.push(['begin', id]), endVisit: id => visits.push(['end', id]) },
    renderFactorySlot: (name, props) => { factory.push({ name, ...props }); return 'shared conversation' },
  })
  const [island, conversation, activity] = tree.props.children[0].props.children
  assert.equal(island.type.name, 'GoalIsland')
  assert.equal(island.props.room.id, 'original')
  assert.equal(island.props.composing, true)
  assert.equal(island.props.open, true)
  assert.equal(JSON.stringify(island.props.roomWork), JSON.stringify(roomWork))
  assert.equal(conversation.props.key, 'conversation')
  assert.equal(activity.props.sessionId, 'part-two')
  assert.equal(tree.props.children[1].props.children[0].props.sessionId, 'original')
  assert.deepEqual(factory, [{ name: 'conversation.content', variant: 'embedded', phase: 'active', hero: false, busyEnterOverride: 'steer' }])
  const cleanups = effects.map(effect => effect()).filter(Boolean)
  for (const cleanup of cleanups) cleanup()
  assert.deepEqual(visits, [['begin', 'part-two'], ['end', 'part-two']])
})


test('the embedded conversation keeps its React identity when the goal editor opens', () => {
  const room = { id: 'room', name: 'Team', members: [] }
  const render = composing => BotConversation({ sessionId: room.id,
    useRoster: select => select({ byId: {}, roomsById: { room } }),
    useUi: select => select(composing ? { goalCompose: room.id } : {}), actions: {},
    renderFactorySlot: () => h('native-composer', { draft: 'keep this draft' }),
  }).props.children[0].props.children.find(node => node?.props?.key === 'conversation')
  const closed = render(false), open = render(true)
  assert.equal(closed.type, open.type)
  assert.equal(closed.props.key, open.props.key)
  assert.equal(open.props.children[0].props.draft, 'keep this draft')
})
