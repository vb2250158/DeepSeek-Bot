import { ASSISTANT_NATIVE_REPLY_EVENT, ASSISTANT_NATIVE_REPLY_KEY, addAssistantNativeStep, assistantNativeReplyStep } from '../shared/assistant-chat.js'

export const assistantNativeReplyDefinition = {
  kind: ASSISTANT_NATIVE_REPLY_KEY,
  match: {
    [ASSISTANT_NATIVE_REPLY_EVENT]: event => {
      const reply = assistantNativeReplyStep(event)
      return reply ? { id: String(reply.turn), role: 'start' } : null
    },
  },
  start: (_context, match) => addAssistantNativeStep(undefined, assistantNativeReplyStep(match.event)),
  update: ({ state }, match) => addAssistantNativeStep(state, assistantNativeReplyStep(match.event)),
  buildLocationData: ({ start, state }, scope) => {
    const location = start?.location
    if (scope !== 'turn' || !state || (location?.kind !== 'turn' && location?.kind !== 'step') || location.turn.turn !== state.turn) return null
    return { kind: 'turn', turn: state.turn, key: ASSISTANT_NATIVE_REPLY_KEY, value: state }
  },
}
