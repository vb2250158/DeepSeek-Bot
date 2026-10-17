import { createElement as h, useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { hostText, t } from './i18n.js'

const RESOURCES = [['memory', 'Memory'], ['plans', 'Plans'], ['skills', 'Role skills'], ['persona', 'Persona']]

/** Reads the selected bound persona from Rabi; lists and documents are never saved locally. */
export function RabiWorkspace({ bot, actions }) {
  const [resource, setResource] = useState('memory')
  const [kind, setKind] = useState('recent')
  const [query, setQuery] = useState({})
  const [view, setView] = useState(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setPending(true); setError('')
    void actions.rabiConnection('rabi-bot-view', { botId: bot.id, resource, kind, ...query }, controller.signal)
      .then(value => { if (!controller.signal.aborted) setView(value) })
      .catch(failure => { if (!controller.signal.aborted) setError(hostText(failure.message)) })
      .finally(() => { if (!controller.signal.aborted) setPending(false) })
    return () => controller.abort()
  }, [bot.id, resource, kind, query, actions])
  const select = value => { setView(null); setResource(value); setQuery({}) }
  const detail = view?.detail
  const text = view?.text ?? detail?.content ?? detail?.description ?? detail?.text
  return h('div', { className: 'bt-set-page' },
    h('div', { className: 'bt-rabi-actions', role: 'group', 'aria-label': t('Rabi resources') },
      RESOURCES.map(([value, label]) => h(Button, { key: value, 'aria-pressed': resource === value, onClick: () => select(value) }, t(label)))),
    resource === 'memory' ? h('div', { className: 'bt-rabi-actions' }, [['recent', 'Recent memory'], ['consolidated', 'Consolidated memory'], ['archived', 'Archived memory']].map(([value, label]) => h(Button, { key: value, 'aria-pressed': kind === value, onClick: () => { setKind(value); setView(null); setQuery({}) } }, t(label)))) : null,
    h('div', { className: 'bt-rabi-actions' },
      query.itemId ? h(Button, { onClick: () => { setView(null); setQuery({}) } }, t('Back')) : null,
      h(Button, { disabled: pending, onClick: () => setQuery(previous => ({ ...previous })) }, t('Refresh'))),
    error ? h('p', { className: 'bt-error', role: 'alert' }, error) : null,
    pending ? h('div', { className: 'bt-mem-skel', 'aria-busy': true, 'aria-label': t('Loading…') }, h('span'), h('span')) : null,
    view && !pending ? h('div', null,
      detail?.title ? h('h3', null, detail.title) : null,
      typeof text === 'string' ? h('div', { className: 'bt-rabi-document' }, text) : null,
      detail?.steps ? h('ol', null, detail.steps.map((step, index) => h('li', { key: step.id ?? index }, step.title ?? step.content ?? step.description, step.status ? ` · ${step.status}` : ''))) : null,
      view.items?.length ? h('div', { className: 'bt-set-card' }, view.items.map(item => h('div', { className: 'bt-set-row', key: item.id },
        h('span', { className: 'bt-set-copy' }, h('span', null, item.title ?? item.id), item.summary ? h('span', { className: 'bt-set-hint' }, item.summary) : null, item.status ? h('span', { className: 'bt-set-hint' }, item.status) : null),
        resource === 'memory' && kind === 'archived' ? null : h(Button, { onClick: () => { setView(null); setQuery({ itemId: item.id }) } }, t('View'))))) : !detail && !text ? h('p', { className: 'bt-set-hint' }, t('No items in Rabi.')) : null,
      view.nextCursor ? h(Button, { onClick: () => { setView(null); setQuery({ cursor: view.nextCursor }) } }, t('Next page')) : null) : null)
}

/** Uses the native dialog controls and keeps the Rabi resource owner visible. */
export function RabiWorkspaceDialog({ bot, actions }) {
  return h(Modal, { open: true, title: `${bot.name} · Rabi`, closeLabel: t('Close'), onClose: actions.closeMemory, className: 'bt-rabi-dialog' }, h(RabiWorkspace, { bot, actions }))
}
