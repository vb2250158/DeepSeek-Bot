import { createElement as h, useMemo, useState, useSyncExternalStore } from 'react'
import { MarkdownText, Modal } from './dsh-primitives.js'
import { mdLabels, t } from './i18n.js'
import { ChevronRightIcon } from './icons.js'

const RABI_METADATA_NODE = 'rabi-delivery-metadata'

export function hasRabiDeliveryHeader(text) {
  return typeof text === 'string' && /^(?:## 消息源|\[消息源\])\r?\n/.test(text)
}

// Rabi owns envelope validation. The source here is a label from the recorded text.
export function rabiAgentDelivery(nodes) {
  const head = nodes[0]
  const envelope = head?.id === RABI_METADATA_NODE && head.data?.part === 'source' ? head.data.envelope : undefined
  return envelope?.sourceType === 'agent' ? envelope : null
}

export function RabiDeliveryCandidate({ userTextRegistry, prepare, fallback, ...props }) {
  const { subscribe, getSnapshot, evaluate } = useMemo(() => ({
    subscribe: userTextRegistry.subscribe.bind(userTextRegistry),
    getSnapshot: userTextRegistry.getSnapshot.bind(userTextRegistry),
    evaluate: userTextRegistry.createEvaluator(),
  }), [userTextRegistry])
  const revision = useSyncExternalStore(subscribe, getSnapshot)
  const data = props.node.data
  const prepared = useMemo(() => prepare(data.content, data), [data, prepare])
  const envelope = useMemo(
    () => rabiAgentDelivery(evaluate({ text: prepared.text, facts: prepared.facts })),
    [evaluate, prepared, revision],
  )
  if (!envelope) return h(fallback, props)
  return h(RabiDeliveryNotice, { envelope, prepared, loadImage: props.loadImage, renderFactorySlot: props.renderFactorySlot })
}

function RabiDeliveryNotice({ envelope, prepared, loadImage, renderFactorySlot }) {
  const [open, setOpen] = useState(false)
  const label = t('Rabi message from {name}', { name: envelope.sender.sessionName })
  const { attachments, extraBlocks } = prepared
  return h('div', { className: 'bt-event' },
    h('button', {
      type: 'button', className: 'bt-event-whole', title: label,
      'aria-haspopup': 'dialog', 'aria-expanded': open, 'data-bt-rabi-delivery': '',
      onClick: () => setOpen(true),
    }, h('span', { className: 'bt-event-name' }, label), h(ChevronRightIcon)),
    open ? h(Modal, {
      open, title: label, closeLabel: t('Close Chat'), onClose: () => setOpen(false),
    },
    attachments.length > 0 || extraBlocks.length > 0 ? renderFactorySlot('conversation.chat.user.content', {
      content: { text: '', attachments, extraBlocks }, loadImage, facts: prepared.facts, interactive: true,
    }) : null,
    h(MarkdownText, { text: envelope.body, labels: mdLabels() }),
    h('details', null,
      h('summary', null, t('View original delivery')),
      h('pre', { className: 'bt-rabi-delivery-raw' }, envelope.raw))) : null)
}
