import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'
import { reminderText } from '../src/host/schedules.js'

const TEAM = {
  version: 1,
  mainBotIds: ['m1'],
  revision: 1,
  bots: {
    m1: { id: 'm1', sessionId: 'm1', name: 'Chief', role: 'Chief of Staff', instructions: '', createdAt: 1 },
    w1: { id: 'w1', sessionId: 'w2', name: 'Writer', role: '', instructions: '', createdAt: 2, segments: [{ sessionId: 'w1', endedAt: 3 }] },
  },
  rooms: { g1: { id: 'g1', name: 'Launch', named: true, members: ['m1', 'w1'], admin: 'm1', mode: 'admin', notice: '', createdAt: 4 } },
  exchanges: [],
  exchangeTurns: {},
  questions: {},
}

// An in-memory stand-in for DSH's schedule service.
function scheduleService() {
  const tasks = new Map()
  let next = 1
  return {
    tasks,
    async create(sessionId, request) {
      const id = `schedule-${next++}`
      const kind = { every_seconds: 'every' }[Object.keys(request).find(key => !['title', 'prompt'].includes(key))]
        ?? Object.keys(request).find(key => !['title', 'prompt'].includes(key))
      const record = {
        id, kind, title: request.title, prompt: request.prompt,
        timing: request[Object.keys(request).find(key => !['title', 'prompt'].includes(key))],
        scheduledAt: request.at ?? '2030-01-01T01:00:00.000Z',
        everySeconds: request.every_seconds,
        time: request.daily?.time ?? request.weekly?.time,
        timeZone: request.daily?.time_zone ?? request.weekly?.time_zone ?? request.cron?.time_zone,
        weekdays: request.weekly?.weekdays,
        expression: request.cron?.expression,
      }
      tasks.set(id, { sessionId, record })
      return record
    },
    async list({ sessionId }) { return [...tasks.values()].filter(task => task.sessionId === sessionId).map(task => task.record) },
    async catalog() {
      return [...tasks.values()].map(task => ({ ...task.record, sessionId: task.sessionId, status: task.status ?? 'active' }))
        .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id))
    },
    async delete({ sessionId, id }) {
      if (tasks.get(id)?.sessionId !== sessionId) return { id, deleted: false, code: 'schedule_not_found' }
      tasks.delete(id)
      return { id, deleted: true }
    },
  }
}

// Current public API: catalog is Host-wide, list is paginated, and edit owns
// optimistic updates/deletes. It deliberately has no legacy delete method.
function hostScheduleService() {
  const tasks = new Map()
  const edits = []
  const creates = []
  let next = 1
  const service = {
    tasks, edits, creates,
    async create(request) {
      assert.equal(arguments.length, 1)
      creates.push(structuredClone(request))
      const id = `host-schedule-${next++}`
      const selector = request.timing[request.timing.kind === 'every' ? 'every_seconds' : request.timing.kind]
      const entry = {
        id, kind: request.timing.kind, title: request.title, prompt: request.prompt,
        scheduledAt: request.timing.at ?? '2030-01-01T01:00:00.000Z',
        ...(request.timing.kind === 'every' ? { everySeconds: selector } : {}),
        ...(['daily', 'weekly', 'cron'].includes(request.timing.kind) ? { time: selector.time, timeZone: selector.time_zone, ...(selector.weekdays ? { weekdays: selector.weekdays } : {}) } : {}),
        target: structuredClone(request.target), involvedSessionIds: [request.target.sessionId],
        status: 'active', updatedAt: '2026-11-04T01:00:00.000Z',
      }
      tasks.set(id, entry)
      return structuredClone(entry)
    },
    async catalog() { return structuredClone([...tasks.values()]) },
    async list() { return { items: structuredClone([...tasks.values()]), total: tasks.size, shown: tasks.size, limit: 100, offset: 0 } },
    async edit(request) {
      edits.push(structuredClone(request))
      service.beforeEdit?.(request)
      const entry = tasks.get(request.id)
      if (entry === undefined) return { id: request.id, code: 'schedule_not_found' }
      if (request.expectedUpdatedAt !== (entry.updatedAt ?? null)) return { id: request.id, code: 'schedule_conflict' }
      if (request.action === 'delete') { tasks.delete(request.id); return { id: request.id, deleted: true } }
      assert.deepEqual(Object.keys(request.patch), ['target'])
      entry.target = structuredClone(request.patch.target)
      entry.updatedAt = '2026-11-04T02:00:00.000Z'
      return structuredClone(entry)
    },
  }
  return service
}

