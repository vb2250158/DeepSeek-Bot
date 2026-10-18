import { createElement as h, useCallback, useEffect, useState } from 'react'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { t } from './i18n.js'

/** One team switch and a read-only Rabi catalog; device permissions are managed in Rabi WebGUI. */
export function RabiComputersPage({ roster, actions, onDisconnected }) {
  const [status, setStatus] = useState(null)
  const [computers, setComputers] = useState([])
  const [managementUrl, setManagementUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [listing, setListing] = useState(false)
  const enabled = roster.prefs?.rabiRemoteControl !== false
  const call = actions.rabiComputers
  const refresh = useCallback(async signal => {
    setListing(true)
    try {
      const current = await call('rabi-computers-status', {}, signal)
      if (signal?.aborted) return
      setStatus(current)
      if (!enabled || !current.available) return
      const result = await call('rabi-computers-list', {}, signal)
      if (signal?.aborted) return
      setManagementUrl(result.managementUrl)
      if (result.error) {
        if (result.connection && result.connection.state !== 'ready') onDisconnected?.(result.connection)
        else setError(t('Could not read remote computers. Retry or check Rabi.'))
        return
      }
      setComputers(result.computers)
      setError('')
    } catch {
      if (!signal?.aborted) setError(t('Could not read remote computers. Retry or check Rabi.'))
    } finally {
      if (!signal?.aborted) setListing(false)
    }
  }, [call, enabled, onDisconnected])
  useEffect(() => {
    const abort = new AbortController()
    if (!enabled) { setComputers([]); setManagementUrl(''); setError('') }
    void refresh(abort.signal)
    return () => abort.abort()
  }, [enabled, refresh])
  const toggle = async value => {
    setBusy(true); setError('')
    try { await actions.setPrefs({ rabiRemoteControl: value }) }
    catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  return h('div', { className: 'bt-set-page' },
    h('section', { className: 'bt-set-section' },
      h('div', { className: 'bt-set-card' }, h('div', { className: 'bt-set-row' },
        h('div', { className: 'bt-set-copy' }, h('span', null, t('Allow all Bots to use remote computers')),
          h('span', { className: 'bt-set-hint' }, t('Computer access is authorized in Rabi.'))),
        h(Switch, { label: t('Allow all Bots to use remote computers'), checked: enabled, disabled: busy, onChange: value => void toggle(value) })))),
    status?.available === false ? h('p', { className: 'bt-set-hint' }, t('Install and configure dsh-rabiroute-agent on the controller first.')) : null,
    error ? h('div', { role: 'alert' }, h('p', { className: 'bt-error' }, t(error)),
      h(Button, { disabled: listing || busy, onClick: () => void refresh() }, t('Retry'))) : null,
    enabled && status?.available ? h('section', { className: 'bt-set-section' },
      h('div', { className: 'bt-set-row' }, h('h3', { className: 'bt-set-copy' }, t('Remote computers')),
        h(Button, { disabled: listing || !managementUrl, onClick: () => window.open(managementUrl, '_blank', 'noopener,noreferrer') }, t('Manage computer access in Rabi'))),
      h('div', { className: 'bt-set-card', 'aria-busy': listing },
        computers.map(item => h('div', { key: item.instanceId, className: 'bt-set-row' },
          h('div', { className: 'bt-set-copy' }, h('span', null, item.name || item.instanceId)),
          h('span', { className: 'bt-set-hint' }, t(item.connected ? 'Online' : 'Offline')))),
        listing && computers.length === 0 ? h('p', { className: 'bt-set-row' }, t('Loading…')) : null,
        !listing && !error && computers.length === 0 ? h('p', { className: 'bt-set-row' }, t('No remote computers. Add one in Rabi.')) : null)) : null)
}
