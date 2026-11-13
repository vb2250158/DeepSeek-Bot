import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { previewOf } from '../src/client/text.js'
import { assistantSayText } from '../src/shared/assistant-chat.js'

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/cells.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
const react = {
  Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  createContext: value => ({ value }), useContext: context => context.value, useCallback: fn => fn,
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useRef: current => ({ current }),
  useMemo: fn => fn(), useEffect() {}, useLayoutEffect() {}, useId: () => 'assistant-test',
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
}
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports, Intl, Date, TextEncoder,
  require: name => name === 'react' ? react : {},
})
const { AssistantCell, ToolCell } = module.exports
const roster = { byId: { bot: { id: 'bot', name: 'Rabi', color: 'gray' } }, bots: [], roomsById: {}, prefs: {}, exchangeTurns: {} }
const props = {
  sessionId: 'bot', useRoster: select => select(roster), useUi: select => select({}),
  useTurnSteps: () => [], useTurnContext: () => [], useTurnData: () => [],
  useAssistantChat: select => select({ since: 2 }), actions: {},
}
const result = { kind: 'tool-result', seq: 4, callId: 'say', name: 'rabiroute_assistant_say', turn: 1,
  isError: false, content: [{ type: 'text', text: '{"text":"Hello"}' }], meta: { kind: 'rabi-assistant-say', text: 'Hello' }, subCalls: [] }

test('native Assistant renderer keeps execution output inside collapsed task details', () => {
  const node = { anchorSeq: 3, key: 'step', data: { seq: 3, turn: 1, status: 'complete', blocks: [{ kind: 'text', text: 'Internal execution' }] } }
  const rendered = AssistantCell({ ...props, node })
  assert.equal(rendered.type, 'details')
  assert.equal(rendered.props.open, undefined)
  assert.equal(rendered.children[0].type, 'summary')
  const legacy = AssistantCell({ ...props, node: { ...node, anchorSeq: 1 } })
  assert.equal(legacy.type, 'fragment')
  const plain = AssistantCell({ ...props, useAssistantChat: undefined, node })
  assert.equal(plain.type, 'fragment')
})

test('native tool renderer shows only committed say text as full chat bubbles', () => {
  const rendered = ToolCell({ ...props, node: { data: { root: result } } })
  assert.equal(rendered.type.name, 'Bubbles')
  assert.deepEqual(Array.from(rendered.props.texts), ['Hello'])
  assert.equal(rendered.props.fold.chars, Infinity)
  assert.equal(rendered.props.fold.lines, Infinity)
  const pending = ToolCell({ ...props, node: { data: { root: { ...result, kind: 'tool-call' } } } })
  assert.equal(pending.type.name, 'CellEmpty')
  const failed = ToolCell({ ...props, node: { data: { root: { ...result, isError: true } } } })
  assert.equal(failed.type, 'details')
})

test('native task details open the supported tool inspector', () => {
  let opened
  const rendered = ToolCell({ ...props, inspectCall: id => { opened = id }, node: { data: { root: { ...result, name: 'shell', meta: undefined } } } })
  assert.equal(rendered.type, 'details')
  const button = rendered.children[1].children.find(child => child?.type === 'button')
  button.props.onClick()
  assert.equal(opened, 'say')
})

test('canonical say requires successful durable output and matching execution metadata', () => {
  assert.equal(assistantSayText(result, result.meta), 'Hello')
  for (const [message, meta] of [
    [{ ...result, isError: undefined }, result.meta],
    [{ ...result, isError: true }, result.meta],
    [result, undefined], [result, { kind: 'wrong', text: 'Hello' }], [result, { kind: 'rabi-assistant-say', text: 'Mismatch' }],
    [{ ...result, content: [{ type: 'image', text: '{"text":"Hello"}' }] }, result.meta],
    [{ ...result, content: [{ type: 'text', text: 'bad' }] }, result.meta],
  ]) assert.equal(assistantSayText(message, meta), undefined)
})


test('assistant sidebar preview uses the host chat tail and keeps narration in details', () => {
  const list = { byId: { bot: {} }, projectionsBySession: { bot: { values: { dsBotAssistantChat: { since: 2 }, turnOutline: [{ turn: 1, response: 'Execution narration' }] } } } }
  assert.equal(previewOf(list, 'bot', [], 'Visible say'), 'Visible say')
  assert.equal(previewOf(list, 'bot'), '')
  list.projectionsBySession.bot.values.dsBotAssistantChat = { since: null }
  assert.equal(previewOf(list, 'bot'), 'Execution narration')
})
