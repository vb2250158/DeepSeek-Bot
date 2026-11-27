import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { previewOf } from '../src/client/text.js'
import { assistantChatText, assistantSayText, ASSISTANT_NATIVE_REPLY_EVENT, ASSISTANT_NATIVE_REPLY_KEY, ASSISTANT_SCHEDULE_REPLY_EVENT, ASSISTANT_SCHEDULE_REPLY_KEY } from '../src/shared/assistant-chat.js'
import { assistantNativeReplyDefinition } from '../src/client/assistant-native-reply.js'
import { assistantScheduleReplyDefinition } from '../src/client/assistant-schedule-reply.js'

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
const { AssistantCell, ToolCell, TriggerCell, TurnTailCell } = module.exports
const roster = { byId: { bot: { id: 'bot', name: 'Rabi', color: 'gray' } }, bots: [], roomsById: {}, prefs: {}, exchangeTurns: {} }
const props = {
  sessionId: 'bot', useRoster: select => select(roster), useUi: select => select({}),
  useTurnSteps: () => [], useTurnContext: () => [], useTurnData: () => [],
  useAssistantChat: select => select({ since: 2 }), actions: {},
}
const result = { kind: 'tool-result', seq: 4, callId: 'say', name: 'rabiroute_assistant_say', turn: 1,
  isError: false, content: [{ type: 'text', text: '{"text":"Hello"}' }], meta: { kind: 'rabi-assistant-say', text: 'Hello' }, subCalls: [] }

test('assistant-mode execution narration stays out of a personal Bot chat', () => {
  const node = { anchorSeq: 3, key: 'step', data: { seq: 3, turn: 1, status: 'complete', blocks: [{ kind: 'text', text: 'Internal execution' }] } }
  const rendered = AssistantCell({ ...props, node })
  assert.equal(rendered.type.name, 'CellEmpty')
  const legacy = AssistantCell({ ...props, node: { ...node, anchorSeq: 1 } })
  assert.equal(legacy.type, 'fragment')
  const plain = AssistantCell({ ...props, useAssistantChat: undefined, node })
  assert.equal(plain.type, 'fragment')
})

test('assistant chat streams the marked reply and displays the settled conclusion', () => {
  const running = { seq: 4, turn: 1, step: 1, status: 'running', blocks: [{ kind: 'text', text: 'I will move it.' }] }
  const opening = { ...running, status: 'settled', finalNode: { seq: 7, messageId: 'first' }, blocks: [...running.blocks, { kind: 'tool-call' }] }
  const progress = { ...opening, step: 2, blocks: [{ kind: 'text', text: 'Looking up coordinates' }, { kind: 'tool-call' }] }
  const closing = { ...opening, step: 3, finalNode: { seq: 22, messageId: 'closing' }, blocks: [{ kind: 'text', text: 'It moved.' }] }
  const tail = { closing, branchUnavailable: false }
  const native = { turn: 1, steps: [1] }
  const cell = (data, turnTail) => AssistantCell({ ...props,
    node: { anchorSeq: data.finalNode?.seq ?? data.seq, key: `step:${data.step}`, data },
    useTurnData: (key) => key === ASSISTANT_NATIVE_REPLY_KEY ? native : turnTail,
  })
  const bubbles = (data, turnTail) => cell(data, turnTail).children.at(-1).children[0].children.find(child => child?.props?.texts)
  assert.deepEqual(Array.from(bubbles(running).props.texts), ['I will move it.'])
  assert.equal(bubbles(running).props.streaming, true)
  assert.equal(bubbles(opening, tail).props.msgKey, bubbles(running).props.msgKey)
  assert.equal(cell(progress, tail).type.name, 'CellEmpty')
  assert.equal(cell(closing).type.name, 'CellEmpty')
  assert.deepEqual(Array.from(bubbles(closing, tail).props.texts), ['It moved.'])
  assert.equal(cell(progress, { ...tail, closing: progress }).type.name, 'CellEmpty')
})

