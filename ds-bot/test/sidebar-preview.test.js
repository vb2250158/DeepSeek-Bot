import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))

// Render sidebar previews with a minimal React stand-in, as the tool-cell tests do.
const { outputFiles } = await build({
  stdin: {
    contents: "export { TeamSidebar } from './src/client/sidebar.js'",
    resolveDir: PLUGIN,
  },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const react = {
  createContext: initial => { const ctx = { value: initial }; ctx.Provider = ({ value, children }) => { ctx.value = value; return children }; return ctx }, useContext: ctx => ctx.value,
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: Symbol('Fragment'),
  useEffect() {}, useLayoutEffect() {}, useState: initial => [initial, () => {}],
  useMemo: make => make(), useRef: current => ({ current }), useId: () => 'id',
}
const module = { exports: {} }
const viewport = { innerWidth: 1280 }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports,
  require: name => (name === 'react' ? react : {}),
  window: viewport,
})
const { TeamSidebar } = module.exports

// A Bot working in its own chat previews what it is doing, the way a group row does
// for members at work; an idle Bot keeps the last message preview.
test('a running Bot\'s sidebar row shows what it is doing', () => {
  viewport.innerWidth = 1280
  const bot = { id: 'writer', name: 'Writer', createdAt: 1 }
  const roster = { bots: [bot], rooms: [], agents: [], byId: { writer: bot }, ready: true, exchangeTurns: {} }
  const rows = []
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (!node || typeof node !== 'object') return
    if (node.type?.name === 'BotRow') rows.push(node)
    walk(node.props?.children)
  }
  const tree = TeamSidebar({
    wide: true,
    actions: Object.fromEntries(['openSession', 'openAgent', 'openAgentSession', 'newAgentSession', 'openMenu', 'openPalette', 'openNewChat', 'toggleSidebar', 'clearUnread'].map(name => [name, () => {}])),
    useRoster: pick => pick(roster), useUi: pick => pick({ unread: {} }), useRegistry: pick => pick({}),
    useSessions: pick => pick({ ids: [], byId: {} }), useUpdate: () => ({}),
    useSessionStatus: pick => pick(new Map([['writer', { running: true }]])),
    useSessionRetainInfo: () => null,
    useActivity: pick => pick({ writer: 'working' }),
    useWork: pick => pick({ waiting: {}, rooms: {}, approvals: [] }),
  })
  walk(tree)
  assert.equal(rows.length, 1)
  // BotRow renders as a function component: run it, then flatten Shimmer and the
  // other function children to read the preview line's text.
  const expand = (node) => {
    if (Array.isArray(node)) return node.map(expand)
    if (!node || typeof node !== 'object') return node
    if (typeof node.type === 'function') return expand(node.type(node.props))
    return { ...node, props: { ...node.props, children: expand(node.props.children) } }
  }
  const previews = []
  const collect = (node) => {
    if (Array.isArray(node)) { node.forEach(collect); return }
    if (!node || typeof node !== 'object') return
    if (node.props?.className === 'bt-row-preview') previews.push(node)
    collect(node.props?.children)
  }
  const textOf = (node) => {
    if (node === null || node === undefined || typeof node === 'boolean') return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(textOf).join('')
    return textOf(node.props?.children)
  }
  collect(expand(rows[0].type(rows[0].props)))
  assert.equal(previews.length, 1)
  // The row already says Writer, so the preview is the doing phrase alone.
  assert.match(textOf(previews[0]), /^.+…$/)
  assert.doesNotMatch(textOf(previews[0]), /^Writer ·/)
})

test('an idle Bot\'s sidebar row keeps the message preview', () => {
  viewport.innerWidth = 1280
  const bot = { id: 'writer', name: 'Writer', createdAt: 1 }
  const roster = { bots: [bot], rooms: [], agents: [], byId: { writer: bot }, ready: true, exchangeTurns: {} }
  const rows = []
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (!node || typeof node !== 'object') return
    if (node.type?.name === 'BotRow') rows.push(node)
    walk(node.props?.children)
  }
  const tree = TeamSidebar({
    wide: true,
    actions: Object.fromEntries(['openSession', 'openAgent', 'openAgentSession', 'newAgentSession', 'openMenu', 'openPalette', 'openNewChat', 'toggleSidebar', 'clearUnread'].map(name => [name, () => {}])),
    useRoster: pick => pick(roster), useUi: pick => pick({ unread: {} }), useRegistry: pick => pick({}),
    useSessions: pick => pick({ ids: [], byId: {} }), useUpdate: () => ({}),
    useSessionStatus: pick => pick(new Map()),
    useSessionRetainInfo: () => null,
    useActivity: pick => pick({}),
    useWork: pick => pick({ waiting: {}, rooms: {}, approvals: [] }),
  })
  walk(tree)
  const expand = (node) => {
    if (Array.isArray(node)) return node.map(expand)
    if (!node || typeof node !== 'object') return node
    if (typeof node.type === 'function') return expand(node.type(node.props))
    return { ...node, props: { ...node.props, children: expand(node.props.children) } }
  }
  const previews = []
  const collect = (node) => {
    if (Array.isArray(node)) { node.forEach(collect); return }
    if (!node || typeof node !== 'object') return
    if (node.props?.className === 'bt-row-preview') previews.push(node)
    collect(node.props?.children)
  }
  collect(expand(rows[0].type(rows[0].props)))
  assert.equal(previews.length, 0)
})
