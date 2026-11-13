// Scheduled tasks: Settings → Scheduled tasks, a Bot's card in its settings, and the
// line in its details panel. DSH runs the tasks (see src/host/schedules.js); a task
// sends its prompt to the Bot's chat when it is due.
import { createElement as h, Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, Input, InlineEditor, Menu, Modal, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { BotAvatar, RoomAvatar } from './mark.js'
import { ClockIcon, PencilIcon, PlusIcon, TrashIcon } from './icons.js'
import { Segmented } from './motion.js'
import { dateLocale, hostText, t } from './i18n.js'

import { rabiDailyTimes } from '../shared/rabi-daily-times.js'

const POLL_MS = 30_000

// One view for every surface that shows tasks; each asks again when it mounts.
let shared = null
const listeners = new Set()
function publish(view) {
  shared = view
  for (const listener of listeners) listener(view)
}
export function useSchedules(actions) {
  const [view, setView] = useState(shared)
  useEffect(() => {
    listeners.add(setView)
    let stopped = false
    let timer
    const load = () => actions.schedules?.()
      .then((next) => { if (!stopped) publish(next) })
      .catch(() => {})
      .finally(() => { if (!stopped) timer = setTimeout(load, POLL_MS) })
    load()
    return () => { stopped = true; clearTimeout(timer); listeners.delete(setView) }
  }, [])
  return view
}

const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
const clock = time => String(time ?? '').slice(0, 5)
const when = (ms, options) => new Intl.DateTimeFormat(dateLocale(), options).format(ms)
function dayAndTime(ms) {
  const sameYear = new Date(ms).getFullYear() === new Date().getFullYear()
  return when(ms, { ...(sameYear ? {} : { year: 'numeric' }), month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function weekdayNames(days) {
  const names = days.map(day => when(Date.UTC(2024, 0, day), { weekday: 'short', timeZone: 'UTC' }))
  return names.join(dateLocale().startsWith('zh') || dateLocale().startsWith('ja') ? '、' : ', ')
}
function everyText(seconds) {
  if (seconds % 86400 === 0) return seconds === 86400 ? t('Every day') : t('Every {count} days', { count: seconds / 86400 })
  if (seconds % 3600 === 0) return seconds === 3600 ? t('Every hour') : t('Every {count} hours', { count: seconds / 3600 })
  return t('Every {count} minutes', { count: Math.round(seconds / 60) })
}

// How often a task runs, in the user's words.
export function timingText(task) {
  if (task.kind === 'rabi') {
    const schedule = task.schedule
    const text = schedule.type === 'daily_time' ? t('Every day at {time}', { time: (rabiDailyTimes(schedule) ?? []).join(dateLocale().startsWith('zh') ? '、' : ', ') })
      : schedule.type === 'once_at' ? t('Once, {time}', { time: dayAndTime(Date.parse(schedule.onceAt)) }) : everyText(schedule.intervalSeconds)
    return schedule.windowStartTime && schedule.windowEndTime ? `${text} · ${schedule.windowStartTime}–${schedule.windowEndTime}` : text
  }
  const zone = task.timeZone && task.timeZone !== localZone() ? ` (${task.timeZone})` : ''
  switch (task.kind) {
    case 'after':
    case 'at': return t('Once, {time}', { time: dayAndTime(Date.parse(task.scheduledAt)) })
    case 'every': return everyText(task.everySeconds)
    case 'daily': return `${t('Every day at {time}', { time: clock(task.time) })}${zone}`
    case 'weekly': {
      const days = (task.weekdays ?? []).join()
      const text = days === '1,2,3,4,5' ? t('Every weekday at {time}', { time: clock(task.time) })
        : days === '6,7' ? t('Every weekend at {time}', { time: clock(task.time) })
          : days === '1,2,3,4,5,6,7' ? t('Every day at {time}', { time: clock(task.time) })
            : t('Every {days} at {time}', { days: weekdayNames(task.weekdays ?? []), time: clock(task.time) })
      return `${text}${zone}`
    }
    case 'cron': return `${t('On the schedule {expression}', { expression: task.expression })}${zone}`
    case 'rrule': return t('On the schedule {expression}', { expression: task.rrule })
    default: return ''
  }
}
const nextText = (task) => {
  if (task.source === 'rabi') return task.status === 'paused' ? t('Paused in Rabi') : t('Enabled in Rabi')
  if (task.status === 'paused') return t('Paused')
  if (task.state === 'overdue' || (task.state === undefined && task.status === 'active' && Date.parse(task.scheduledAt) <= Date.now())) return t('Overdue: {time}', { time: dayAndTime(Date.parse(task.scheduledAt)) })
  if (task.status === 'paused') return t('Paused')
  return task.status === 'active' ? t('Next: {time}', { time: dayAndTime(Date.parse(task.scheduledAt)) }) : t('Finished')
}

function TaskRow({ task, actions, onView, showBot, roster }) {
  const [confirming, setConfirming] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!confirming) return undefined
    const timer = setTimeout(() => setConfirming(false), 3000)
    return () => clearTimeout(timer)
  }, [confirming])
  const remove = () => {
    if (!confirming) { setConfirming(true); return }
    setBusy(true)
    void actions.scheduleDelete(task.sessionId, task.id).then(onView, () => setBusy(false))
  }
  const room = task.roomId ? roster.roomsById[task.roomId] : undefined
  return h('div', { className: 'bt-set-row bt-task', 'data-done': task.status === 'active' ? undefined : '', 'data-busy': busy || undefined },
    showBot ? h(BotAvatar, { bot: roster.byId[task.botId], size: 28, badge: false, live: false }) : null,
    h('button', { type: 'button', className: 'bt-set-copy bt-task-copy', 'aria-expanded': expanded || undefined, onClick: () => setExpanded(open => !open) },
      h('span', { className: 'bt-task-title' }, task.title),
      h('span', { className: 'bt-set-hint' }, [timingText(task), room ? t('in {name}', { name: room.name }) : ''].filter(Boolean).join(' · ')),
      task.prompt && task.prompt !== task.title ? h('span', { className: 'bt-task-prompt', 'data-open': expanded || undefined }, task.prompt) : null),
    h('span', { className: 'bt-task-next', 'data-state': task.state === 'overdue' ? 'overdue' : undefined }, nextText(task)),
    task.source === 'rabi' ? null : h('button', {
      type: 'button', className: 'bt-mini bt-task-remove', 'data-confirm': confirming || undefined, disabled: busy,
      'aria-label': confirming ? t('Click again to delete') : t('Delete task'), title: confirming ? undefined : t('Delete task'), onClick: remove,
    }, confirming ? t('Delete') : h(TrashIcon)))
}

/** Reads schedules assigned to this Bot; source roles remain owned by Rabi. */
export function RabiSchedules({ bot, actions, tasks = [], roster, summary = false }) {
  const store = actions.rabiWorkspace
  const roleId = ''
  const scope = { botId: bot.id, roleId, resource: 'schedules' }
  const subscribe = useCallback(listener => store.subscribe(scope, listener), [store, bot.id, roleId])
  const snapshot = useCallback(() => store.snapshot(scope), [store, bot.id, roleId])
  const { value, pending, error } = useSyncExternalStore(subscribe, snapshot)
  const [editing, setEditing] = useState(null)
  const [opening, setOpening] = useState(false)
  const [editError, setEditError] = useState('')
  const openEditor = async task => {
    setOpening(true); setEditError('')
    try {
      const detail = await actions.rabiConnection('rabi-schedule-read', { botId: bot.id, ...(task ? { sourceRoleId: task.sourceRoleId, id: task.rawRuleId } : {}) })
      const current = task ? detail.items.find(item => item.rawRuleId === task.rawRuleId) : undefined
      if (task && !current) throw new Error(t('No such task'))
      setEditing({ task: current, revision: task ? detail.revision : undefined, roles: detail.roles ?? [] })
    } catch (failure) { setEditError(hostText(failure.message)) }
    finally { setOpening(false) }
  }
  const refresh = () => store.refresh(scope)
  useEffect(() => {
    let stopped = false, timer
    const load = () => void store.visit(scope).finally(() => { if (!stopped) timer = setTimeout(load, POLL_MS) })
    load()
    return () => { stopped = true; clearTimeout(timer) }
  }, [store, bot.id, roleId])
  const all = [...tasks, ...(value?.items ?? [])]
  const pendingWrites = store.writes(scope).filter(entry => !value?.items.some(item => item.id === entry.scope.itemId))
  return h('section', { className: 'bt-set-section', 'aria-busy': pending },
    h('div', { className: 'bt-rabi-task-heading' },
      h('div', { className: 'bt-section-title' }, summary ? t('Scheduled tasks · {count}', { count: tasks.length + (value?.total ?? value?.items.length ?? 0) }) : `${bot.name} · Rabi`),
      h(Button, { variant: 'ghost', disabled: !value || pending || opening, onClick: () => void openEditor() }, h(PlusIcon), t('New task'))),
    !value && !error ? h('div', { className: 'bt-mem-skel', 'aria-label': t('Loading…') }, h('span'), h('span')) : null,
    error ? h('div', { role: 'alert', className: 'bt-error' }, hostText(error.message), ' ', h('button', { type: 'button', className: 'bt-more', disabled: pending, onClick: () => void store.visit(scope) }, t('Retry'))) : null,
    editError ? h('p', { role: 'alert', className: 'bt-error' }, editError) : null,
    value?.warnings?.length ? h('p', { className: 'bt-set-hint' }, t('Some Rabi schedules could not be read. Check them in Rabi.')) : null,
    ...pendingWrites.map(entry => h(RabiPendingWrite, { key: entry.operation.body.operationId, entry, actions })),
    value && all.length === 0 ? h('p', { className: 'bt-set-hint' }, t('No scheduled tasks yet.')) : null,
    editing ? h(RabiScheduleForm, { key: `${bot.id}:${roleId}:${editing.task?.id ?? 'new'}`, bot, actions, ...editing,
      onDone: () => setEditing(null), onCancel: () => setEditing(null) }) : null,
    value?.nextCursor ? h(Button, { variant: 'ghost', disabled: pending, onClick: () => void store.more(scope) }, t('Load more')) : null,
    h('div', { className: summary ? 'bt-task-list' : 'bt-set-card' }, all.map(task => task.source === 'rabi'
      ? h(RabiScheduleRow, { key: `rabi:${task.id}`, task, bot, actions, revision: value.revision, summary, onView: refresh, onEdit: () => void openEditor(task) }) : summary
      ? h('button', { key: `${task.source ?? 'dsh'}:${task.id}`, type: 'button', className: 'bt-task-line', onClick: () => actions.openSettings('schedules', `bot:${bot.id}`) },
          h(ClockIcon), h('span', { className: 'bt-task-line-title' }, task.title), h('span', { className: 'bt-task-line-when' }, task.source === 'rabi' ? `${timingText(task)} · ${nextText(task)}` : timingText(task)))
      : h(TaskRow, { key: task.id, task, actions, roster, onView: publish }))))
}

export function RabiPendingWrite({ entry, actions }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const retry = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const result = await actions.rabiConnection(entry.operation.endpoint, entry.operation.body)
      actions.rabiWorkspace.accept({ ...entry.scope, itemId: undefined }, result)
      actions.rabiWorkspace.clearWrite(entry.scope)
    } catch (failure) { setError(hostText(failure.message)) }
    finally { setBusy(false) }
  }
  return h('div', { className: 'bt-set-card bt-rabi-pending', role: 'alert' },
    h('span', null, entry.operation.body.title ?? t('Scheduled task')),
    h('span', { className: 'bt-set-hint' }, error || t('This operation needs confirmation. Retry the original request.')),
    h(Button, { disabled: busy, onClick: () => void retry() }, t('Retry')))
}

