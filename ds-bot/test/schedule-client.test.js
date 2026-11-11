import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { randomUUID } from 'node:crypto'
import { createRabiWorkspaceStore } from '../src/client/rabi-workspace-store.js'

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/schedules.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
let view
let hooks = null, hookIndex = 0
const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  Fragment: 'fragment', useState: initial => {
    if (!hooks) return [initial === null ? view : typeof initial === 'function' ? initial() : initial, () => {}]
    const state = hooks, index = hookIndex++
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
    return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
  },
  useEffect() {}, useLayoutEffect() {}, useRef: current => {
    if (!hooks) return { current }
    const index = hookIndex++
    return hooks[index] ??= { current }
  },
  useMemo: make => make(), useCallback: fn => fn, useId: () => 'id',
  useSyncExternalStore: (subscribe, read) => read(),
  createContext: value => ({ value, Provider: () => null }), useContext: context => context.value,
}
const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports,
  crypto: { randomUUID },
  require: name => (name === 'react' ? react : name === 'react-dom' ? { createPortal: node => node } : { Button: 'button', Input: 'input', InlineEditor: 'textarea', Modal: 'dialog', Switch: 'switch', Menu: 'menu' }),
})
const { timingText, BotSchedules, RabiSchedules, ScheduleSummary, SchedulesPage, RabiScheduleForm, RabiScheduleRow, RabiPendingWrite, TaskForm } = module.exports
const text = node => node == null ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node)
const expand = node => node == null ? node : Array.isArray(node) ? node.map(expand) : typeof node !== 'object' ? node : typeof node.type === 'function' ? expand(node.type(node.props)) : { ...node, props: { ...node.props, children: expand(node.props.children) } }
function all(node, className) {
  if (node == null || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(entry => all(entry, className))
  return [...((node.props?.className ?? '').split(' ').includes(className) ? [node] : []), ...all(node.props?.children, className)]
}
const nodes = node => node == null || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)]
const render = (component, props) => {
  const state = []
  return () => {
    hooks = state; hookIndex = 0
    try { return component(props) } finally { hooks = null }
  }
}
const flush = () => new Promise(resolve => setImmediate(resolve))

test('canonical recurrence rules remain visible in task descriptions', () => {
  const rrule = 'DTSTART;TZID=Asia/Shanghai:20300101T090000\nRRULE:FREQ=DAILY'
  assert.equal(timingText({ kind: 'rrule', rrule }), `On the schedule ${rrule}`)
})

test('paused Host tasks show Paused while ended and overdue tasks retain their states', () => {
  const bot = { id: 'chief', name: 'Chief' }
  const base = { botId: bot.id, sessionId: bot.id, kind: 'rrule', rrule: 'DTSTART:20300101T090000Z\nRRULE:FREQ=DAILY', title: 'Briefing', prompt: 'Check', scheduledAt: '2030-01-01T09:00:00.000Z' }
  view = { available: true, tasks: [
    { ...base, id: 'paused', status: 'paused', state: 'paused' },
    { ...base, id: 'ended', status: 'ended', state: 'finished' },
    { ...base, id: 'late', status: 'active', state: 'overdue', scheduledAt: '2020-01-01T09:00:00.000Z' },
  ] }
  const tree = expand(BotSchedules({ bot, roster: { roomsById: {} }, actions: {} }))
  const labels = all(tree, 'bt-task-next').map(text)
  assert.equal(labels[0], 'Paused')
  assert.equal(labels[1], 'Finished')
  assert.match(labels[2], /^Overdue:/)
  assert.equal(all(tree, 'bt-set-hint').filter(node => text(node).includes(base.rrule)).length, 3)
})

