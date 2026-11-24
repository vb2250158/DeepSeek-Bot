import { ASSISTANT_SCHEDULE_REPLY_EVENT, ASSISTANT_SCHEDULE_REPLY_KEY, assistantScheduleReply } from '../shared/assistant-chat.js'

export const assistantScheduleReplyDefinition = {
  kind: ASSISTANT_SCHEDULE_REPLY_KEY,
  target: 'chat',
  match: {
    [ASSISTANT_SCHEDULE_REPLY_EVENT]: event => {
      const reply = assistantScheduleReply(event)
      return reply ? { id: String(reply.turn), role: 'start' } : null
    },
  },
  start: (_context, match) => assistantScheduleReply(match.event),
  buildLocationData: ({ start, state }, scope) => {
    const location = start?.location
    if (scope !== 'turn' || !state || (location?.kind !== 'turn' && location?.kind !== 'step') || location.turn.turn !== state.turn) return null
    return { kind: 'turn', turn: state.turn, key: ASSISTANT_SCHEDULE_REPLY_KEY, value: state }
  },
  buildViewNode: () => null,
}
