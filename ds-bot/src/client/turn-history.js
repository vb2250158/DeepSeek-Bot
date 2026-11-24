import { createElement as h, useState, useSyncExternalStore } from 'react'
import { Modal } from './dsh-primitives.js'
import { BotMark } from './mark.js'
import { t } from './i18n.js'
import { contentText, elapsedLabel, toolName } from './text.js'
import { stepActivity } from './turn-reasoning.js'

export function callTree(root) {
  const calls = []
  const seen = new Set()
  const visit = call => {
    const id = call.callId ?? call
    if (seen.has(id)) return
    seen.add(id)
    calls.push(call)
    for (const child of call.subCalls ?? []) visit(child)
  }
  visit(root)
  return calls
}

const duration = ms => ms < 1000 ? ms + ' ms' : elapsedLabel(ms)
const span = (start, end) => Number.isFinite(start) && Number.isFinite(end) && end >= start ? duration(end - start) : null

function CallHistory({ root }) {
  const name = toolName(root) || root.callId
  const settled = root.kind === 'tool-result'
  const time = settled ? span(root.callTime, root.time) : null
  const args = root.argsRaw ?? root.call?.argsRaw
  const result = settled ? contentText(root.content) : ''
  const status = settled ? (root.isError ? t('Call failed') : t('Call completed')) : t('Call in progress')
  return h('details', { className: 'bt-history-call' },
    h('summary', null, h('span', null, name), h('span', { className: 'bt-set-hint' }, time ? status + ' · ' + time : status)),
    args ? h('div', null, t('Call arguments'), h('pre', null, args)) : null,
    result ? h('div', null, t('Call result'), h('pre', null, result)) : null,
    settled && root.error?.reason ? h('p', null, root.error.reason) : null)
}

function RunHistory({ source, turn, conclusion }) {
  const time = useSyncExternalStore(source.chat.subscribe, source.chat.getSnapshot)?.timeline?.turns.get(turn)
  const roots = useSyncExternalStore(source.tools.subscribe, source.tools.getSnapshot)
  const steps = useSyncExternalStore(source.steps.subscribe, source.steps.getSnapshot)
  const localCalls = steps.flatMap(stepActivity)
  const elapsed = span(time?.start?.time, time?.end?.time)
  const calls = roots.flatMap(entry => callTree(entry.root))
  return h('div', { className: 'bt-run-history' },
    h('div', { className: 'bt-set-hint' }, elapsed ? t('Total time: {time}', { time: elapsed }) : t('Total time unavailable')),
    conclusion ? h('details', { className: 'bt-history-call' },
      h('summary', null, t('Recorded closing text')), h('pre', null, conclusion)) : null,
    calls.map((root, index) => h(CallHistory, { key: root.callId ?? index, root })),
    localCalls.length ? h('ul', null, localCalls.map((line, index) => h('li', { key: index }, line))) : null,
    !calls.length && !localCalls.length ? h('p', null, t('No recorded tool calls.')) : null)
}

export function TurnHistoryAvatar({ bot, actions, sessionId, turn, conclusion }) {
  const [history, setHistory] = useState(null)
  const title = t('View run history')
  return h('span', { className: 'bt-lead' },
    h('button', { type: 'button', className: 'bt-turn-avatar', title, 'aria-label': title, 'aria-haspopup': 'dialog',
      onClick: () => setHistory({ source: actions.turnHistory?.(sessionId, turn) }) }, h(BotMark, { bot, size: 36 })),
    history ? h(Modal, { open: true, title: t('Run history'), closeLabel: t('Close Chat'), onClose: () => setHistory(null) },
      history.source ? h(RunHistory, { source: history.source, turn, conclusion }) : h('p', { role: 'status' }, t('This run is no longer available.'))) : null)
}