test('durable native reply markers are scoped to their own turn and merge steering steps', () => {
  const marker = (step) => ({ type: ASSISTANT_NATIVE_REPLY_EVENT, data: { turn: 4, step } })
  const { match, start, update, buildLocationData } = assistantNativeReplyDefinition
  assert.deepEqual(match[ASSISTANT_NATIVE_REPLY_EVENT](marker(1)), { id: '4', role: 'start' })
  assert.equal(match[ASSISTANT_NATIVE_REPLY_EVENT](marker(0)), null)
  const onTurn = { event: marker(1), location: { kind: 'turn', turn: { turn: 4 } } }
  const initial = start({}, onTurn)
  assert.equal(update({ state: initial }, onTurn), initial)
  const state = update({ state: initial }, { event: marker(3) })
  assert.deepEqual(buildLocationData({ start: onTurn, state }, 'turn'), {
    kind: 'turn', turn: 4, key: ASSISTANT_NATIVE_REPLY_KEY, value: { turn: 4, steps: [1, 3] },
  })
  assert.equal(buildLocationData({ start: { ...onTurn, location: { kind: 'turn', turn: { turn: 5 } } }, state }, 'turn'), null)
})

test('native tool renderer shows only committed say text as full chat bubbles', () => {
  const rendered = ToolCell({ ...props, node: { data: { root: result } } })
  assert.equal(rendered.type.name, 'SpeakerReply')
  const [bubbles] = rendered.children
  assert.equal(rendered.props.history.turn, 1)
  assert.deepEqual(Array.from(bubbles.props.texts), ['Hello'])
  assert.equal(bubbles.props.fold.chars, Infinity)
  assert.equal(bubbles.props.fold.lines, Infinity)
  const pending = ToolCell({ ...props, node: { data: { root: { ...result, kind: 'tool-call' } } } })
  assert.equal(pending.type.name, 'CellEmpty')
  const failed = ToolCell({ ...props, node: { data: { root: { ...result, isError: true } } } })
  assert.equal(failed.type.name, 'CellEmpty')
})

test('a scheduled fallback is admitted only as a nonempty reply to its owning turn', () => {
  const event = { type: ASSISTANT_SCHEDULE_REPLY_EVENT, seq: 8, data: { turn: 1, text: ' Checked the status. ' } }
  const match = assistantScheduleReplyDefinition.match[ASSISTANT_SCHEDULE_REPLY_EVENT]
  assert.deepEqual(match(event), { id: '1', role: 'start' })
  assert.equal(match({ ...event, data: { ...event.data, text: ' ' } }), null)
  assert.equal(match({ ...event, data: { ...event.data, turn: '1' } }), null)
  const state = assistantScheduleReplyDefinition.start({}, { event })
  const location = { kind: 'turn', turn: { turn: 1 } }
  const projected = assistantScheduleReplyDefinition.buildLocationData({ start: { location }, state }, 'turn')
  assert.deepEqual(projected, { kind: 'turn', turn: 1, key: ASSISTANT_SCHEDULE_REPLY_KEY, value: { turn: 1, seq: 8, text: 'Checked the status.' } })
  assert.equal(assistantScheduleReplyDefinition.buildLocationData({ start: { location: { kind: 'turn', turn: { turn: 2 } } }, state }, 'turn'), null)
  assert.equal(assistantChatText(event, { since: 2 }), 'Checked the status.')
  assert.equal(assistantChatText(event, { since: 10 }), undefined)
})

