import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { language, t } from './i18n.js'
import { RabiComputersPage } from './rabi-computers.js'
import { Switch } from './bot-settings.js'

/** Imports selected Rabi references through the host; never receives access tokens or persona bodies. */
export function RabiConnectionPage({ roster, actions }) {
  const [tab, setTab] = useState('connection')
  const [status, setStatus] = useState({ state: 'checking', available: null, connected: false, personas: [] })
  const installRequest = useRef(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [batch, setBatch] = useState(null)
  const lifetime = useRef(null)
  const disconnected = useCallback(value => { setStatus(value); setTab('connection') }, [])
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
      } catch {
        if (!controller.signal.aborted) { setStatus(previous => ({ ...previous, state: 'unavailable', connected: false })); setError(t('The operation did not complete. Reconnect to verify its result.')) }
      } finally { inFlight = false; if (!controller.signal.aborted) setChecking(false) }
    }
    void connect()
    window.addEventListener('focus', connect)
    return () => { controller.abort(); window.removeEventListener('focus', connect); lifetime.current = null }
  }, [actions])
  const refresh = async signal => {
    const value = await actions.rabiConnection('rabi-connect', {}, signal)
    if (!signal.aborted) setStatus(value)
  }
  const run = async (key, action) => {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted || busy) return
    setBusy(key); setError('')
    try { await action(signal) }
    catch (failure) {
      if (!signal.aborted) {
        if (failure.code === 'bot/rabi-setup-model') setError(t('Choose a model for the Bot before requesting Rabi setup'))
        else if (failure.code === 'bot/rabi-setup-main') setError(t('Create a Bot before requesting Rabi setup'))
        else {
          const current = await actions.rabiConnection('rabi-connection-status', {}, signal).catch(() => ({ state: 'unavailable', connected: false, personas: [] }))
          if (!signal.aborted) { setStatus(current); setError(t('The operation did not complete. Reconnect to verify its result.')) }
        }
      }
    }
    finally { if (!signal.aborted) setBusy('') }
  }
  const stateLabel = checking ? 'Connecting…' : status.connected ? 'Connected' : ({ checking: 'Checking Rabi…', stopped: 'Rabi is not running', starting: 'Rabi is starting', ready: 'Rabi is running', 'not-found': 'Rabi installation was not found', unavailable: 'Rabi status is unavailable', 'adapter-missing': 'Rabi adapter is not installed', 'adapter-update': 'Update the Rabi adapter' }[status.state] ?? 'Rabi status is unavailable')
  const missing = ['not-found', 'adapter-missing'].includes(status.state) || (status.state === 'unavailable' && !status.installed)
  const install = () => run('install', async signal => {
    installRequest.current ??= crypto.randomUUID()
    const receipt = await actions.rabiConnection('rabi-install-request', { botId: roster.mainBotId, requestId: installRequest.current, locale: language() }, signal)
    if (receipt.delivered && !signal.aborted) { actions.closeSettings(); actions.openSession(receipt.botId) }
  })
  return h('div', { className: 'bt-set-page' },
    h('div', { className: 'bt-tabs bt-rabi-tabs', role: 'tablist', 'aria-label': t('Rabi settings') },
      h('button', { type: 'button', className: 'bt-tab', role: 'tab', 'aria-selected': tab === 'connection', onClick: () => setTab('connection') }, t('Connect')),
      h('button', { type: 'button', className: 'bt-tab', role: 'tab', 'aria-selected': tab === 'computers', disabled: !status.connected, title: status.connected ? undefined : t('Connect Rabi first'), onClick: () => setTab('computers') }, t('Computers'))),
    tab === 'computers' && status.connected ? h(RabiComputersPage, { roster, actions, onDisconnected: disconnected }) : null,
    h('div', { hidden: tab !== 'connection' },
    h('div', { className: 'bt-set-card' },
      h('div', { className: 'bt-set-row' },
        h('span', { className: 'bt-set-copy' }, h('span', null, t('Local Rabi')), h('span', { className: 'bt-set-hint', role: 'status' }, t(stateLabel))),
        h('div', { className: 'bt-rabi-actions' },
          status.state === 'stopped' && status.canStart ? h(Button, { disabled: Boolean(busy), onClick: () => void run('start', async signal => setStatus(await actions.rabiConnection('rabi-start', {}, signal))) }, t('Start Rabi')) : null,
          !status.connected && !missing && status.state !== 'checking' ? h(Button, { disabled: checking || Boolean(busy) || status.available === false, onClick: () => void run('connect', refresh) }, t(status.connected ? 'Refresh personas' : status.state === 'starting' ? 'Retry connection' : 'Connect local Rabi')) : null))),
    missing ? h('div', { className: 'bt-set-section' },
      h('p', { className: 'bt-set-hint' }, t('No Rabi installation path was found. Rabi may be uninstalled, unconfigured, or undiscoverable.')),
      h('p', { className: 'bt-set-hint' }, status.repositoryUrl),
      h('div', { className: 'bt-rabi-actions' },
        h(Button, { disabled: !status.repositoryUrl, onClick: () => window.open(status.repositoryUrl, '_blank', 'noopener,noreferrer') }, t('Visit Rabi on GitHub')),
        h(Button, { disabled: Boolean(busy), onClick: () => void install() }, t('Ask Bot to install and configure')))) : null,
    status.state === 'adapter-update' ? h('p', { className: 'bt-set-hint' }, t('Update dsh-rabiroute-agent to use Rabi startup and discovery.')) : null,
    status.state === 'starting' ? h('p', { className: 'bt-set-hint' }, t('After Rabi starts, retry the connection.')) : null,
    status.locationRemembered === false ? h('p', { className: 'bt-set-hint' }, t('Rabi works, but its location could not be saved. Check the local adapter settings.')) : null,
    status.connectionIssue ? h('p', { className: 'bt-set-hint' }, t('Could not read Rabi personas. Retry the connection.')) : null,
    status.available && status.hooksReady === false ? h('p', { className: 'bt-set-hint' }, t('Update dsh-rabiroute-agent and enable Rabi Agent Hooks before binding a Bot')) : null,
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
        batch.filter(item => !item.ok).map(item => h('p', { className: 'bt-error', key: item.roleId }, `${item.name}: ${t('Binding could not be confirmed. Refresh to check its state.')}`))) : null,
      status.personas.length === 0 ? h('p', { className: 'bt-set-hint' }, t('No personas in Rabi.')) : h('div', { className: 'bt-set-card' }, status.personas.map(persona => h('div', { className: 'bt-set-row', key: persona.id },
        h('span', { className: 'bt-set-copy' }, h('span', null, persona.name),
          persona.botId ? h('span', { className: 'bt-set-hint' }, persona.linked ? t('Linked to {name}', { name: persona.botName }) : t('Not linked · {name}', { name: persona.botName })) : null),
        h('div', { className: 'bt-rabi-actions' },
          persona.botId ? h(Button, { disabled: Boolean(busy), onClick: () => actions.openSession(persona.botId) }, t('Open Bot')) : null,
          h(Switch, { on: persona.linked === true, label: t('Connect {name} automatically', { name: persona.name }), disabled: Boolean(busy) || status.hooksReady !== true, onChange: on => void run(persona.id, async signal => {
            await actions.rabiConnection(on ? 'rabi-persona-import' : 'rabi-persona-unlink', on ? { roleId: persona.id } : { botId: persona.botId }, signal)
            await refresh(signal)
          }) })))))) : null))
}