export function RabiScheduleRow({ task, bot, actions, onView, onEdit, summary }) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const scope = { botId: bot.id, roleId: '', resource: 'schedules', itemId: task.id }
  const operation = useRef(actions.rabiWorkspace.write(scope))
  const run = async (endpoint, extra) => {
    if (busy) return
    setBusy(true); setError('')
    try {
      if (!operation.current) {
        const detail = await actions.rabiConnection('rabi-schedule-read', { botId: bot.id, sourceRoleId: task.sourceRoleId, id: task.rawRuleId })
        operation.current = actions.rabiWorkspace.retainWrite(scope, { endpoint, body: { botId: bot.id, sourceRoleId: task.sourceRoleId, expectedRoleId: task.sourceRoleId, id: task.rawRuleId, revision: detail.revision, operationId: crypto.randomUUID(), ...extra } })
      }
      const result = await actions.rabiConnection(operation.current.endpoint, operation.current.body)
      actions.rabiWorkspace.accept({ botId: bot.id, roleId: scope.roleId, resource: 'schedules' }, result)
      actions.rabiWorkspace.clearWrite(scope)
      operation.current = null
      setConfirming(false)
    } catch (failure) {
      if (['bot/rabi-revision-conflict', 'bot/rabi-validation', 'bot/rabi-binding-conflict', 'bot/rabi-method-not-allowed'].includes(failure.code)) {
        actions.rabiWorkspace.clearWrite(scope); operation.current = null
        await onView().catch(() => {})
      }
      setError(hostText(failure.message))
    }
    finally { setBusy(false) }
  }
  return h('div', { className: 'bt-rabi-task' },
    h('div', { className: summary ? 'bt-task-line' : 'bt-set-row bt-task bt-rabi-task-row' },
      h(ClockIcon),
      h(Button, { variant: 'ghost', className: 'bt-rabi-task-copy', onClick: onEdit, disabled: busy || Boolean(operation.current) },
        h('span', { className: 'bt-task-title' }, task.title),
        h('span', { className: 'bt-set-hint' }, `${timingText(task)} · ${nextText(task)}`)),
      h('div', { className: 'bt-rabi-task-actions' },
        h(Switch, { checked: task.status === 'active', disabled: busy || Boolean(operation.current), label: t('Activate {name}', { name: task.title }), onChange: enabled => void run('rabi-schedule-toggle', { enabled }) }),
        !summary ? h(Button, { variant: 'ghost', size: 'sm', disabled: busy || Boolean(operation.current), onClick: onEdit, 'aria-label': t('Edit task') }, h(PencilIcon)) : null,
        !summary ? h(Button, { variant: 'ghost', size: 'sm', className: 'bt-rabi-task-delete', disabled: busy || Boolean(operation.current), onClick: () => confirming ? void run('rabi-schedule-delete') : setConfirming(true), 'aria-label': t('Delete task') }, confirming ? t('Click again to delete') : h(TrashIcon)) : null)),
    error || operation.current ? h('div', { role: 'alert', className: 'bt-error' }, error || t('This operation needs confirmation. Retry the original request.'), operation.current ? h(Button, { disabled: busy, onClick: () => void run() }, t('Retry')) : null) : null)
}

