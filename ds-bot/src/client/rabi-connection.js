import { createElement as h, useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { t } from './i18n.js'
import { Switch } from './bot-settings.js'

/** Imports selected Rabi references through the host; never receives access tokens or persona bodies. */
export function RabiConnectionPage({ actions }) {
  const [status, setStatus] = useState({ available: null, connected: false, personas: [] })
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [batch, setBatch] = useState(null)
  const lifetime = useRef(null)
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    let inFlight = false
    const connect = async () => {
      if (inFlight || controller.signal.aborted) return
      inFlight = true
      setChecking(true)
      try {
        const value = await actions.rabiConnection('rabi-connection-status', {}, controller.signal)
        if (!controller.signal.aborted) setStatus(previous => ({ ...previous, ...value }))
        if (value.available) await refresh(controller.signal)
        if (!controller.signal.aborted) setError('')
      } catch (failure) {
        if (!controller.signal.aborted) { setStatus(previous => ({ ...previous, connected: false })); setError(t(failure.message)) }
      } finally { inFlight = false; if (!controller.signal.aborted) setChecking(false) }
    }
    void connect()
    window.addEventListener('focus', connect)
    return () => { controller.abort(); window.removeEventListener('focus', connect); lifetime.current = null }
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
        h('span', { className: 'bt-set-hint', role: 'status' }, t(status.available === null || checking ? 'Connecting…' : status.connected ? 'Connected' : 'Not connected'))),
      !status.connected ? h(Button, { disabled: Boolean(busy) || checking || status.available !== true, onClick: () => void run('connect', refresh) }, t('Retry')) : null),
    status.available === false ? h('p', { className: 'bt-set-hint' }, t('Install and configure dsh-rabiroute-agent on the controller first')) : null,
    status.available && status.hooksReady === false ? h('p', { className: 'bt-error' }, t('Update dsh-rabiroute-agent and enable Rabi Agent Hooks before binding a Bot')) : null,
    error ? h('p', { className: 'bt-error', role: 'alert' }, error) : null,
    status.connected ? h('div', { className: 'bt-set-section' },
      h('div', { className: 'bt-set-row' },
        h('span', { className: 'bt-set-hint' }, t('Persona, memory, plans and skills come from Rabi.')),
        h(Button, { disabled: Boolean(busy) || Boolean(error) || status.hooksReady !== true || status.personas.length === 0, onClick: () => void run('all', async signal => {
          setBatch(null)
          const value = await actions.rabiConnection('rabi-personas-import-all', {}, signal)
          if (!signal.aborted) setBatch(value.results)
          await refresh(signal)
        }) }, t(busy === 'all' ? 'Binding personas…' : 'Bind all personas'))),
      batch ? h('div', { role: 'status' },
        h('p', { className: 'bt-set-hint' }, t('Bound {success} · Failed {failed}', { success: batch.filter(item => item.ok).length, failed: batch.filter(item => !item.ok).length })),
        batch.filter(item => !item.ok).map(item => h('p', { className: 'bt-error', key: item.roleId }, `${item.name}: ${t(item.error)}`))) : null,
      status.personas.length === 0 ? h('p', { className: 'bt-set-hint' }, t('No personas in Rabi.')) : h('div', { className: 'bt-set-card' }, status.personas.map(persona => h('div', { className: 'bt-set-row', key: persona.id },
        h('span', { className: 'bt-set-copy' }, h('span', null, persona.name),
          persona.botId ? h('span', { className: 'bt-set-hint' }, persona.linked ? t('Linked to {name}', { name: persona.botName }) : t('Not linked · {name}', { name: persona.botName })) : null),
        h('div', { className: 'bt-rabi-actions' },
          persona.botId ? h(Button, { disabled: Boolean(busy), onClick: () => actions.openSession(persona.botId) }, t('Open Bot')) : null,
          h(Switch, { on: persona.linked === true, label: t('Connect {name} automatically', { name: persona.name }), disabled: Boolean(busy) || status.hooksReady !== true, onChange: on => void run(persona.id, async signal => {
            await actions.rabiConnection(on ? 'rabi-persona-import' : 'rabi-persona-unlink', on ? { roleId: persona.id } : { botId: persona.botId }, signal)
            await refresh(signal)
          }) })))))) : null)
}