function setup(services = {}) {
  const home = mkdtempSync(join(tmpdir(), 'dsb-schedules-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(TEAM))
  const ctx = fakeContext({ services })
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (route) => { if (route.path === '/api/bot') ctx.route = route; return register(route) }
  const rt = createRuntime(ctx, { home })
  const call = async (endpoint, payload) => (await ctx.route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))).json()
  return { ctx, home, call, rt }
}

test('without the schedule service the page says so and creating is refused', async (t) => {
  const { ctx, home, call } = setup()
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  assert.deepEqual((await call('schedules', {})).value, { available: false, tasks: [] })
  const refused = await call('schedule-create', { target: 'm1', title: 'Briefing', prompt: 'Sum up', when: { kind: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' } })
  assert.equal(refused.ok, false)
  assert.match(refused.error.message, /Automation tasks are off/)
})

test('tasks are created on the Bot’s current part, listed by Bot, and deleted', async (t) => {
  const schedule = scheduleService()
  const { ctx, home, call } = setup({ schedule })
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  const daily = await call('schedule-create', { target: 'w1', title: ' Briefing ', prompt: 'Sum up the day', when: { kind: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' } })
  assert.equal(daily.ok, true, JSON.stringify(daily))
  const [created] = [...schedule.tasks.values()]
  assert.equal(created.sessionId, 'w2')
  assert.deepEqual(created.record.timing, { time: '09:00:00', time_zone: 'Asia/Shanghai' })
  assert.equal(created.record.title, 'Briefing')

  await schedule.create('w1', { title: 'Old part', prompt: 'x', every_seconds: 3600 })
  await schedule.create('outside', { title: 'Not ours', prompt: 'x', every_seconds: 3600 })
  // A task past its firing reads overdue; an inactive one is finished.
  schedule.tasks.set('schedule-late', { sessionId: 'w2', record: { id: 'schedule-late', kind: 'at', title: 'Late', prompt: 'x', scheduledAt: '2020-01-01T00:00:00.000Z' } })
  schedule.tasks.set('schedule-done', { sessionId: 'w2', record: { id: 'schedule-done', kind: 'at', title: 'Done', prompt: 'x', scheduledAt: '2020-01-01T00:00:00.000Z' }, status: 'inactive' })
  const listed = (await call('schedules', {})).value
  assert.equal(listed.available, true)
  assert.deepEqual(listed.tasks.map(task => [task.title, task.botId]), [['Done', 'w1'], ['Late', 'w1'], ['Briefing', 'w1'], ['Old part', 'w1']])
  assert.deepEqual(listed.tasks.map(task => task.state), ['finished', 'overdue', 'scheduled', 'scheduled'])

  const weekly = await call('schedule-create', { target: 'm1', title: 'Week', prompt: 'Plan', when: { kind: 'weekly', time: '18:30', timeZone: 'UTC', weekdays: [5, 1, 1, 9] } })
  assert.equal(weekly.ok, true)
  assert.deepEqual([...schedule.tasks.values()].at(-1).record.timing, { time: '18:30:00', time_zone: 'UTC', weekdays: [1, 5] })
  const every = await call('schedule-create', { target: 'm1', title: 'Ping', prompt: 'Check', when: { kind: 'every', minutes: 30 } })
  assert.equal([...schedule.tasks.values()].at(-1).record.timing, 1800, JSON.stringify(every))

  for (const [when, message] of [
    [{ kind: 'at', at: '2000-01-01T00:00:00Z' }, /future/],
    [{ kind: 'weekly', time: '09:00', weekdays: [] }, /at least one day/],
    [{ kind: 'daily', time: '9am' }, /time of day/],
    [{ kind: 'every', minutes: 0 }, /1 minute to 7 days/],
  ]) {
    const refused = await call('schedule-create', { target: 'm1', title: 'x', prompt: 'y', when })
    assert.match(refused.error.message, message)
  }
  assert.match((await call('schedule-create', { target: 'm1', title: '', prompt: 'y', when: { kind: 'every', minutes: 5 } })).error.message, /name/)

  const removed = await call('schedule-delete', { sessionId: 'w2', id: created.record.id })
  assert.deepEqual(removed.value.tasks.map(task => task.title), ['Done', 'Late', 'Old part', 'Week', 'Ping'])
  assert.match((await call('schedule-delete', { sessionId: 'outside', id: 'schedule-3' })).error.message, /No such task/)
})

test('a group chat task lives on the group Session and lists under the group', async (t) => {
  const schedule = scheduleService()
  const { ctx, home, call } = setup({ schedule })
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  const made = await call('schedule-create', { target: 'g1', title: 'Standup', prompt: 'Where are we?', when: { kind: 'daily', time: '10:00', timeZone: 'UTC' } })
  assert.equal(made.ok, true, JSON.stringify(made))
  assert.equal([...schedule.tasks.values()][0].sessionId, 'g1')
  assert.deepEqual(made.value.tasks.map(task => [task.title, task.roomId, task.botId]), [['Standup', 'g1', undefined]])
  assert.match((await call('schedule-create', { target: 'nobody', title: 'x', prompt: 'y', when: { kind: 'every', minutes: 5 } })).error.message, /No such Bot or group chat/)
})

test('a due reminder reaches a group as its prompts', () => {
  const one = ['[SCHEDULE REMINDER]', 'framing', 'schedule_id_json: "s1"', 'occurrence_at: 2030-01-01T00:00:00Z', 'reminder_prompt_json: "Where are we?"'].join('\n')
  assert.equal(reminderText(one), '[Scheduled task] Where are we?')
  const batch = ['[SCHEDULE REMINDER BATCH]', 'framing', `reminders_json: ${JSON.stringify([{ schedule_id: 'a', reminder_prompt: 'One' }, { schedule_id: 'b', reminder_prompt: 'Two' }])}`].join('\n')
  assert.equal(reminderText(batch), '[Scheduled task] One\n[Scheduled task] Two')
  assert.equal(reminderText('plain text'), 'plain text')
})

test('a failed task move can resume without losing identical remaining tasks', async (t) => {
  const schedule = scheduleService()
  const { ctx, home, rt } = setup({ schedule })
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  await schedule.create('w2', { title: 'Ping', prompt: 'Check', every_seconds: 3600 })
  await schedule.create('w2', { title: 'Ping', prompt: 'Check', every_seconds: 3600 })

  const create = schedule.create
  let attempts = 0
  schedule.create = async (...args) => {
    if (++attempts === 2) throw new Error('down')
    return create(...args)
  }
  await assert.rejects(rt.moveSchedules('w2', 's9'), /down/)
  const on = id => [...schedule.tasks.values()].filter(task => task.sessionId === id)
  assert.equal(on('s9').length, 1)
  assert.equal(on('w2').length, 1)

  schedule.create = create
  await rt.moveSchedules('w2', 's9')
  assert.equal(on('s9').length, 2)
  assert.equal(on('w2').length, 0)
})

test('Host-wide schedules create typed timings on the current Bot or group Session', async (t) => {
  const schedule = hostScheduleService()
  const { ctx, home, call } = setup({ schedule })
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  const cases = [
    { target: 'w1', when: { kind: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' }, timing: { kind: 'daily', daily: { time: '09:00:00', time_zone: 'Asia/Shanghai' } }, sessionId: 'w2' },
    { target: 'm1', when: { kind: 'weekly', time: '10:15', weekdays: [5, 1, 1] }, timing: { kind: 'weekly', weekly: { time: '10:15:00', time_zone: 'UTC', weekdays: [1, 5] } }, sessionId: 'm1' },
    { target: 'g1', when: { kind: 'every', minutes: 30 }, timing: { kind: 'every', every_seconds: 1800 }, sessionId: 'g1' },
    { target: 'm1', when: { kind: 'at', at: '2030-01-01T00:00:00Z' }, timing: { kind: 'at', at: '2030-01-01T00:00:00.000Z' }, sessionId: 'm1' },
  ]
  for (const entry of cases) {
    const response = await call('schedule-create', { target: entry.target, title: ' Task ', prompt: 'Check it', when: entry.when })
    assert.equal(response.ok, true, JSON.stringify(response))
    assert.deepEqual(schedule.creates.at(-1), { title: 'Task', prompt: 'Check it', timing: entry.timing, target: { kind: 'session', sessionId: entry.sessionId } })
  }
  const result = (await call('schedules')).value
  assert.equal(result.tasks.length, 4)
  assert.equal(result.tasks[0].botId, 'w1')
  assert.equal(result.tasks[2].roomId, 'g1')
})

test('Host-wide catalog exposes only existing team Session destinations and preserves task state', async (t) => {
  const schedule = hostScheduleService()
  const { ctx, home, call } = setup({ schedule })
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  const base = { kind: 'every', title: 'Task', prompt: 'Check', everySeconds: 3600, scheduledAt: '2030-01-01T00:00:00.000Z', status: 'active' }
  for (const entry of [
    { id: 'paused', target: { kind: 'session', sessionId: 'w2' }, status: 'paused', state: 'paused' },
    { id: 'ended', target: { kind: 'session', sessionId: 'g1' }, status: 'ended' },
    { id: 'reserved', target: { kind: 'new_once', sessionId: 'w2', create: {} } },
    { id: 'new', target: { kind: 'new', create: {} } },
    { id: 'outside', target: { kind: 'session', sessionId: 'outside' } },
  ]) schedule.tasks.set(entry.id, { ...base, ...entry })
  const result = await call('schedules')
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.deepEqual(result.value.tasks.map(entry => [entry.id, entry.sessionId, entry.state, entry.botId, entry.roomId]), [
    ['paused', 'w2', 'paused', 'w1', undefined], ['ended', 'g1', 'finished', undefined, 'g1'],
  ])
})

test('Host-wide deletion checks the canonical destination and uses optimistic edit', async (t) => {
  const schedule = hostScheduleService()
  const { ctx, home, call } = setup({ schedule })
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  const entry = await schedule.create({ title: 'Keep me', prompt: 'Check', timing: { kind: 'every', every_seconds: 3600 }, target: { kind: 'session', sessionId: 'w2' } })
  for (const [id, target] of [['outside', { kind: 'session', sessionId: 'outside' }], ['reserved', { kind: 'new_once', sessionId: 'w2', create: {} }]]) {
    schedule.tasks.set(id, { ...entry, id, target })
  }
  for (const body of [{ id: entry.id, sessionId: 'm1' }, { id: 'outside', sessionId: 'w2' }, { id: 'outside', sessionId: 'outside' }, { id: 'reserved', sessionId: 'w2' }, { id: 'missing', sessionId: 'w2' }]) {
    const response = await call('schedule-delete', body)
    assert.equal(response.ok, false)
    assert.match(response.error.message, /No such task/)
  }
  assert.deepEqual(schedule.edits, [])
  const response = await call('schedule-delete', { id: entry.id, sessionId: 'w2' })
  assert.equal(response.ok, true, JSON.stringify(response))
  assert.deepEqual(schedule.edits, [{ id: entry.id, action: 'delete', expectedUpdatedAt: entry.updatedAt }])
  assert.equal(schedule.tasks.has(entry.id), false)
  assert.equal(schedule.tasks.has('outside'), true)
})

test('Host-wide retarget keeps task identity, timing, delivery history and paused status', async (t) => {
  const schedule = hostScheduleService()
  const { ctx, home, rt } = setup({ schedule })
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  const entry = await schedule.create({ title: 'Check', prompt: 'Check it', timing: { kind: 'every', every_seconds: 3600 }, target: { kind: 'session', sessionId: 'w2' } })
  const task = schedule.tasks.get(entry.id)
  task.kind = 'rrule'
  task.rrule = 'DTSTART:20261104T010000Z\nRRULE:FREQ=HOURLY'
  delete task.everySeconds
  task.status = 'paused'
  task.lastDelivery = { sessionId: 'w2', deliveredAt: '2026-11-03T01:00:00Z', inboxMessageId: 'kept-delivery' }
  const before = structuredClone(task)
  await rt.moveSchedules('w2', 's9')
  assert.deepEqual(schedule.edits, [{ id: entry.id, action: 'update', expectedUpdatedAt: entry.updatedAt, patch: { target: { kind: 'session', sessionId: 's9' } } }])
  assert.equal(schedule.creates.length, 1)
  assert.deepEqual(schedule.tasks.get(entry.id), { ...before, target: { kind: 'session', sessionId: 's9' }, updatedAt: '2026-11-04T02:00:00.000Z' })
  await rt.moveSchedules('w2', 's9')
  assert.equal(schedule.edits.length, 1, 'a resumed move does not duplicate an already retargeted task')
})

test('a concurrent Host-wide edit aborts a retarget or delete before the caller can archive', async (t) => {
  const schedule = hostScheduleService()
  const { ctx, home, rt, call } = setup({ schedule })
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  const entry = await schedule.create({ title: 'Check', prompt: 'Check it', timing: { kind: 'every', every_seconds: 3600 }, target: { kind: 'session', sessionId: 'w2' } })
  schedule.beforeEdit = () => { schedule.tasks.get(entry.id).updatedAt = '2026-11-04T01:01:00.000Z' }
  let archived = false
  await assert.rejects(async () => { await rt.moveSchedules('w2', 's9'); archived = true }, { code: 'schedule_conflict' })
  assert.equal(archived, false)
  assert.deepEqual(schedule.tasks.get(entry.id).target, { kind: 'session', sessionId: 'w2' })
  schedule.beforeEdit = () => { schedule.tasks.get(entry.id).updatedAt = '2026-11-04T01:02:00.000Z' }
  const removed = await call('schedule-delete', { id: entry.id, sessionId: 'w2' })
  assert.equal(removed.ok, false)
  assert.equal(removed.error.code, 'bot/refused')
  assert.match(removed.error.message, /task changed.*Refresh/)
  assert.equal(schedule.tasks.has(entry.id), true)
})

test('Host-wide move ignores unrelated and reserved targets and propagates a real edit failure', async (t) => {
  const schedule = hostScheduleService()
  const { ctx, home, rt } = setup({ schedule })
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  await schedule.create({ title: 'Other', prompt: 'Check', timing: { kind: 'every', every_seconds: 3600 }, target: { kind: 'session', sessionId: 'elsewhere' } })
  schedule.tasks.set('reserved', { id: 'reserved', target: { kind: 'new_once', sessionId: 'w2', create: {} } })
  await rt.moveSchedules('w2', 's9')
  assert.deepEqual(schedule.edits, [])
  await schedule.create({ title: 'Own', prompt: 'Check', timing: { kind: 'every', every_seconds: 3600 }, target: { kind: 'session', sessionId: 'w2' } })
  schedule.beforeEdit = () => { throw new Error('Schedule storage failed') }
  await assert.rejects(rt.moveSchedules('w2', 's9'), /Schedule storage failed/)
  assert.deepEqual([...schedule.tasks.values()].at(-1).target, { kind: 'session', sessionId: 'w2' })
})