/** Saves the original request key on retries; timing remains interpreted by Rabi. */
export function RabiScheduleForm({ bot, actions, task, revision, roles = [], onDone, onCancel, roster, onTarget }) {
  const scope = { botId: bot.id, roleId: '', resource: 'schedules', itemId: task?.id ?? 'new' }
  const held = actions.rabiWorkspace.write(scope)
  const schedule = held?.body.schedule ?? task?.schedule
  const [sourceRoleId, setSourceRoleId] = useState(held?.body.sourceRoleId ?? task?.sourceRoleId ?? bot.rabiPersona?.roleId ?? '')
  const [choosingRole, setChoosingRole] = useState(false)
  const [title, setTitle] = useState(held?.body.title ?? task?.title ?? '')
  const [message, setMessage] = useState(held?.body.message ?? task?.message ?? '')
  const [template, setTemplate] = useState(held?.body.template ?? task?.template ?? '')
  const [kind, setKind] = useState(schedule?.type ?? 'daily_time')
  const [times, setTimes] = useState(() => schedule?.type === 'daily_time' ? (rabiDailyTimes(schedule) ?? ['']) : ['09:00'])
  const [at, setAt] = useState(schedule?.onceAt ?? inAnHour())
  const [seconds, setSeconds] = useState(schedule?.intervalSeconds ?? 600)
  const [windowStart, setWindowStart] = useState(schedule?.windowStartTime ?? '')
  const [windowEnd, setWindowEnd] = useState(schedule?.windowEndTime ?? '')
  const [enabled, setEnabled] = useState(held?.body.enabled ?? task?.status !== 'paused')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [choosing, setChoosing] = useState(false)
  const [expectedRevision, setExpectedRevision] = useState(revision)
  const [conflict, setConflict] = useState(null)
  const operation = useRef(held)
  const locked = busy || Boolean(operation.current)
  const submit = async event => {
    event?.preventDefault()
    if (busy) return
    const retrying = Boolean(operation.current)
    const dailyTimes = kind === 'daily_time' ? rabiDailyTimes({ timeOfDays: times }) : null
    if (!operation.current && kind === 'daily_time' && !dailyTimes) { setError(t('Enter each time as HH:mm or HH:mm:ss.')); return }
    if (!operation.current && !sourceRoleId) { setError(t('Choose a Rabi role to store this rule.')); return }
    const capture = roleRevision => actions.rabiWorkspace.retainWrite(scope, { endpoint: 'rabi-schedule-save', body: { botId: bot.id, sourceRoleId, expectedRoleId: sourceRoleId, ...(task ? { id: task.rawRuleId ?? task.id } : {}), ...(task?.template ? { template } : {}), revision: roleRevision, operationId: crypto.randomUUID(), title, message, enabled,
      schedule: { type: kind, ...(kind === 'daily_time' ? { timeOfDays: dailyTimes } : kind === 'once_at' ? { onceAt: at } : { intervalSeconds: Number(seconds), windowStartTime: windowStart, windowEndTime: windowEnd }) } } })
    setBusy(true); setError('')
    try {
      if (!operation.current) {
        const detail = expectedRevision ? null : await actions.rabiConnection('rabi-schedule-read', { botId: bot.id, sourceRoleId, ...(task ? { id: task.rawRuleId ?? task.id } : {}) })
        operation.current = capture(expectedRevision ?? detail.revision)
      }
      const result = await actions.rabiConnection(operation.current.endpoint, operation.current.body)
      actions.rabiWorkspace.accept({ botId: bot.id, roleId: scope.roleId, resource: 'schedules' }, result)
      actions.rabiWorkspace.clearWrite(scope); operation.current = null
      await onDone()
    }
    catch (failure) {
      if (['bot/rabi-revision-conflict', 'bot/rabi-validation', 'bot/rabi-binding-conflict', 'bot/rabi-method-not-allowed'].includes(failure.code)) {
        actions.rabiWorkspace.clearWrite(scope); operation.current = null
      }
      if (failure.code === 'bot/rabi-destination-unavailable' && !retrying) { actions.rabiWorkspace.clearWrite(scope); operation.current = null }
      if (failure.code === 'bot/rabi-revision-conflict') {
        const latest = await actions.rabiConnection('rabi-schedule-read', { botId: bot.id, sourceRoleId, ...(task ? { id: task.rawRuleId ?? task.id } : {}) }).catch(() => null)
        if (latest) { setExpectedRevision(latest.revision); setConflict(latest.items.find(item => item.rawRuleId === (task?.rawRuleId ?? task?.id)) ?? { title: t('No such task') }) }
      }
      setError(hostText(failure.message))
    }
    finally { setBusy(false) }
  }
  const input = (label, value, change, extra = {}) => h('label', { className: 'bt-rabi-task-field' }, h('span', null, t(label)), h(Input, { value, disabled: locked, onChange: event => change(event.target.value), ...extra }))
  return h(Modal, { open: true, title: `${bot.name} · ${t(task ? 'Edit task' : 'New task')} · Rabi`, closeLabel: t('Close'), onClose: busy ? () => {} : onCancel, className: 'bt-rabi-task-dialog', contentClassName: 'bt-rabi-task-content' },
    h('form', { className: 'bt-rabi-task-form', onSubmit: event => void submit(event) },
      onTarget ? h(Menu, { open: choosing, portal: true, onClose: () => setChoosing(false), selectedId: bot.id,
        anchor: h(Button, { type: 'button', disabled: locked, onClick: () => setChoosing(true) }, t('Send to'), ' · ', bot.name),
        items: [...roster.bots, ...roster.rooms].map(item => ({ id: item.id, label: item.name })), onSelect: id => { setChoosing(false); onTarget(id) } }) : null,
      !task ? h(Menu, { open: choosingRole, portal: true, onClose: () => setChoosingRole(false), selectedId: sourceRoleId, anchor: h(Button, { type: 'button', disabled: locked, onClick: () => setChoosingRole(true) }, t('Store rule in Rabi role'), ' · ', roles.find(role => role.id === sourceRoleId)?.name ?? (sourceRoleId || t('Choose a role'))), items: roles.map(role => ({ id: role.id, label: role.name })), onSelect: id => { setSourceRoleId(id); setExpectedRevision(undefined); setChoosingRole(false) } }) : h('p', { className: 'bt-set-hint' }, t('Store rule in Rabi role'), ' · ', sourceRoleId),
      input('Name', title, setTitle, { required: true, maxLength: 120, 'data-modal-autofocus': true }),
      task?.actionType === 'run_script' ? h('p', { className: 'bt-set-hint' }, t('This task runs a script. Its action stays in Rabi.')) : h('div', { className: 'bt-rabi-task-field' }, h('span', null, t('What to do')),
        locked ? h('div', { className: 'bt-rabi-document' }, message) : h(InlineEditor, { value: message, label: t('What to do'), onChange: setMessage, onSave: () => void submit(), onCancel })),
      task?.template && task.actionType !== 'run_script' ? h('div', { className: 'bt-rabi-task-field' }, h('span', null, t('Instructions template')),
        locked ? h('div', { className: 'bt-rabi-document' }, template) : h(InlineEditor, { value: template, label: t('Instructions template'), onChange: setTemplate, onSave: () => void submit(), onCancel })) : null,
      h('div', { className: 'bt-rabi-task-kinds' }, [['daily_time', 'Every day'], ['interval', 'Repeat'], ['once_at', 'Once']].map(([value, label]) => h(Button, { key: value, type: 'button', disabled: locked, 'aria-pressed': kind === value, onClick: () => setKind(value) }, t(label)))),
      kind === 'daily_time' ? h('div', { className: 'bt-rabi-task-field' },
        ...times.map((time, index) => h('div', { key: index, className: 'bt-rabi-task-field' },
          input('Time', time, value => setTimes(current => current.map((item, position) => position === index ? value : item)), { placeholder: '09:00', 'aria-label': t('Time {number}', { number: index + 1 }), required: true }),
          times.length > 1 ? h(Button, { type: 'button', variant: 'ghost', disabled: locked, onClick: () => setTimes(current => current.filter((_, position) => position !== index)), 'aria-label': t('Remove time {number}', { number: index + 1 }) }, t('Remove time')) : null)),
        h(Button, { type: 'button', variant: 'ghost', disabled: locked, onClick: () => setTimes(current => [...current, '09:00']) }, h(PlusIcon), t('Add time')),
        h('span', { className: 'bt-set-hint' }, t('Duplicate times are combined when saved.'))) : null,
      kind === 'once_at' ? input('Date and time', at, setAt, { placeholder: '2030-01-01T09:00:00', required: true }) : null,
      kind === 'interval' ? h(Fragment, null, input('Interval in seconds', seconds, setSeconds, { type: 'number', min: 1, required: true }), input('Window start', windowStart, setWindowStart, { placeholder: '09:00' }), input('Window end', windowEnd, setWindowEnd, { placeholder: '20:30' })) : null,
      h('label', { className: 'bt-rabi-task-enabled' }, t('Enabled in Rabi'), h(Switch, { checked: enabled, label: t('Enabled in Rabi'), disabled: locked, onChange: setEnabled })),
      h('p', { className: 'bt-set-hint' }, t('Times use the Rabi host time zone.')),
      conflict ? h('div', { className: 'bt-set-card' }, t('Current rule in Rabi. Review before saving your edits.'), h('p', null, conflict.title), h('p', null, conflict.message), h('p', null, conflict.template), conflict.schedule ? timingText(conflict) : null) : null,
      error || operation.current ? h('p', { role: 'alert', className: 'bt-error' }, error || t('This operation needs confirmation. Retry the original request.')) : null,
      h('div', { className: 'bt-actions' }, h(Button, { type: 'button', disabled: busy, onClick: onCancel }, t('Cancel')), h(Button, { type: 'submit', disabled: busy || !title.trim(), variant: 'primary' }, t(operation.current && error ? 'Retry' : 'Save')))))
}