test('legacy recurrence descriptions remain readable', () => {
  assert.equal(timingText({ kind: 'every', everySeconds: 3600 }), 'Every hour')
  assert.match(timingText({ kind: 'daily', time: '09:00:00' }), /Every day at 09:00/)
  assert.match(timingText({ kind: 'weekly', time: '10:15:00', weekdays: [1, 2, 3, 4, 5] }), /Every weekday at 10:15/)
  assert.equal(timingText({ kind: 'cron', expression: '0 9 * * *' }), 'On the schedule 0 9 * * *')
})

test('Rabi schedules appear beside local tasks with status and no DSH delete action', () => {
  const bot = { id: 'chief', name: 'Chief', rabiPersona: { roleId: 'fixture' } }
  const items = [{ id: 'same', source: 'rabi', title: 'Remote check', kind: 'rabi', status: 'paused', schedule: { type: 'daily_time', timeOfDay: '09:00' } }]
  const scopes = []
  const actions = { rabiWorkspace: { write: () => null, writes: () => [], snapshot(scope) { scopes.push(scope); return { value: { items }, pending: false, error: null } }, subscribe: () => () => {} } }
  view = { available: true, tasks: [{ id: 'same', botId: 'chief', title: 'Local check', kind: 'every', everySeconds: 600, status: 'active' }] }
  const summary = expand(ScheduleSummary({ bot, actions }))
  assert.match(text(summary), /Scheduled tasks · 2/)
  assert.match(text(summary), /Local check/)
  assert.match(text(summary), /Remote check.*09:00.*Paused in Rabi/)
  assert.ok(scopes.every(scope => scope.botId === bot.id && scope.roleId === '' && scope.resource === 'schedules'))
  const rows = expand(RabiSchedules({ bot, actions, roster: { roomsById: {} } }))
  assert.equal(all(rows, 'bt-task-remove').length, 0)
  assert.match(text(rows), /Paused in Rabi/)
  view = { available: false, tasks: [] }
  const page = expand(SchedulesPage({ roster: { bots: [bot], rooms: [] }, actions, start: 'bot:chief' }))
  assert.match(text(page), /Remote check/)
  assert.match(text(page), /Turn on Automation tasks in DSH/)
})

test('Rabi timing preserves one-off dates and interval windows', () => {
  assert.match(timingText({ kind: 'rabi', schedule: { type: 'once_at', onceAt: '2030-01-01T09:00:00' } }), /^Once, /)
  assert.equal(timingText({ kind: 'rabi', schedule: { type: 'interval', intervalSeconds: 1800, windowStartTime: '09:00', windowEndTime: '20:30' } }), 'Every 30 minutes · 09:00–20:30')
})

test('Rabi switches write the original persona and retain the same request after uncertainty', async () => {
  const bot = { id: 'bot', rabiPersona: { roleId: 'fixture' } }
  const task = { id: 'one', rawRuleId: 'one', sourceRoleId: 'fixture', source: 'rabi', title: 'Check', status: 'active', kind: 'rabi', schedule: { type: 'daily_time', timeOfDay: '09:00' } }
  const store = createRabiWorkspaceStore(async () => ({ roleId: '', revision: 'r1', items: [task] }))
  const calls = []
  const actions = { rabiWorkspace: store, rabiConnection: async (endpoint, body) => {
    if (endpoint === 'rabi-schedule-read') return { revision: 'r1', items: [task] }
    calls.push({ endpoint, body })
    if (calls.length === 1) throw Object.assign(new Error('unknown'), { code: 'bot/rabi-uncertain' })
    return { roleId: '', revision: 'r2', items: [{ ...task, status: 'paused' }] }
  } }
  const draw = render(RabiScheduleRow, { task, bot, actions, revision: 'r1', onView: async () => {}, onEdit() {} })
  nodes(draw()).find(node => node.type === 'switch').props.onChange(false)
  await flush()
  const retry = nodes(draw()).find(node => node.type === 'button' && text(node) === 'Retry')
  assert.ok(retry)
  retry.props.onClick()
  await flush()
  assert.equal(calls.length, 2)
  assert.equal(calls[0].endpoint, 'rabi-schedule-toggle')
  assert.equal(calls[0].body.expectedRoleId, 'fixture')
  assert.equal(calls[0].body.enabled, false)
  assert.equal(calls[0].body.operationId, calls[1].body.operationId)
  assert.equal(store.snapshot({ botId: 'bot', roleId: '', resource: 'schedules' }).value.items[0].status, 'paused')
  store.dispose()
})

