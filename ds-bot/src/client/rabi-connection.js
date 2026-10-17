import { createElement as h, useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { t } from './i18n.js'

/** Imports selected Rabi references through the host; never receives access tokens or persona bodies. */
export function RabiConnectionPage({ actions }) {
  const [status, setStatus] = useState({ available: null, connected: false, personas: [] })
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [batch, setBatch] = useState(null)
  const lifetime = useRef(null)
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    void actions.rabiConnection('rabi-connection-status', {}, controller.signal)
      .then(value => { if (!controller.signal.aborted) setStatus(previous => ({ ...previous, ...value })) })
      .catch(failure => { if (!controller.signal.aborted) setError(t(failure.message)) })
    return () => { controller.abort(); lifetime.current = null }
  }, [actions])
  const refresh = async signal => {
    const value = await actions.rabiConnection('rabi-personas-list', {}, signal)
    if (!signal.aborted) setStatus(value)
  }
  const run = async (key, action) => {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted || busy) return
    setBusy(key); setError('')
    try { await action(signal) }
    catch (failure) { if (!signal.aborted) setError(t(failure.message)) }
    finally { if (!signal.aborted) setBusy('') }
  }
  return h('div', { className: 'bt-set-page' },
    h('div', { className: 'bt-set-row' },
      h('span', { className: 'bt-set-copy' }, h('span', null, t('Local Rabi')),
        h('span', { className: 'bt-set-hint' }, t(status.connected ? 'Connected' : 'Not connected'))),
      h(Button, { disabled: Boolean(busy) || status.available !== true, onClick: () => void run('connect', refresh) }, t(status.connected ? 'Refresh personas' : 'Connect local Rabi'))),
    status.available === false ? h('p', { className: 'bt-set-hint' }, t('Install and configure dsh-rabiroute-agent on the controller first')) : null,
    error ? h('p', { className: 'bt-error', role: 'alert' }, error) : null,
    status.connected ? h('div', { className: 'bt-set-section' },
      h('div', { className: 'bt-set-row' },
        h('span', { className: 'bt-set-hint' }, t('Persona updates are read from Rabi when a Bot runs.')),
        h(Button, { disabled: Boolean(busy) || Boolean(error) || status.personas.length === 0, onClick: () => void run('all', async signal => {
          setBatch(null)
          const value = await actions.rabiConnection('rabi-personas-import-all', {}, signal)
          if (!signal.aborted) setBatch(value.results)
          await refresh(signal)
        }) }, t(busy === 'all' ? 'Importing personas…' : 'Import all personas'))),
      batch ? h('div', { role: 'status' },
        h('p', { className: 'bt-set-hint' }, t('Imported {success} · Failed {failed}', { success: batch.filter(item => item.ok).length, failed: batch.filter(item => !item.ok).length })),
        batch.filter(item => !item.ok).map(item => h('p', { className: 'bt-error', key: item.roleId }, `${item.name}: ${t(item.error)}`))) : null,
      status.personas.length === 0 ? h('p', { className: 'bt-set-hint' }, t('No personas in Rabi.')) : h('div', { className: 'bt-set-card' }, status.personas.map(persona => h('div', { className: 'bt-set-row', key: persona.id },
        h('span', { className: 'bt-set-copy' }, h('span', null, persona.name),
          persona.botId ? h('span', { className: 'bt-set-hint' }, persona.linked ? t('Linked to {name}', { name: persona.botName }) : t('Not linked · {name}', { name: persona.botName })) : null),
        h('div', { className: 'bt-rabi-actions' },
          persona.botId ? h(Button, { disabled: Boolean(busy), onClick: () => actions.openSession(persona.botId) }, t('Open Bot')) : null,
          !persona.linked ? h(Button, { disabled: Boolean(busy) || Boolean(error), onClick: () => void run(persona.id, async signal => {
            await actions.rabiConnection('rabi-persona-import', { roleId: persona.id }, signal)
            await refresh(signal)
          }) }, t(persona.botId ? 'Relink Bot' : 'Import as Bot')) : null,
          persona.linked ? h(Button, { disabled: Boolean(busy), onClick: () => void run(persona.id, async signal => {
            await actions.rabiConnection('rabi-persona-unlink', { botId: persona.botId }, signal)
            await refresh(signal)
          }) }, t('Unlink Bot')) : null))))) : null)
}