function NewRabiSchedule({ bot, roster, actions, onTarget, onCancel }) {
  const [setup, setSetup] = useState(() => null)
  const [error, setError] = useState('')
  const [choosing, setChoosing] = useState(false)
  const load = () => { setError(''); return actions.rabiConnection('rabi-schedule-read', { botId: bot.id }).then(setSetup, failure => setError(hostText(failure.message))) }
  useEffect(() => { void load() }, [bot.id])
  if (!setup) return h('div', { role: error ? 'alert' : 'status', className: error ? 'bt-error' : 'bt-set-hint' },
    h(Menu, { open: choosing, portal: true, onClose: () => setChoosing(false), selectedId: bot.id,
      anchor: h(Button, { type: 'button', onClick: () => setChoosing(true) }, t('Send to'), ' · ', bot.name),
      items: [...roster.bots, ...roster.rooms].map(item => ({ id: item.id, label: item.name })), onSelect: id => { setChoosing(false); onTarget(id) } }),
    error || t('Loading…'), error ? h(Button, { onClick: () => void load() }, t('Retry')) : null,
    h(Button, { onClick: onCancel }, t('Cancel')))
  return h(RabiScheduleForm, { bot, roster, actions, roles: setup.roles, onTarget, onCancel, onDone: onCancel })
}

