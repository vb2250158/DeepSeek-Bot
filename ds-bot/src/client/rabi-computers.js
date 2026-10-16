import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { t } from './i18n.js'

/** Existing Rabi terminal, addressed by exact instance and terminal IDs. */
function RemoteTerminal({ computer, call }) {
  const [catalog, setCatalog] = useState({ shells: [], sessions: [] })
  const [selected, setSelected] = useState(null)
  const [cwd, setCwd] = useState('')
  const [command, setCommand] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [observation, setObservation] = useState(0)
  const pending = useRef(null)
  const lifetime = useRef(null)
  const operation = (endpoint, body = {}, signal = lifetime.current?.signal) => call(endpoint, { instanceId: computer.instanceId, ...body }, signal)
  const query = async signal => {
    const result = await operation('rabi-computer-terminals', {}, signal)
    if (signal?.aborted) return
    setCatalog(result)
    setSelected(previous => previous ? result.sessions.find(item => item.terminalId === previous.terminalId) ?? null : null)
    pending.current = null; setBlocked(false)
    setObservation(previous => previous + 1)
  }
  useEffect(() => {
    const abort = new AbortController()
    lifetime.current = abort
    void query(abort.signal).catch(failure => { if (!abort.signal.aborted) setError(failure.message) })
    return () => { abort.abort(); lifetime.current = null }
  }, [computer.instanceId])
  useEffect(() => {
    if (!selected) return
    const abort = new AbortController()
    let after = 0
    let timer
    setOutput('')
    const pull = async () => {
      try {
        const value = await operation('rabi-computer-output', { terminalId: selected.terminalId, after }, abort.signal)
        if (abort.signal.aborted) return
        after = value.nextOutputSequence
        setOutput(previous => (previous + (value.truncated ? `\n[${t('Earlier output was truncated')}]\n` : '')
          + value.outputEvents.map(event => event.type === 'output' ? event.data ?? '' : event.type === 'exit' ? `\n[${t('Exit code')}: ${event.exitCode}]\n` : '').join('')).slice(-262144))
        setSelected(previous => previous?.terminalId === value.terminal.terminalId
          ? { ...value.terminal, nextInputSequence: Math.max(previous.nextInputSequence, value.terminal.nextInputSequence) } : previous)
        if (value.terminal.state === 'running') timer = setTimeout(pull, 250)
      } catch (failure) {
        if (!abort.signal.aborted) { setError(failure.message); setBlocked(true) }
      }
    }
    void pull()
    return () => { abort.abort(); clearTimeout(timer) }
  }, [selected?.terminalId, observation])
  const run = async fn => {
    setBusy(true); setError('')
    try { await fn() }
    catch (failure) { if (lifetime.current && !lifetime.current.signal.aborted) { setError(failure.message); setBlocked(true) } }
    finally { setBusy(false) }
  }
  const open = shell => run(async () => {
    const body = { action: 'open', terminalId: crypto.randomUUID(), shell, ...(cwd.trim() ? { cwd: cwd.trim() } : {}) }
    pending.current = body
    const session = await operation('rabi-computer-terminal', body)
    if (!lifetime.current) return
    pending.current = null; setBlocked(false); setSelected(session)
    setCatalog(previous => ({ ...previous, sessions: [...previous.sessions.filter(item => item.terminalId !== session.terminalId), session] }))
  })
  const input = data => run(async () => {
    const body = { action: 'input', terminalId: selected.terminalId, sequence: selected.nextInputSequence, data }
    pending.current = body
    const receipt = await operation('rabi-computer-terminal', body)
    if (!lifetime.current) return
    pending.current = null
    setSelected(previous => previous?.terminalId === body.terminalId ? { ...previous, nextInputSequence: Math.max(previous.nextInputSequence, receipt.nextInputSequence) } : previous)
    setCommand('')
  })
  return h('section', { className: 'bt-set-section' }, h('h3', null, `${computer.name ?? computer.instanceId} · ${t('Remote terminal')}`),
    h('div', { className: 'bt-set-card bt-rabi-terminal' },
      h('p', { className: 'bt-set-hint' }, t('Closing this panel keeps the Rabi terminal. Exit terminal ends its child processes.')),
      error ? h('p', { className: 'bt-error', role: 'alert' }, error) : null,
      pending.current ? h('p', { className: 'bt-set-hint' }, `${t('Original terminal')}: ${pending.current.terminalId} · ${pending.current.sequence ?? pending.current.action}`) : null,
      h('div', { className: 'bt-rabi-actions' },
        h(Button, { disabled: busy, onClick: () => void run(() => query(lifetime.current?.signal)) }, t('Query original sessions')),
        catalog.shells.map(shell => h(Button, { key: shell, disabled: busy || blocked, onClick: () => void open(shell) }, t('New {shell} terminal', { shell })))),
      h('label', null, t('Remote working directory'), h(Input, { value: cwd, onChange: event => setCwd(event.target.value) })),
      h('div', { className: 'bt-rabi-actions' }, catalog.sessions.map(session => h(Button, { key: session.terminalId, disabled: busy, 'aria-pressed': selected?.terminalId === session.terminalId,
        onClick: () => { setSelected(session); setBlocked(false) } }, `${session.shell} · ${session.terminalId.slice(0, 8)} · ${session.state}`))),
      selected ? h('div', null,
        h('p', { className: 'bt-set-hint' }, `${selected.terminalId} · ${selected.cwd}`),
        h('pre', { className: 'bt-rabi-output', 'aria-label': t('Terminal output') }, output),
        h('label', null, t('Remote command'), h('textarea', { className: 'bt-input bt-input-area', 'aria-label': t('Remote command'), value: command, rows: 2, onChange: event => setCommand(event.target.value) })),
        h('div', { className: 'bt-rabi-actions' },
          h(Button, { disabled: busy || blocked || selected.state !== 'running' || !command.trim(), onClick: () => void input(command + '\r') }, t('Send command')),
          h(Button, { disabled: busy || blocked || selected.state !== 'running', onClick: () => void input('\u0003') }, t('Interrupt command')),
          h(Button, { disabled: busy, onClick: () => void run(async () => {
            await operation('rabi-computer-terminal', { action: 'close', terminalId: selected.terminalId })
            await query(lifetime.current?.signal)
          }) }, t('Exit terminal and stop child processes')))) : null))
}

