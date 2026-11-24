export const ASSISTANT_MODE_EVENT = 'rabiroute/assistant-mode'
export const ASSISTANT_CHAT_KEY = 'dsBotAssistantChat'
export const ASSISTANT_SCHEDULE_REPLY_EVENT = 'rabiroute/assistant-schedule-reply'
export const ASSISTANT_SCHEDULE_REPLY_KEY = 'dsBotAssistantScheduleReply'

// Typed local tool execution owns meta. JSON and metadata must describe the same committed text.
export function assistantSayText(message, meta) {
  if (message?.isError !== false || meta?.kind !== 'rabi-assistant-say' || typeof meta.text !== 'string') return undefined
  if (!Array.isArray(message.content) || message.content.length !== 1 || message.content[0]?.type !== 'text' || typeof message.content[0].text !== 'string') return undefined
  let value
  try { value = JSON.parse(message.content[0].text) } catch { return undefined }
  return typeof value?.text === 'string' && value.text.trim() !== '' && value.text === meta.text ? value.text : undefined
}

export function assistantChatText(event, state) {
  if (!assistantChatActive(state, event.seq)) return undefined
  return event.type === 'tool/result'
    ? assistantSayText(event.data?.message, event.data?.meta)
    : assistantScheduleReply(event)?.text
}

export function assistantScheduleReply(event) {
  if (event.type !== ASSISTANT_SCHEDULE_REPLY_EVENT || !Number.isInteger(event.seq)) return undefined
  const { turn, text } = event.data ?? {}
  if (!Number.isSafeInteger(turn) || turn < 0 || typeof text !== 'string' || text.trim() === '') return undefined
  return { turn, seq: event.seq, text: text.trim() }
}

export function visibleScheduleReply(location, state, reply = location.data?.get(ASSISTANT_SCHEDULE_REPLY_KEY)) {
  const reason = location.end?.data?.reason?.kind
  return reply && reason !== undefined && reason !== 'aborted' && reply.turn === location.turn && assistantChatActive(state, reply.seq)
    ? reply : undefined
}

export function assistantChatActive(state, seq = Infinity) {
  return state?.since !== null && state?.since !== undefined && seq >= state.since
}