const pad = number => String(number).padStart(2, '0')
function inAnHour() {
  const date = new Date(Date.now() + 3600_000)
  date.setMinutes(0, 0, 0)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`
}
const KINDS = [['at', 'Once'], ['daily', 'Every day'], ['weekly', 'Every week'], ['every', 'Repeat']]
const UNITS = [['minutes', 1, 'minutes'], ['hours', 60, 'hours'], ['days', 1440, 'days']]

export function TaskForm({ roster, actions, start, onDone, onCancel }) {
  // A task goes to a Bot's chat or to a group chat, where it reads as your message.
  const [target, setTarget] = useState(start ?? roster.bots[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [kind, setKind] = useState('daily')
  const [at, setAt] = useState(inAnHour)
  const [time, setTime] = useState('09:00')
  const [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5])
  const [count, setCount] = useState(1)
  const [unit, setUnit] = useState('hours')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const timing = () => {
    if (kind === 'at') return { kind, at: new Date(at).toISOString() }
    if (kind === 'every') return { kind, minutes: Math.round(Number(count) * UNITS.find(([id]) => id === unit)[1]) }
    return { kind, time, timeZone: localZone(), ...(kind === 'weekly' ? { weekdays } : {}) }
  }
  const submit = (event) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    let when
    try { when = timing() } catch { setError(t('Pick a date and time')); setBusy(false); return }
    void actions.scheduleCreate({ target, title, prompt, when })
      .then(onDone, (failure) => { setError(hostText(failure?.message ?? String(failure))); setBusy(false) })
  }
  const toggleDay = day => setWeekdays(days => (days.includes(day) ? days.filter(item => item !== day) : [...days, day].sort()))
  const rabiBot = roster.bots.find(bot => bot.id === target)
  if (rabiBot) return h(NewRabiSchedule, { key: rabiBot.id, bot: rabiBot, roster, actions, onTarget: setTarget, onDone, onCancel })
  return h('form', { className: 'bt-set-card bt-task-form', onSubmit: submit },
    h('label', { className: 'bt-set-row bt-bs-row' },
      h('span', { className: 'bt-set-copy' }, h('span', { className: 'bt-bs-label' }, t('Send to'))),
      h('select', { className: 'bt-select bt-task-bot', value: target, onChange: event => setTarget(event.target.value) },
        h('optgroup', { label: t('Bots') }, roster.bots.map(bot => h('option', { key: bot.id, value: bot.id }, bot.name))),
        roster.rooms.length > 0 ? h('optgroup', { label: t('Group chats') }, roster.rooms.map(room => h('option', { key: room.id, value: room.id }, room.name))) : null)),
    h('label', { className: 'bt-set-row bt-bs-row' },
      h('span', { className: 'bt-set-copy' }, h('span', { className: 'bt-bs-label' }, t('Name'))),
      h('input', { className: 'bt-bs-input', value: title, maxLength: 120, placeholder: t('Morning briefing'), autoFocus: true, onChange: event => setTitle(event.target.value) })),
    h('label', { className: 'bt-set-row bt-bs-row bt-bs-stack' },
      h('span', { className: 'bt-set-copy' }, h('span', { className: 'bt-bs-label' }, t('What to do'))),
      h('textarea', { className: 'bt-bs-input bt-bs-area', value: prompt, rows: 3, placeholder: t('Sum up what changed since yesterday and what needs me today.'), onChange: event => setPrompt(event.target.value) })),
    h('div', { className: 'bt-set-row bt-bs-row bt-bs-stack' },
      h('span', { className: 'bt-set-copy' }, h('span', { className: 'bt-bs-label' }, t('When'))),
      h(Segmented, { label: t('When'), value: kind }, KINDS.map(([id, label]) => h('button', { key: id, type: 'button', 'aria-pressed': kind === id, onClick: () => setKind(id) }, t(label)))),
      h('div', { key: kind, className: 'bt-task-when bt-veil' },
        kind === 'at' ? h('input', { className: 'bt-input', type: 'datetime-local', value: at, 'aria-label': t('Date and time'), onChange: event => setAt(event.target.value) }) : null,
        kind === 'weekly' ? h('div', { className: 'bt-task-days', role: 'group', 'aria-label': t('Days') }, [1, 2, 3, 4, 5, 6, 7].map(day => h('button', {
          key: day, type: 'button', className: 'bt-task-day', 'aria-pressed': weekdays.includes(day), onClick: () => toggleDay(day),
        }, when(Date.UTC(2024, 0, day), { weekday: 'narrow', timeZone: 'UTC' })))) : null,
        kind === 'daily' || kind === 'weekly' ? h('input', { className: 'bt-input bt-task-time', type: 'time', value: time, 'aria-label': t('Time'), onChange: event => setTime(event.target.value) }) : null,
        kind === 'every' ? h(Fragment, null,
          h('span', { className: 'bt-task-every' }, t('Every')),
          h('input', { className: 'bt-input bt-task-count', type: 'number', min: 1, value: count, 'aria-label': t('How many'), onChange: event => setCount(event.target.value) }),
          h('select', { className: 'bt-select bt-task-unit', value: unit, 'aria-label': t('Unit'), onChange: event => setUnit(event.target.value) },
            UNITS.map(([id, , label]) => h('option', { key: id, value: id }, t(label))))) : null)),
    error ? h('div', { className: 'bt-set-row' }, h('span', { className: 'bt-danger bt-set-hint' }, error)) : null,
    h('div', { className: 'bt-set-row bt-task-foot' },
      h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: onCancel }, t('Cancel')),
      h('button', { type: 'submit', className: 'bt-send bt-soft-sm', disabled: busy || !target || title.trim() === '' || prompt.trim() === '' }, busy ? t('Creating…') : t('Create task'))))
}

// Settings has no schedule service to show: Automation tasks are off in DSH.
function AutomationOff({ actions }) {
  return h('div', { className: 'bt-set-card bt-task-off' },
    h('span', { className: 'bt-task-off-mark' }, h(ClockIcon)),
    h('span', { className: 'bt-task-off-title' }, t('Turn on Automation tasks in DSH')),
    h('span', { className: 'bt-set-hint' }, t('Switch on Automation tasks on the Plugins page in Settings.')),
    h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => actions.openSettings('dsh', 'plugins') }, t('Open Plugins')))
}

// A plain `start` opens the create form for that Bot or group chat; the
// `bot:<id>`/`room:<id>` form asks for just that owner's tasks, which is how a
// Bot's own view gets here.
export function SchedulesPage({ roster, actions, start }) {
  const view = useSchedules(actions)
  const owner = start?.startsWith('bot:') ? start.slice(4) : start?.startsWith('room:') ? start.slice(5) : null
  const [adding, setAdding] = useState(Boolean(start) && owner === null)
  if (view === null) return h('div', { className: 'bt-set-hint' }, t('Loading…'))
  const shown = next => { publish(next); setAdding(false) }
  const byChat = [
    ...roster.bots.map(bot => [bot.id, h(BotAvatar, { bot, size: 18, badge: false, live: false }), bot.name, view.tasks.filter(task => task.botId === bot.id)]),
    ...roster.rooms.map(room => [room.id, h(RoomAvatar, { room, roster, size: 18 }), room.name, view.tasks.filter(task => task.botId === undefined && task.roomId === room.id)]),
  ].filter(([id, , , tasks]) => tasks.length > 0 && (owner === null || id === owner))
  return [
    ...roster.bots.filter(bot => owner === null || owner === bot.id)
      .map(bot => h(RabiSchedules, { key: `rabi:${bot.id}`, bot, actions, roster })),
    !view.available ? h(AutomationOff, { key: 'off', actions }) : null,
    !view.available && !(adding && roster.bots.some(bot => bot.id === (owner ?? start))) ? null : h(Fragment, { key: 'local' },
    adding
      ? h(TaskForm, { key: 'form', roster, actions, start: owner ?? start, onDone: shown, onCancel: () => setAdding(false) })
      : h('div', { key: 'add', className: 'bt-actions' },
          h('button', { type: 'button', className: 'bt-soft bt-soft-sm bt-with-icon', onClick: () => setAdding(true) }, h(PlusIcon), t('New task')),
          owner !== null ? h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => actions.openSettings('schedules') }, t('Show all')) : null),
    byChat.length > 0 ? h('h3', null, t('DSH tasks')) : null,
    byChat.length === 0 && !adding && roster.bots.length === 0
      ? h('div', { key: 'none', className: 'bt-set-card' }, h('div', { className: 'bt-set-row' }, h('span', { className: 'bt-set-hint' }, t('No scheduled tasks yet.'))))
      : byChat.map(([id, avatar, name, tasks]) => h('section', { key: id, className: 'bt-set-section' },
          h('h3', { className: 'bt-task-head' }, avatar, name),
          h('div', { className: 'bt-set-card' }, tasks.map(task => h(TaskRow, { key: task.id, task, actions, roster, onView: publish })))))),
  ]
}

// A Bot's tasks in its settings form, with the way to add one.
export function BotSchedules({ bot, roster, actions }) {
  const view = useSchedules(actions)
  if (view === null) return null
  const tasks = view.available ? view.tasks.filter(task => task.botId === bot.id) : []
  return h('section', { className: 'bt-set-section' },
    h('h3', null, t('Scheduled tasks')),
    actions.rabiWorkspace ? h(RabiSchedules, { key: bot.id, bot, actions, roster }) : null,
    h('div', { className: 'bt-set-card' },
      !view.available
        ? h('div', { className: 'bt-set-row bt-bs-row' },
            h('span', { className: 'bt-set-copy' }, h('span', { className: 'bt-set-hint' }, t('Switch on Automation tasks on the Plugins page in Settings.'))),
            h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => actions.openSettings('dsh', 'plugins') }, t('Open Plugins')))
        : [
            ...tasks.map(task => h(TaskRow, { key: task.id, task, actions, roster, onView: publish })),
            h('button', { key: 'new', type: 'button', className: 'bt-set-row bt-bs-row bt-gs-add', onClick: () => actions.openSettings('schedules', bot.id) }, h(PlusIcon), t('New task')),
          ]))
}

// The details panel's line: the Bot's next tasks, or how to add one.
export function ScheduleSummary({ bot, actions }) {
  const view = useSchedules(actions)
  const tasks = view?.available ? view.tasks.filter(task => task.botId === bot.id && task.status === 'active') : []
  if (actions.rabiWorkspace) return h(RabiSchedules, { key: bot.id, bot, actions, tasks, summary: true })
  return h('div', null,
    h('div', { className: 'bt-section-title' }, tasks.length === 0 ? t('Scheduled tasks') : t('Scheduled tasks · {count}', { count: tasks.length })),
    tasks.length === 0
      ? h('button', { type: 'button', className: 'bt-more', onClick: () => actions.openSettings('schedules', bot.id) }, view?.available === false ? t('Switch on Automation tasks on the Plugins page in Settings.') : t('No scheduled tasks yet. Add one'))
      : h('div', { className: 'bt-task-list' }, tasks.slice(0, 3).map(task => h('button', { key: task.id, type: 'button', className: 'bt-task-line', onClick: () => actions.openSettings('schedules', `bot:${bot.id}`) },

          h(ClockIcon), h('span', { className: 'bt-task-line-title' }, task.title), h('span', { className: 'bt-task-line-when' }, timingText(task))))))
}

export const SCHEDULE_CSS = `
.bt-task{gap:10px}
.bt-task[data-done]{opacity:.6}
.bt-task[data-busy]{opacity:.4}
.bt-task-title{font-size:13px;line-height:18px;font-weight:500;overflow-wrap:anywhere}
.bt-task-prompt{font-size:12px;line-height:16px;color:var(--bt-ink-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.bt-task-prompt[data-open]{display:block;-webkit-line-clamp:unset;overflow:visible;overflow-wrap:anywhere;white-space:pre-wrap}
.bt-task-copy{padding:0;border:0;background:none;font:inherit;text-align:left;cursor:pointer}
.bt-task-next{flex:none;font-size:12px;line-height:16px;color:var(--bt-ink-3);font-variant-numeric:tabular-nums;white-space:nowrap}
.bt-task-next[data-state=overdue]{color:var(--bt-danger)}
.bt-task-remove{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;color:var(--bt-ink-3)}
.bt-task-remove svg{width:14px;height:14px}
.bt-task-remove[data-confirm]{background:color-mix(in srgb,var(--bt-danger) 10%,transparent);color:var(--bt-danger)}
.bt-task-head{display:flex;align-items:center;gap:6px}
.bt-task-form{animation:bt-q-in .4s cubic-bezier(.22,1,.36,1),bt-veil-in .2s ease-out}
.bt-task-bot{width:auto;min-width:160px;max-width:58%}
.bt-task-when{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.bt-task-when .bt-input{width:auto;height:32px}
.bt-task-time{min-width:110px}
.bt-task-count{width:72px!important}
.bt-task-unit{width:auto;height:32px}
.bt-task-every{font-size:13px;color:var(--bt-ink-2)}
.bt-task-days{display:flex;gap:4px}
.bt-task-day{width:30px;height:30px;border-radius:50%;border:1px solid var(--bt-line);background:none;color:var(--bt-ink-2);font:inherit;font-size:12px;cursor:pointer;transition:background-color .12s ease,color .12s ease,border-color .12s ease}
.bt-task-day[aria-pressed=true]{background:var(--bt-user);border-color:var(--bt-user);color:var(--bt-user-ink)}
.bt-task-foot{justify-content:flex-end;gap:8px}
.bt-task-foot .bt-send{height:28px;font-size:12px}
.bt-task-off{align-items:center;gap:8px;padding:28px 20px;text-align:center}
.bt-task-off>*+*{border-top:0}
.bt-task-off-mark{width:44px;height:44px;border-radius:50%;background:var(--bt-hover);display:flex;align-items:center;justify-content:center;color:var(--bt-ink-2)}
.bt-task-off-mark svg{width:20px;height:20px}
.bt-task-off-title{font-size:14px;line-height:20px;font-weight:600}
.bt-task-off .bt-set-hint{max-width:380px}
.bt-task-list{display:flex;flex-direction:column;gap:2px}
.bt-task-line{display:flex;align-items:center;gap:8px;width:100%;min-width:0;padding:6px 8px;border:0;border-radius:8px;background:none;color:var(--bt-ink);font:inherit;font-size:13px;text-align:left;cursor:pointer;transition:background-color .12s ease}
.bt-task-line:hover{background:var(--bt-hover)}
.bt-task-line svg{flex:none;color:var(--bt-ink-3)}
.bt-task-line-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-task-line-when{flex:none;font-size:12px;color:var(--bt-ink-3)}
.bt-rabi-task-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}
.bt-rabi-task-heading .bt-section-title{margin:0}
.bt-rabi-task-row,.bt-rabi-task>.bt-task-line{display:grid;grid-template-columns:16px minmax(0,1fr) auto;align-items:start;gap:8px}
.bt-rabi-task-row>svg,.bt-rabi-task>.bt-task-line>svg{width:16px;height:16px;margin-top:6px}
.bt-rabi-task-actions{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:6px;min-width:0;max-width:100%}
.bt-rabi-task-delete{height:auto!important;min-height:28px;min-width:0;max-width:100%;white-space:normal!important;overflow-wrap:anywhere}
.bt-rabi-task-copy{display:flex!important;flex:1;min-width:0;height:auto!important;min-height:36px;flex-direction:column;align-items:flex-start!important;text-align:left;white-space:normal!important;padding-block:4px!important}
.bt-rabi-task-copy .bt-set-hint{font-size:12px;overflow-wrap:anywhere}
.bt-rabi-task-form{display:flex;flex-direction:column;gap:12px}
.bt-rabi-task-field{display:flex;flex-direction:column;gap:6px;min-width:0;font-size:13px}
.bt-rabi-task-kinds,.bt-rabi-task-enabled{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.bt-rabi-task-dialog{width:min(480px,100%);max-height:100%}
.bt-rabi-task-content{min-height:0;overflow-y:auto;overscroll-behavior:contain}
.bt-rabi-pending{display:flex;flex-direction:column;gap:6px;padding:8px;font-size:13px}
@media (prefers-reduced-motion:reduce){.bt-task-form{animation:none}}
/* Phone-width viewports: the form's fixed minimums would overflow; let the
   fields wrap and share the row. */
@media (max-width:640px){
  .bt-rabi-task-row>.bt-rabi-task-actions{grid-column:2/-1;justify-content:flex-start}
  .bt-task-bot{min-width:0;width:100%}
  .bt-task-time{min-width:0;flex:1 1 110px}
  .bt-task-count{width:auto!important;flex:1 1 72px}
}
`
