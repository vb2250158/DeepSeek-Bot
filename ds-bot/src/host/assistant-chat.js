import { HISTORY_TIMEOUT_MS } from './constants.js'
// The marker preserves pre-upgrade chat while later rows come from committed say calls.
import { ASSISTANT_MODE_EVENT, ASSISTANT_CHAT_KEY, assistantChatActive, assistantChatText } from '../shared/assistant-chat.js'
export { ASSISTANT_MODE_EVENT, assistantChatActive, assistantChatText }
const KEY = ASSISTANT_CHAT_KEY
const empty = () => ({ since: null })

export function foldAssistantChat(state, event) {
  if (event.type === ASSISTANT_MODE_EVENT && event.data?.version === 1 && Number.isInteger(event.seq) && (state.since === null || event.seq < state.since)) return { ...state, since: event.seq }
  return state
}

export function installAssistantChat(rt) {
  const { ctx } = rt
  let handle
  const cached = new Map()
  ctx.effect?.(() => () => cached.clear(), 'ds-bot: assistant chat cache')
  const projection = {
    key: KEY, stateVersion: 1,
    stateSchema: { parse(value) {
      if (value === null || typeof value !== 'object' || (value.since !== null && !Number.isInteger(value.since))) throw new Error('Invalid assistant chat projection')
      return { since: value.since }
    } },
    init: empty, apply: foldAssistantChat,
    wire: { viewSchema: { parse: value => projection.stateSchema.parse(value) }, view: value => value },
  }
  const register = async projections => { handle = await projections.register(projection) }
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
      const value = await ctx.sessionController.projections({ sessionId }, signal ?? AbortSignal.timeout(HISTORY_TIMEOUT_MS))
      const state = value?.values?.[KEY]
      if (state !== undefined) {
        cached.set(sessionId, state)
        return state
      }
    }
    return cached.get(sessionId) ?? empty()
  }
}
