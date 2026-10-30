import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { build } from 'esbuild'

const bundle = await build({ stdin: { contents: "export { DetailsDrawer } from './src/client/details-drawer.js'; export { GroupMembers } from './src/client/group-members.js'", resolveDir: fileURLToPath(new URL('..', import.meta.url)) }, bundle: true, format: 'cjs', platform: 'browser', write: false, external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'] })
const module = { exports: {} }
let states = [], index = 0
const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) })
const noop = () => {}
runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, Date,
  require: name => name === 'react' ? { createContext: initial => { const ctx = { value: initial }; ctx.Provider = ({ value, children }) => { ctx.value = value; return children }; return ctx }, useContext: ctx => ctx.value,
  createElement: h, Fragment: 'fragment', useEffect: noop, useLayoutEffect: noop, useRef: value => ({ current: value }), useCallback: value => value,
    useState: initial => { const own = index++; if (!(own in states)) states[own] = typeof initial === 'function' ? initial() : initial; return [states[own], value => { states[own] = typeof value === 'function' ? value(states[own]) : value }] } }
    : name === 'react-dom' ? { createPortal: node => node } : { Button: 'button', Input: 'input' } })
const nodes = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.children)]
const bots = ['Alpha', 'Beta', 'Gamma'].map(name => ({ id: name.toLowerCase(), name }))
const room = { id: 'room', name: 'Project', members: ['alpha', 'beta'], admin: 'alpha' }
const roster = { bots, byId: Object.fromEntries(bots.map(bot => [bot.id, bot])), roomsById: { room }, exchangeTurns: {} }

test('group panels expose Details, Library and Members in both layouts', () => {
  const result = {}
  for (const compact of [false, true]) {
    for (const tab of ['details', 'library', 'members']) {
      states = [tab]; index = 0
      const tree = nodes(module.exports.DetailsDrawer({ sessionId: 'room', compact, roster, actions: {}, useSessionStatus: pick => pick(new Map()), useActivity: pick => pick({}), useSessions: () => '', useWork: noop }))
      result[`${compact ? 'compact' : 'wide'}:${tab}`] = {
        tabs: tree.filter(node => node.props.role === 'tab').map(node => node.children.filter(child => typeof child === 'string').join('')),
        selected: tree.filter(node => node.props.role === 'tab' && node.props['aria-selected']).map(node => node.children.filter(child => typeof child === 'string').join('')),
        content: tree.filter(node => ['GroupOverview', 'GroupLibrary', 'GroupMembers'].includes(node.type?.name)).map(node => node.type.name),
      }
    }
  }
  assert.deepEqual(JSON.parse(JSON.stringify(result)), JSON.parse(readFileSync(new URL('./fixtures/group-panel.json', import.meta.url), 'utf8')))
})

test('Members adds an outside Bot through the group owner without opening Settings', async () => {
  states = []; index = 0
  const calls = []
  const props = { room, roster, useWork: pick => pick({}), actions: { updateRoom: async (id, patch) => { calls.push([id, patch]); return {} } }, run: async promise => { await promise; return true } }
  const render = () => { index = 0; return nodes(module.exports.GroupMembers(props)) }
  render().find(node => node.type === 'button' && node.children.includes('Add member')).props.onClick()
  const picker = render()
  const choices = picker.filter(node => node.props.className === 'bt-member-name bt-group-pick')
  assert.equal(choices.length, 1)
  assert.equal(choices[0].children.find(node => node?.type === 'span').children[0], 'Gamma')
  choices[0].props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['room', { add: ['gamma'] }]])
  assert.equal(render().filter(node => node.type === 'input').length, 0)
})

test('a refused member addition leaves the member picker available', async () => {
  states = []; index = 0
  const props = { room, roster, useWork: pick => pick({}), actions: { updateRoom: async () => {} }, run: async () => false }
  const render = () => { index = 0; return nodes(module.exports.GroupMembers(props)) }
  render().find(node => node.type === 'button' && node.children.includes('Add member')).props.onClick()
  render().find(node => node.props.className === 'bt-member-name bt-group-pick').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(render().filter(node => node.type === 'input').length, 1)
})
