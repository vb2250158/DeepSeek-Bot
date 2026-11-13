export const ASSISTANT_MODE_EVENT = 'rabiroute/assistant-mode'
export const ASSISTANT_CHAT_KEY = 'dsBotAssistantChat'

// Typed local tool execution owns meta. JSON and metadata must describe the same committed text.
export function assistantSayText(message, meta) {
  if (message?.isError !== false || meta?.kind !== 'rabi-assistant-say' || typeof meta.text !== 'string') return undefined
  if (!Array.isArray(message.content) || message.content.length !== 1 || message.content[0]?.type !== 'text' || typeof message.content[0].text !== 'string') return undefined
  let value
  try { value = JSON.parse(message.content[0].text) } catch { return undefined }
  return typeof value?.text === 'string' && value.text.trim() !== '' && value.text === meta.text ? value.text : undefined
}

export function assistantChatText(event, state) {
  return event.type === 'tool/result' && assistantChatActive(state, event.seq)
    ? assistantSayText(event.data?.message, event.data?.meta) : undefined
}

export function assistantChatActive(state, seq = Infinity) {
  return state?.since !== null && state?.since !== undefined && seq >= state.since
}