/** Thin presentation over Rabi's computer catalog; stores only the panel preference.
 *  Manager is contacted only after the panel is open and enabled — never during plugin apply / web boot. */
export function RabiComputersPage({ roster, actions }) {
  const [status, setStatus] = useState(null)
  const [computers, setComputers] = useState([])
  const [target, setTarget] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [listing, setListing] = useState(false)
  const enabled = roster.prefs?.rabiComputers === true
  const call = actions.rabiComputers
  // Local status only (tool presence). Never hits Manager; safe to poll.
  useEffect(() => {
    const abort = new AbortController()
    let timer
    const refresh = async () => {
      try {
        const current = await call('rabi-computers-status', {}, abort.signal)
        if (!abort.signal.aborted) setStatus(current)
      } catch (failure) {
        if (!abort.signal.aborted) setError(failure.message)
      }
      if (!abort.signal.aborted) timer = setTimeout(refresh, 5000)
    }
    void refresh()
    return () => { abort.abort(); clearTimeout(timer) }
  }, [call])
  // Manager list: only when the panel preference is on. Soft failure stays in the panel.
  const loadComputers = useCallback(async (signal) => {
    if (!enabled) { setComputers([]); return }
    setListing(true)
    try {
      const value = await call('rabi-computers-list', {}, signal)
      if (signal?.aborted) return
      setComputers(Array.isArray(value?.computers) ? value.computers : [])
      if (value?.error) setError(value.error)
      else setError('')
    } catch (failure) {
      if (!signal?.aborted) {
        setComputers([])
        setError(failure.message)
      }
    } finally {
      if (!signal?.aborted) setListing(false)
    }
  }, [call, enabled])
  useEffect(() => {
    if (!enabled) { setComputers([]); setTarget(''); return }
    const abort = new AbortController()
    // Defer one tick so settings / plugin activation paint first.
    const idle = setTimeout(() => { void loadComputers(abort.signal) }, 0)
    return () => { clearTimeout(idle); abort.abort() }
  }, [enabled, loadComputers])
  const selected = computers.find(item => item.instanceId === target && item.connected && !item.local)
  const toggle = async value => {
    setBusy(true); setError('')
    try { await actions.setPrefs({ rabiComputers: value }) }
    catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  return h('div', null,
    h('section', { className: 'bt-set-section' }, h('h3', null, t('Rabi remote computers')),
      h('div', { className: 'bt-set-card' }, h('div', { className: 'bt-set-row' },
        h('div', { className: 'bt-set-copy' }, h('span', null, t('Use Rabi computer panel')),
          h('span', { className: 'bt-set-hint' }, t('Reuses Rabi connections and permissions. This switch only controls the DS Bot panel. Manager is contacted only after you turn this on.'))),
        h(Switch, { label: t('Use Rabi computer panel'), checked: enabled, disabled: busy || !status?.available, onChange: value => void toggle(value) })))),
    status && !status.available ? h('p', { className: 'bt-set-hint' }, t('Install and configure dsh-rabiroute-agent on the controller first.')) : null,
    error ? h('p', { className: 'bt-error', role: 'alert' }, error) : null,
    enabled ? h('section', { className: 'bt-set-section' }, h('h3', null, t('Connected computers')),
      h('div', { className: 'bt-rabi-actions', style: { marginBottom: 8 } },
        h(Button, { disabled: listing || busy, onClick: () => void loadComputers() }, listing ? t('Loading…') : t('Refresh computers'))),
      h('div', { className: 'bt-set-card' }, computers.filter(item => !item.local).map(item => h('div', { key: item.instanceId, className: 'bt-set-row' },
        h('div', { className: 'bt-set-copy' }, h('span', null, item.name ?? item.instanceId), h('span', { className: 'bt-set-hint' }, `${item.connected ? t('Online') : t('Offline')} · ${item.instanceId}`)),
        h(Button, { disabled: !item.connected, onClick: () => setTarget(item.instanceId) }, t('Remote terminal')))),
      computers.filter(item => !item.local).length === 0 ? h('p', { className: 'bt-set-row' }, t('No Rabi remote computers found. Pair clients in Rabi.')) : null)) : null,
    enabled && selected ? h(RemoteTerminal, { key: selected.instanceId, computer: selected, call }) : null)
}