test('a restored user turn shows its completed text without the opening native marker', () => {
  const closing = { turn: 1, step: 78, status: 'settled', finalNode: { seq: 2663, messageId: 'closing' },
    blocks: [{ kind: 'text', text: 'The board is cleared.' }] }
  const render = ({ user = true, native, nativeSince = 7, reason = 'completed' } = {}) => {
    const entries = new Map([['turn-tail', { closing, branchUnavailable: false }], [ASSISTANT_NATIVE_REPLY_KEY, native]])
    const data = { get: key => entries.get(key), source: key => ({ subscribe: () => () => {}, getSnapshot: () => entries.get(key) }) }
    const end = { time: 50, data: { reason: { kind: reason } } }
    const tree = TurnTailCell({ ...props, turn: { turn: 1, end, data }, useTurnClock: select => select({}),
      useAssistantChat: select => select({ since: 7, nativeSince, nativeTurns: user ? [1] : [2] }),
      useTurnSteps: () => [closing], useTurnTools: () => [] })
    const history = tree.children[0]
    return history.type(history.props)
  }
  assert.deepEqual(Array.from(render().children[0].props.texts), ['The board is cleared.'])
  assert.equal(render({ native: { turn: 1, steps: [1] } }), null)
  assert.equal(render({ user: false }).children[0].props.className, 'bt-silent-run')
  assert.equal(render({ nativeSince: 3000 }).children[0].props.className, 'bt-silent-run')
  assert.equal(render({ reason: 'aborted' }).children[0].props.className, 'bt-silent-run')
})

test('an unspoken turn shows the Bot name and keeps only its finalized closing text in run history', () => {
  const steps = [{ status: 'settled', finalNode: { seq: 7, messageId: 'closed' }, blocks: [
    { kind: 'reasoning', text: 'Thought' }, { kind: 'text', text: 'Saved conclusion' },
  ] }]
  const tail = (reply, overrides = {}) => {
    const turnData = new Map([['turn-tail', { closing: steps[0], branchUnavailable: false }], [ASSISTANT_SCHEDULE_REPLY_KEY, reply]])
    const end = { time: 50, data: { reason: { kind: 'completed' } } }
    const tree = TurnTailCell({ ...props, turn: { turn: 1, end, data: turnData }, useTurnClock: select => select({}),
      useTurnSteps: () => steps, useTurnTools: () => [], ...overrides })
    const history = tree.children[0]
    return history.type(history.props)
  }
  const original = tail()
  assert.equal(original.type.name, 'SpeakerReply')
  assert.equal(original.props.chain, false)
  assert.equal(original.props.history.conclusion, 'Saved conclusion')
  assert.equal(original.children[0].props.className, 'bt-silent-run')
  assert.doesNotMatch(original.children[0].children[0], /Saved conclusion|Thought/)
  const recorded = tail({ turn: 1, seq: 8, text: 'Checked the status.' })
  assert.equal(recorded.props.history.conclusion, undefined)
  assert.equal(recorded.children[0].props.reply.text, 'Checked the status.')
  const failed = tail({ turn: 1, seq: 51, text: 'No result was confirmed.' }, {
    turn: { turn: 1, end: { time: 50, data: { reason: { kind: 'error' } } },
      data: new Map([[ASSISTANT_SCHEDULE_REPLY_KEY, { turn: 1, seq: 51, text: 'No result was confirmed.' }]]) },
  })
  assert.equal(failed.children[0].props.reply.text, 'No result was confirmed.')
  const blocked = tail(undefined, {
    turn: { turn: 1, end: { time: 50, data: { reason: { kind: 'blocked' } } },
      data: new Map([[ASSISTANT_SCHEDULE_REPLY_KEY, { turn: 1, seq: 49, text: 'No result was confirmed.' }]]) },
  })
  assert.equal(blocked.children[0].props.reply.text, 'No result was confirmed.')
  assert.equal(tail({ turn: 1, seq: 8, text: 'Checked the status.' }, {
    useTurnTools: () => [{ root: result }],
  }), null)
})

