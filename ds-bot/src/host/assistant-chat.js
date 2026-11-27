import { HISTORY_TIMEOUT_MS } from './constants.js'
// The first marker preserves pre-upgrade chat. Native reply steps opt in separately.
import { ASSISTANT_MODE_EVENT, ASSISTANT_CHAT_KEY, ASSISTANT_NATIVE_REPLY_KEY, addAssistantNativeStep, assistantNativeReplyStep, assistantChatActive, assistantChatText } from '../shared/assistant-chat.js'
export { ASSISTANT_MODE_EVENT, assistantChatActive, assistantChatText }
const KEY = ASSISTANT_CHAT_KEY
const empty = () => ({ since: null })

export function foldAssistantChat(state, event) {
  const reply = assistantNativeReplyStep(event)
  if (reply && event.seq >= (state.nativeSince ?? Infinity)) {
    const turns = state.nativeTurns ?? []
    return turns.includes(reply.turn) ? state : { ...state, nativeTurns: [...turns, reply.turn] }
  }
  if (event.type !== ASSISTANT_MODE_EVENT || !Number.isInteger(event.seq)) return state
  const { version } = event.data ?? {}
  if (version !== 1 && version !== 2) return state
  const since = Math.min(state.since ?? Infinity, event.seq)
  const nativeSince = version === 2 ? Math.min(state.nativeSince ?? Infinity, event.seq) : state.nativeSince
  return since === state.since && nativeSince === state.nativeSince ? state : { ...state, since, ...(nativeSince === undefined ? {} : { nativeSince }) }
}

export function foldAssistantNativeReply(state, event) {
  const marker = assistantNativeReplyStep(event)
  if (marker) return addAssistantNativeStep(state, marker)
  if (event.type === 'turn/start' || event.type === 'turn/end') return null
  return state
}

export function installAssistantChat(rt) {
  const { ctx } = rt
  let handle
  let nativeHandle
  const cached = new Map()
  const nativeTurns = new WeakMap()
  ctx.effect?.(() => () => cached.clear(), 'ds-bot: assistant chat cache')
  const projection = {
    key: KEY, stateVersion: 3,
    stateSchema: { parse(value) {
      if (value === null || typeof value !== 'object' || (value.since !== null && !Number.isInteger(value.since))
        || (value.nativeSince !== undefined && !Number.isInteger(value.nativeSince))
        || (value.nativeTurns !== undefined && (!Array.isArray(value.nativeTurns)
          || !value.nativeTurns.every(turn => Number.isSafeInteger(turn) && turn > 0)))) throw new Error('Invalid assistant chat projection')
      return { since: value.since, ...(value.nativeSince === undefined ? {} : { nativeSince: value.nativeSince }),
        ...(value.nativeTurns === undefined ? {} : { nativeTurns: value.nativeTurns }) }
    } },
    init: empty, apply: foldAssistantChat,
    wire: { viewSchema: { parse: value => projection.stateSchema.parse(value) }, view: value => value },
  }
  const nativeProjection = {
    key: ASSISTANT_NATIVE_REPLY_KEY, stateVersion: 1,
    stateSchema: { parse(value) {
      if (value === null) return null
      if (!Number.isSafeInteger(value?.turn) || !Array.isArray(value.steps) || !value.steps.every(Number.isSafeInteger)) throw new Error('Invalid native assistant reply projection')
      return { turn: value.turn, steps: value.steps }
    } },
    init: () => null, apply: foldAssistantNativeReply,
  }
  const register = async projections => {
    handle = await projections.register(projection)
    nativeHandle = await projections.register(nativeProjection)
  }
  if (typeof ctx.inject === 'function') ctx.inject(['sessionProjections'], own => {
    rt.assistantChatReady = register(own.sessionProjections)
    return rt.assistantChatReady
  })
  else if (ctx.get?.('sessionProjections')?.register) rt.assistantChatReady = register(ctx.get('sessionProjections'))
  rt.assistantChatState = (sessionId, events = [], session) => {
    const projected = session && handle?.stateOf(session)
    const state = events.reduce(foldAssistantChat, projected ?? cached.get(sessionId) ?? empty())
    cached.set(sessionId, state)
    return state
  }
  rt.assistantNativeReplyState = (session, events) => {
    if (!session) return null
    const projected = nativeHandle?.stateOf(session)
    if (projected !== undefined) return projected
    const state = events.reduce(foldAssistantNativeReply, nativeTurns.get(session) ?? null)
    nativeTurns.set(session, state)
    return state
  }
  rt.loadAssistantChat = async (sessionId, session, signal) => {
    await rt.assistantChatReady
    const projected = session && handle?.stateOf(session)
    if (projected !== undefined) {
      cached.set(sessionId, projected)
      return projected
    }
    const preset = session && ctx.get?.('agentPresets')?.presetForSession(session)
    if (preset !== undefined && preset !== 'rabi-assistant') return empty()
    // The public controller reads archived projections without activating an Agent.
    if (typeof ctx.sessionController?.projections === 'function') {
      const value = await ctx.sessionController.projections({ sessionId, keys: [KEY] }, signal ?? AbortSignal.timeout(HISTORY_TIMEOUT_MS))
      const state = value?.values?.[KEY]
      if (state !== undefined) {
        cached.set(sessionId, state)
        return state
      }
    }
    return cached.get(sessionId) ?? empty()
  }
}