test('personal creation chooses Rabi and group creation keeps the DSH form', () => {
  const bot = { id: 'bot', name: 'Persona', rabiPersona: { roleId: 'fixture' } }
  const roster = { bots: [bot], rooms: [{ id: 'room', name: 'Group' }] }
  const personal = TaskForm({ roster, actions: {}, start: 'bot' })
  assert.equal(personal.type.name, 'NewRabiSchedule')
  const group = TaskForm({ roster, actions: {}, start: 'room' })
  assert.equal(group.type, 'form')
})

test('a Rabi read failure still lets the user select a group and create its DSH task', () => {
  const bot = { id: 'bot', name: 'Persona', rabiPersona: { roleId: 'fixture' } }
  const roster = { bots: [bot], rooms: [{ id: 'room', name: 'Group' }] }
  const actions = { rabiWorkspace: { snapshot: () => ({ value: null, error: new Error('offline') }), subscribe() {} } }
  const draw = render(TaskForm, { roster, actions, start: bot.id })
  const personal = draw()
  const loading = personal.type(personal.props)
  const picker = nodes(loading).find(node => node.type === 'menu')
  assert.ok(picker.props.items.some(item => item.id === 'room'))
  picker.props.onSelect('room')
  assert.equal(draw().type, 'form')
})

