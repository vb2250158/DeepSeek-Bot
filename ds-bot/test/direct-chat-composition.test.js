import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'



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
const { AssistantCell, ToolCell, syncGroupChains } = module.exports
const roster = { byId: { bot: { id: 'bot', name: 'Rabi', color: 'gray' } }, bots: [], roomsById: {}, prefs: {}, exchangeTurns: {} }
const props = {
  sessionId: 'bot', useRoster: select => select(roster), useUi: select => select({}),
  useTurnSteps: () => [], useTurnContext: () => [], useTurnData: () => [],
  useAssistantChat: select => select({ since: 2 }), actions: {},
}
const result = { kind: 'tool-result', seq: 4, callId: 'say', name: 'rabiroute_assistant_say', turn: 1,
  isError: false, content: [{ type: 'text', text: '{"text":"Hello"}' }], meta: { kind: 'rabi-assistant-say', text: 'Hello' }, subCalls: [] }

const { JSDOM } = createRequire(join(process.env.DSH_HARNESS, 'package.json'))('jsdom')

test('historical and explicit Bot replies group around user messages without dropping the run history action', () => {
  const makeStep = (step, seq) => ({ kind: 'assistant-step', anchorSeq: seq, key: 'step-' + seq, data: {
    seq, turn: 1, step, status: 'settled', blocks: [{ kind: 'text', text: 'Historical reply' }],
  } })
  const legacy = AssistantCell({ ...props, node: makeStep(1, 1) })
  const walk = (node, name) => {
    if (!node || typeof node !== 'object') return undefined
    if (node.type?.name === name) return node
    return node.children?.map(child => walk(child, name)).find(Boolean)
  }
  const historical = walk(legacy, 'SpeakerReply')
  const newer = ToolCell({ ...props, node: { data: { root: result } } })
  const plain = ToolCell({ ...props, sessionId: 'ordinary', node: { data: { root: result } } })
  const render = value => value.type({ ...value.props, children: value.children })
  assert.equal(historical.type.name, 'SpeakerReply')
  assert.equal(newer.type.name, 'SpeakerReply')
  assert.equal(plain.type.name, 'Bubbles')
  assert.equal(historical.props.history.turn, 1)
  assert.equal(newer.props.history.turn, 1)
  const dom = new JSDOM('<main data-chat-flow></main>')
  try {
    const flow = dom.window.document.querySelector('main')
    const append = (kind, speaker) => {
      const host = dom.window.document.createElement('div')
      host.dataset.chatFlowKind = kind
      const row = dom.window.document.createElement('div')
      row.dataset.btSpeaker = speaker
      host.append(row)
      flow.append(host)
      return row
    }
    const historicalSpeaker = render(historical).props['data-bt-speaker']
    const explicitSpeaker = render(newer).props['data-bt-speaker']
    assert.equal(historicalSpeaker, 'bot:bot')
    assert.equal(explicitSpeaker, historicalSpeaker)
    const first = append('assistant-step', historicalSpeaker)
    const second = append('tool-call', explicitSpeaker)
    const user = append('user', 'user')
    const followup = append('user', 'user')
    const reply = append('tool-call', explicitSpeaker)
    syncGroupChains(flow)
    const prev = row => row.hasAttribute('data-seam-prev')
    const next = row => row.hasAttribute('data-seam-next')
    assert.deepEqual([first, second, user, followup, reply].map(row => [prev(row), next(row)]),
      [[false,true],[true,false],[false,true],[true,false],[false,false]])
  } finally {
    dom.window.close()
  }
})
