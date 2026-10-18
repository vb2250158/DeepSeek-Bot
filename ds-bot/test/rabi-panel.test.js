import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

const { outputFiles } = await build({
  stdin: { contents: "export { DetailsDrawer } from './src/client/details-drawer.js'; export { RabiWorkspace } from './src/client/rabi-workspace.js'", resolveDir: fileURLToPath(new URL('..', import.meta.url)) },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
let tab = 'details', stateIndex = 0
const module = { exports: {} }
const h = (type, props, ...children) => ({ type, props: { ...props, children } })
const noop = () => {}
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports,
  require: name => name === 'react' ? {
    createElement: h, Fragment: 'fragment', useEffect: noop, useLayoutEffect: noop,
    useRef: value => ({ current: value }), useCallback: value => value,
    useState: initial => [stateIndex++ === 0 ? tab : typeof initial === 'function' ? initial() : initial, noop],
    useSyncExternalStore: (subscribe, get) => get(),
  } : name === 'react-dom' ? { createPortal: node => node } : {},
})
const nodes = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)]

test('the compact panel shows its model in both tabs and gives Rabi resources one home', () => {
  const bot = { id: 'fixture', name: 'Fixture', role: 'Rabi', rabiPersona: { roleId: 'fixture' } }
  const roster = { byId: { fixture: bot }, roomsById: {}, exchangeTurns: {}, models: [] }
  const observed = {}
  for (tab of ['details', 'library']) {
    stateIndex = 0
    const tree = nodes(module.exports.DetailsDrawer({ sessionId: bot.id, compact: true, roster, actions: {}, useSessionStatus: pick => pick(new Map()), useActivity: pick => pick({}), useSessions: () => '', useWork: noop }))
    observed[tab] = {
      tabs: tree.filter(node => node.props?.role === 'tab').map(node => node.props.children[0]),
      models: tree.filter(node => node.type?.name === 'ModelMenu').length,
      resources: tree.filter(node => node.type?.name === 'RabiWorkspace').length,
    }
  }
  tab = { resource: 'memory', query: {} }; stateIndex = 0
  const tree = nodes(module.exports.RabiWorkspace({ bot, actions: { rabiWorkspace: { selection: () => tab } } }))
  observed.memory = {
    tabs: tree.filter(node => node.props?.role === 'tab').map(node => node.props.children[0]),
    sections: tree.filter(node => node.type?.name === 'Resource').map(node => node.props.kind),
    buttons: tree.filter(node => node.type === 'button').map(node => node.props.children[0]),
  }
  assert.deepEqual(JSON.parse(JSON.stringify(observed)), JSON.parse(readFileSync(new URL('./fixtures/rabi-panel.json', import.meta.url), 'utf8')))
})
