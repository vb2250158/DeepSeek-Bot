export const ASSISTANT_MODE_EVENT = 'rabiroute/assistant-mode'
export const ASSISTANT_CHAT_KEY = 'dsBotAssistantChat'
export const ASSISTANT_NATIVE_REPLY_EVENT = 'rabiroute/assistant-native-reply'
export const ASSISTANT_NATIVE_REPLY_KEY = 'dsBotAssistantNativeReply'
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

export function assistantNativeReplyStep(event) {
  if (event.type !== ASSISTANT_NATIVE_REPLY_EVENT) return undefined
  const { turn, step } = event.data ?? {}
  return Number.isSafeInteger(turn) && turn > 0 && Number.isSafeInteger(step) && step > 0 ? { turn, step } : undefined
}

export function addAssistantNativeStep(state, { turn, step }) {
  if (state?.turn !== turn) return { turn, steps: [step] }
  return state.steps.includes(step) ? state : { turn, steps: [...state.steps, step] }
}

export function assistantNativeReplyMarked(reply, step) {
  return reply !== undefined && reply !== null && reply.turn === step.turn && reply.steps.includes(step.step)
}

export function assistantNativeReplyVisible(reply, step, tail) {
  if (reply?.steps === undefined) return false
  if (reply.steps.includes(step.step)) return true
  return step.status === 'settled' && step.finalNode?.messageId !== undefined
    && tail?.branchUnavailable === false && tail.closing?.finalNode?.seq === step.finalNode.seq
    && !step.blocks.some(block => block.kind === 'tool-call')
}
