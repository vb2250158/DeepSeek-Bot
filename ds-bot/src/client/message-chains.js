import { useLayoutEffect } from 'react'

const DIRECT_MESSAGE = '[data-bt-speaker]'
const HOST_MESSAGE = '[data-chat-flow-kind=assistant-step],[data-chat-flow-kind=user],[data-chat-flow-kind=steering]'
const CHAIN_BREAK_SEL = '.bt-group-msg, [data-chat-flow-kind=assistant-step], .bt-umsg, .bt-urow, [data-chat-flow-kind=user], [data-chat-flow-kind=steering], [data-pending-steering], [data-chat-flow-kind=command-input], .bt-q-inline, .bt-event, .bt-time-sep, .bt-new-sep, .bt-part-line, .bt-btw-card, .bt-learn-card'

export function syncGroupChains(flow) {
  const direct = [...flow.querySelectorAll(DIRECT_MESSAGE)]
  const owned = new Set(direct.map(row => row.closest(HOST_MESSAGE)))
  const items = [...flow.querySelectorAll(DIRECT_MESSAGE + ',' + CHAIN_BREAK_SEL)].filter(row => {
    if (row.dataset.btSpeaker !== undefined) return true
    if (owned.has(row) || row.parentElement?.closest(DIRECT_MESSAGE)) return false
    return row.getAttribute('data-chat-flow-kind') !== 'assistant-step'
      || row.querySelector('.bt-think,.bt-agent-activity,.bt-bubble,.bt-event') !== null
  })
  for (let i = 0; i < items.length; i += 1) {
    const curr = items[i]
    const prev = items[i - 1]
    const next = items[i + 1]
    const speaker = curr.dataset.btSpeaker
    if (speaker !== undefined) {
      if (prev?.dataset.btSpeaker === speaker) curr.dataset.seamPrev = ''; else delete curr.dataset.seamPrev
      if (next?.dataset.btSpeaker === speaker) curr.dataset.seamNext = ''; else delete curr.dataset.seamNext
      continue
    }
    if (!curr.classList.contains('bt-group-msg')) continue
    const botId = curr.dataset.botId
    const chainPrev = Boolean(botId && prev?.classList.contains('bt-group-msg') && prev.dataset.botId === botId)
    const chainNext = Boolean(botId && next?.classList.contains('bt-group-msg') && next.dataset.botId === botId)
    if (chainPrev) curr.dataset.chainPrev = ''; else delete curr.dataset.chainPrev
    if (chainNext) curr.dataset.chainNext = ''; else delete curr.dataset.chainNext
    const turn = curr.closest('[data-chat-group-key]')
    if (turn) {
      if (chainPrev) turn.dataset.btChainPrev = ''; else delete turn.dataset.btChainPrev
      if (chainNext) turn.dataset.btChainNext = ''; else delete turn.dataset.btChainNext
    }
  }
}

const pendingFlows = new WeakSet()
function scheduleGroupChains(flow) {
  if (!flow || pendingFlows.has(flow)) return
  pendingFlows.add(flow)
  queueMicrotask(() => {
    pendingFlows.delete(flow)
    if (flow.isConnected !== false) syncGroupChains(flow)
  })
}


export function useMessageChains(ref) {
  useLayoutEffect(() => {
    const flow = (ref.current?.closest('[data-chat-flow]') ?? ref.current?.closest('.bt-earlier'))
    if (!flow) return undefined
    scheduleGroupChains(flow)
    return () => scheduleGroupChains(flow)
  })
}