test('a revision conflict preserves form edits and lets the user retry against the reread revision', async () => {
  const bot = { id: 'bot', name: 'Persona', rabiPersona: { roleId: 'fixture' } }
  const task = { id: 'one', rawRuleId: 'one', sourceRoleId: 'fixture', title: 'Check', message: 'Original message', status: 'active', kind: 'rabi', schedule: { type: 'daily_time', timeOfDay: '09:00' } }
  const store = createRabiWorkspaceStore(async () => ({ roleId: '', revision: 'new', items: [{ ...task, title: 'Changed remotely', schedule: { type: 'daily_time', timeOfDays: ['10:00', '14:00', '18:00'] } }] }))
  const calls = []
  let done = 0
  const actions = { rabiWorkspace: store, rabiConnection: async (endpoint, body) => {
    if (endpoint === 'rabi-schedule-read') return { revision: 'new', items: [{ ...task, title: 'Changed remotely', schedule: { type: 'daily_time', timeOfDays: ['10:00', '14:00', '18:00'] } }] }
    calls.push({ endpoint, body })
    if (calls.length === 1) throw Object.assign(new Error('conflict'), { code: 'bot/rabi-revision-conflict' })
    return { roleId: '', revision: 'saved', items: [{ ...task, title: body.title }] }
  } }
  const draw = render(RabiScheduleForm, { bot, task, actions, revision: 'old', onDone: () => { done++ }, onCancel() {} })
  let tree = draw()
  nodes(tree).find(node => node.type === 'input' && node.props.value === 'Check').props.onChange({ target: { value: 'My draft' } })
  nodes(draw()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await flush()
  tree = draw()
  assert.match(text(tree), /Changed remotely/)
  assert.match(text(tree), /10:00, 14:00, 18:00/)
  assert.equal(nodes(tree).find(node => node.type === 'input' && node.props.value === 'My draft').props.disabled, false)
  nodes(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await flush()
  assert.equal(calls[1].body.revision, 'new')
  assert.equal(calls[1].body.title, 'My draft')
  assert.notEqual(calls[0].body.operationId, calls[1].body.operationId)
  assert.equal(done, 1)
  store.dispose()
})

test('a pending delete keeps its recovery entry after the remote task disappears', async () => {
  const bot = { id: 'bot', name: 'Persona', rabiPersona: { roleId: 'fixture' } }
  const scope = { botId: bot.id, roleId: '', resource: 'schedules' }
  const store = createRabiWorkspaceStore(async () => ({ roleId: '', revision: 'r2', items: [] }))
  const operation = { endpoint: 'rabi-schedule-delete', body: { botId: bot.id, expectedRoleId: 'fixture', id: 'gone', revision: 'r1', operationId: 'original-delete' } }
  store.retainWrite({ ...scope, itemId: 'gone' }, operation)
  await store.visit(scope)
  const calls = []
  const actions = { rabiWorkspace: store, rabiConnection: async (endpoint, body) => { calls.push({ endpoint, body }); return { roleId: '', revision: 'r2', items: [] } } }
  const tree = RabiSchedules({ bot, actions })
  const recovery = nodes(tree).find(node => node.type === RabiPendingWrite)
  assert.ok(recovery)
  const drawn = render(RabiPendingWrite, recovery.props)()
  nodes(drawn).find(node => node.type === 'button').props.onClick()
  await flush()
  assert.equal(calls[0].body.operationId, 'original-delete')
  assert.equal(store.writes(scope).length, 0)
  store.dispose()
})

test('daily editor adds and removes times and saves one sorted deduplicated rule', async () => {
  const bot = { id: 'bot', name: 'Persona', rabiPersona: { roleId: 'fixture' } }
  const task = { id: 'daily', rawRuleId: 'daily', sourceRoleId: 'fixture', title: 'Daily', message: 'Check', schedule: { type: 'daily_time', timeOfDay: '09:00:07' } }
  const store = createRabiWorkspaceStore(async () => ({ roleId: '', revision: 'r1', items: [task] }))
  const calls = []
  const actions = { rabiWorkspace: store, rabiConnection: async (endpoint, body) => { calls.push(body); return { roleId: '', revision: 'r2', items: [task] } } }
  const draw = render(RabiScheduleForm, { bot, task, actions, revision: 'r1', onDone() {}, onCancel() {} })
  const button = label => nodes(draw()).find(node => node.type === 'button' && text(node) === label)
  const time = number => nodes(draw()).find(node => node.type === 'input' && node.props['aria-label'] === `Time ${number}`)
  assert.equal(time(1).props.value, '09:00:07')
  time(1).props.onChange({ target: { value: '18:00' } })
  button('Add time').props.onClick()
  time(2).props.onChange({ target: { value: '10:00' } })
  button('Add time').props.onClick()
  time(3).props.onChange({ target: { value: '14:00' } })
  button('Add time').props.onClick()
  time(4).props.onChange({ target: { value: '10:00:00' } })
  button('Add time').props.onClick()
  nodes(draw()).find(node => node.props['aria-label'] === 'Remove time 5').props.onClick()
  nodes(draw()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await flush()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].id, 'daily')
  assert.deepEqual(Array.from(calls[0].schedule.timeOfDays), ['10:00', '14:00', '18:00'])
  assert.match(timingText({ kind: 'rabi', schedule: calls[0].schedule }), /10:00, 14:00, 18:00/)
  store.dispose()
})

test('invalid daily input stays editable and uncertain full lists survive remount and retry', async () => {
  const bot = { id: 'bot', name: 'Persona', rabiPersona: { roleId: 'fixture' } }
  const task = { id: 'daily', rawRuleId: 'daily', sourceRoleId: 'fixture', title: 'Daily', message: 'Check', schedule: { type: 'daily_time', timeOfDays: ['10:00', '14:00', '18:00'] } }
  const store = createRabiWorkspaceStore(async () => ({ roleId: '', revision: 'r1', items: [task] }))
  const calls = []
  const actions = { rabiWorkspace: store, rabiConnection: async (endpoint, body) => { calls.push(body); throw new Error('unknown') } }
  const props = { bot, task, actions, revision: 'r1', onDone() {}, onCancel() {} }
  let draw = render(RabiScheduleForm, props)
  const first = () => nodes(draw()).find(node => node.props['aria-label'] === 'Time 1')
  first().props.onChange({ target: { value: '99:00' } })
  nodes(draw()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await flush()
  assert.equal(calls.length, 0)
  assert.equal(first().props.disabled, false)
  assert.match(text(draw()), /Enter each time/)
  first().props.onChange({ target: { value: '10:00' } })
  nodes(draw()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await flush()
  draw = render(RabiScheduleForm, props)
  assert.deepEqual(nodes(draw()).filter(node => /^Time [0-9]+$/.test(node.props['aria-label'] ?? '')).map(node => node.props.value), ['10:00', '14:00', '18:00'])
  nodes(draw()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await flush()
  assert.equal(calls.length, 2)
  assert.equal(calls[0], calls[1])
  store.dispose()
})


test('long daily editors use the Modal scroll region and modal-owned initial focus', () => {
  const bot = { id: 'bot', name: 'Persona', rabiPersona: { roleId: 'fixture' } }
  const times = Array.from({ length: 8 }, (_, index) => `${String(index + 10).padStart(2, '0')}:00`)
  const task = { id: 'daily', rawRuleId: 'daily', sourceRoleId: 'fixture', title: 'Daily', message: 'Check', schedule: { type: 'daily_time', timeOfDays: times } }
  const tree = render(RabiScheduleForm, { bot, task, revision: 'r1', actions: { rabiWorkspace: { write: () => null } }, onDone() {}, onCancel() {} })()
  assert.equal(tree.props.className, 'bt-rabi-task-dialog')
  assert.equal(tree.props.contentClassName, 'bt-rabi-task-content')
  assert.equal(nodes(tree).filter(node => /^Time [0-9]+$/.test(node.props['aria-label'] ?? '')).length, 8)
  const name = nodes(tree).find(node => node.type === 'input' && node.props.value === 'Daily')
  assert.equal(name.props['data-modal-autofocus'], true)
  assert.equal(name.props.autoFocus, undefined)
  assert.ok(nodes(tree).some(node => node.type === 'button' && text(node) === 'Save'))
})

test('a known HTTP method rejection releases the pending form without replaying it', async () => {
  const bot = { id: 'bot', name: 'Persona', rabiPersona: { roleId: 'fixture' } }
  const task = { id: 'daily', rawRuleId: 'daily', sourceRoleId: 'fixture', title: 'Daily', message: 'Check', schedule: { type: 'daily_time', timeOfDays: ['10:00', '14:00', '18:00'] } }
  const store = createRabiWorkspaceStore(async () => ({ roleId: '', revision: 'r1', items: [task] }))
  let calls = 0
  const actions = { rabiWorkspace: store, rabiConnection: async () => { calls++; throw Object.assign(new Error('Method rejected'), { code: 'bot/rabi-method-not-allowed' }) } }
  const draw = render(RabiScheduleForm, { bot, task, actions, revision: 'r1', onDone() {}, onCancel() {} })
  nodes(draw()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await flush()
  assert.equal(calls, 1)
  assert.equal(store.writes({ botId: 'bot', roleId: '', resource: 'schedules' }).length, 0)
  const fields = nodes(draw()).filter(node => /^Time [0-9]+$/.test(node.props['aria-label'] ?? ''))
  assert.deepEqual(fields.map(field => field.props.value), ['10:00', '14:00', '18:00'])
  assert.ok(fields.every(field => !field.props.disabled))
  store.dispose()
})


test('an ordinary Bot requires an explicit storage role and uses that role CAS for a new rule', async () => {
  const bot = { id: 'ordinary', name: 'Ordinary' }
  const store = createRabiWorkspaceStore(async () => ({ roleId: '', revision: 'catalog-hash', items: [] }))
  const calls = []
  const actions = { rabiWorkspace: store, rabiConnection: async (endpoint, body) => {
    calls.push({ endpoint, body })
    return endpoint === 'rabi-schedule-read' ? { roleId: '', revision: 'source-revision', items: [] } : { roleId: '', revision: 'new-catalog', items: [] }
  } }
  const draw = render(RabiScheduleForm, { bot, actions, roles: [{ id: 'other-role', name: 'Other' }], onDone() {}, onCancel() {} })
  nodes(draw()).find(node => node.type === 'input' && node.props.maxLength === 120).props.onChange({ target: { value: 'Personal check' } })
  nodes(draw()).find(node => node.type === 'textarea').props.onChange('Check the report')
  nodes(draw()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await flush()
  assert.equal(calls.length, 0)
  assert.match(text(draw()), /Choose a Rabi role/)
  nodes(draw()).find(node => node.type === 'menu').props.onSelect('other-role')
  nodes(draw()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await flush()
  assert.deepEqual(calls.map(call => call.endpoint), ['rabi-schedule-read', 'rabi-schedule-save'])
  assert.equal(calls[1].body.sourceRoleId, 'other-role')
  assert.equal(calls[1].body.expectedRoleId, 'other-role')
  assert.equal(calls[1].body.revision, 'source-revision')
  assert.equal(calls[1].body.botId, 'ordinary')
  assert.deepEqual(Array.from(calls[1].body.schedule.timeOfDays), ['09:00'])
  assert.equal(bot.rabiPersona, undefined)
  store.dispose()
})

test('a failed self-destination refresh retains assigned rules and exposes the failure', async () => {
  const scope = { botId: 'ordinary', roleId: '', resource: 'schedules' }
  const task = { id: 'assigned', title: 'Existing', sourceRoleId: 'another-role' }
  let unavailable = false
  const store = createRabiWorkspaceStore(async () => {
    if (unavailable) throw new Error('DS Bot owner unavailable')
    return { roleId: '', revision: 'catalog', items: [task] }
  })
  await store.visit(scope)
  unavailable = true
  await store.visit(scope)
  assert.deepEqual(store.snapshot(scope).value.items, [task])
  assert.match(store.snapshot(scope).error.message, /owner unavailable/)
  store.dispose()
})


test('personal Rabi creation remains visible when DSH Automation tasks are off', () => {
  const bot = { id: 'ordinary', name: 'Ordinary' }
  view = { available: false, tasks: [] }
  const tree = SchedulesPage({ roster: { bots: [bot], rooms: [] }, actions: {}, start: bot.id })
  assert.ok(nodes(tree).some(node => node.type === TaskForm))
})

test('a first destination preflight failure releases a form but does not settle an earlier unknown write', async () => {
  const bot = { id: 'bot', name: 'Persona', rabiPersona: { roleId: 'fixture' } }
  const task = { id: 'daily', rawRuleId: 'daily', sourceRoleId: 'fixture', title: 'Daily', message: 'Check', schedule: { type: 'daily_time', timeOfDays: ['10:00', '14:00'] } }
  const store = createRabiWorkspaceStore(async () => ({ roleId: '', items: [] }))
  const scope = { botId: 'bot', roleId: '', resource: 'schedules', itemId: 'daily' }
  let code = 'bot/rabi-destination-unavailable'
  const actions = { rabiWorkspace: store, rabiConnection: async () => { throw Object.assign(new Error('Unavailable'), { code }) } }
  const props = { bot, task, actions, revision: 'r1', onDone() {}, onCancel() {} }
  let draw = render(RabiScheduleForm, props)
  nodes(draw()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await flush()
  assert.equal(store.write(scope), null)
  code = 'bot/rabi-uncertain'
  nodes(draw()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await flush()
  const original = store.write(scope)
  assert.ok(original)
  code = 'bot/rabi-destination-unavailable'
  draw = render(RabiScheduleForm, props)
  nodes(draw()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await flush()
  assert.equal(store.write(scope), original)
  store.dispose()
})