test('ordinary Agent task details open the supported tool inspector', () => {
  let opened
  const rendered = ToolCell({ ...props, sessionId: 'ordinary', inspectCall: id => { opened = id }, node: { data: { root: { ...result, name: 'shell', meta: undefined } } } })
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


test('personal Bot chat omits background details and uses the scheduled task entry', () => {
  const text = 'Private background execution. '.repeat(20)
  const triggerProps = { ...props, useSessions: select => select({ byId: {}, projectionsBySession: {} }), useTurnClock: select => select({}) }
  for (const kind of ['subagent-settled', 'agent-message']) {
    const node = { anchorSeq: 5, data: { seq: 5, turn: 1, source: { kind, senderSessionId: 'synthetic-worker-42' }, content: [{ type: 'text', text }] } }
    const rendered = TriggerCell({ ...triggerProps, node })
    assert.equal(rendered.type.name, 'CellEmpty')
    const ordinary = TriggerCell({ ...triggerProps, node, useAssistantChat: undefined })
    assert.equal(ordinary.props.className, 'bt-event')
    assert.equal(ordinary.children[0], text.slice(0, 80))
    assert.equal(node.data.source.senderSessionId, 'synthetic-worker-42')
    const plain = TriggerCell({ ...triggerProps, node, useAssistantChat: select => select({ since: null }) })
    assert.equal(plain.children[0], text.slice(0, 80))
    const previous = TriggerCell({ ...triggerProps, node: { ...node, data: { ...node.data, seq: 1 } } })
    assert.equal(previous.props.className, 'bt-event')
  }
  const schedule = TriggerCell({ ...triggerProps, node: { data: { seq: 5, turn: 1, source: { kind: 'schedule' }, content: [{ type: 'text', text: 'Scheduled work' }] } } })
  assert.equal(schedule.type.name, 'ScheduleTrigger')
  const kickoff = TriggerCell({ ...triggerProps, node: { data: { seq: 5, turn: 1, source: { kind: 'bot', role: 'kickoff' }, content: [] } } })
  assert.equal(kickoff.type.name, 'CellEmpty')
  const post = TriggerCell({ ...triggerProps, node: { data: { seq: 5, turn: 1, source: { kind: 'bot', role: 'post', senderSessionId: 'synthetic-worker-42' }, content: [{ type: 'text', text }] } } })
  assert.equal(post.type.name, 'GroupMessage')
  assert.equal(post.props.text, text)
})


test('ordinary Agent background details retain full text in the rendered DOM', () => {
  const uiRequire = createRequire(import.meta.resolve('@deepseek-ai/dsh-client-ui-primitives'))
  const hostRequire = createRequire(join(process.env.DSH_HARNESS, 'package.json'))
  const React = uiRequire('react')
  const { renderToStaticMarkup } = uiRequire('react-dom/server')
  const { JSDOM } = hostRequire('jsdom')
  const actual = { exports: {} }
  runInNewContext(outputFiles[0].text, {
    module: actual, exports: actual.exports, Intl, Date, TextEncoder,
    require: name => name === 'react' ? React : name === 'react-dom' ? uiRequire('react-dom')
      : { MarkdownText: ({ text }) => React.createElement('p', null, text) },
  })
  const text = 'Private background execution. '.repeat(20)
  for (const kind of ['subagent-settled', 'agent-message']) {
    const node = { data: { seq: 5, turn: 1, source: { kind, senderSessionId: 'synthetic-worker-42' }, content: [{ type: 'text', text }] } }
    const rendered = renderToStaticMarkup(React.createElement(actual.exports.TriggerCell, {
      ...props, sessionId: 'ordinary', node, useSessions: select => select({ byId: {} }), useTurnClock: select => select({}),
    }))
    const dom = new JSDOM(rendered)
    const details = dom.window.document.querySelector('details')
    assert.ok(details)
    assert.equal(details.open, false)
    assert.equal(details.querySelector('[role=region]').tabIndex, 0)
    assert.equal(details.querySelector('p').textContent, text)
    assert.equal(dom.window.document.querySelector('.bt-event'), null)
    details.open = true
    assert.equal(details.open, true)
    assert.equal(details.querySelector('p').textContent, text)
    dom.window.close()
  }
})
