import { createElement as h, useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { hostText, t } from './i18n.js'

const RESOURCES = [['memory', 'Memory'], ['plans', 'Plans'], ['skills', 'Role skills'], ['persona', 'Persona']]
const MEMORY = [['recent', 'Recent memory'], ['consolidated', 'Consolidated memory'], ['archived', 'Archived memory']]

function Resource({ bot, actions, resource, kind, itemId, open, back, label }) {
  const store = actions.rabiWorkspace
  const roleId = bot.rabiPersona.roleId
  const scope = { botId: bot.id, roleId, resource, ...(kind ? { kind } : {}), ...(itemId ? { itemId } : {}) }
  const subscribe = useCallback(listener => store.subscribe(scope, listener), [store, bot.id, roleId, resource, kind, itemId])
  const snapshot = useCallback(() => store.snapshot(scope), [store, bot.id, roleId, resource, kind, itemId])
  const { value: view, pending, error, updatedAt } = useSyncExternalStore(subscribe, snapshot)
  useEffect(() => { void store.visit(scope) }, [store, bot.id, roleId, resource, kind, itemId])
  const detail = view?.detail
  const text = view?.text ?? detail?.content ?? detail?.description ?? detail?.text
  return h('section', { className: 'bt-rabi-resource', 'aria-label': t(label), 'aria-busy': pending },
    label && resource === 'memory' && !itemId ? h('h3', { className: 'bt-section-title' }, t(label)) : null,
    itemId ? h(Button, { onClick: back }, t('Back')) : null,
    error ? h('p', { className: 'bt-error', role: 'alert' }, hostText(error.message)) : null,
    view && pending ? h('span', { className: 'bt-rabi-updating', role: 'status' }, t('Updating…')) : null,
    view && error && updatedAt ? h('span', { className: 'bt-set-hint' }, t('Showing saved view from {time}', { time: new Date(updatedAt).toLocaleTimeString() })) : null,
    !view && !error ? h('div', { className: 'bt-mem-skel', 'aria-label': t('Loading…') }, h('span'), h('span')) : null,
    view ? h('div', null,
      detail?.title ? h('h3', null, detail.title) : null,
      typeof text === 'string' ? h('div', { className: 'bt-rabi-document' }, text) : null,
      detail?.steps ? h('ol', null, detail.steps.map((step, index) => h('li', { key: step.id ?? index }, step.title ?? step.content ?? step.description, step.status ? ` · ${step.status}` : ''))) : null,
      view.items?.length ? h('div', { className: 'bt-set-card' }, view.items.map(item => h('div', { className: 'bt-set-row', key: item.id },
        h('span', { className: 'bt-set-copy' }, h('span', null, item.title ?? item.id), item.summary ? h('span', { className: 'bt-set-hint' }, item.summary) : null, item.status ? h('span', { className: 'bt-set-hint' }, item.status) : null),
        kind === 'archived' ? null : h(Button, { onClick: () => open({ itemId: item.id, kind }) }, t('View'))))) : !detail && !text ? h('p', { className: 'bt-set-hint' }, t('No items in Rabi.')) : null,
      view.nextCursor ? h(Button, { disabled: pending, onClick: () => void store.more(scope) }, t('Load more')) : null) : null)
}

/** Keeps reads alive across tab changes; the plugin owns the window-local cache lifetime. */
export function RabiWorkspace({ bot, actions }) {
  const store = actions.rabiWorkspace
  const [{ resource, query }, setSelection] = useState(() => store.selection(bot.id, bot.rabiPersona.roleId))
  const save = value => { store.select(bot.id, bot.rabiPersona.roleId, value); setSelection(value) }
  const setQuery = value => save({ resource, query: value })
  const select = value => {
    if (value === resource && !query.itemId) {
      for (const kind of value === 'memory' ? MEMORY.map(([id]) => id) : [undefined]) void store.visit({ botId: bot.id, roleId: bot.rabiPersona.roleId, resource, ...(kind ? { kind } : {}) })
    }
    save({ resource: value, query: {} })
  }
  return h('div', { className: 'bt-rabi-workspace' },
    h('div', { className: 'bt-rabi-resources', role: 'tablist', 'aria-label': t('Rabi resources') },
      RESOURCES.map(([value, label]) => h('button', { key: value, type: 'button', role: 'tab', 'aria-selected': resource === value, onClick: () => select(value) }, t(label)))),
    resource === 'memory' && !query.itemId ? MEMORY.map(([kind, label]) => h(Resource, { key: `${bot.id}:${kind}`, bot, actions, resource, kind, label, open: setQuery }))
      : h(Resource, { key: `${bot.id}:${resource}:${query.itemId ?? ''}`, bot, actions, resource, ...query, label: RESOURCES.find(([value]) => value === resource)[1], open: setQuery, back: () => setQuery({}) }))
}

/** Uses native dialog controls and keeps the Rabi resource owner visible. */
export function RabiWorkspaceDialog({ bot, actions }) {
  return h(Modal, { open: true, title: `${bot.name} · Rabi`, closeLabel: t('Close'), onClose: actions.closeMemory, className: 'bt-rabi-dialog' }, h(RabiWorkspace, { bot, actions }))
}
