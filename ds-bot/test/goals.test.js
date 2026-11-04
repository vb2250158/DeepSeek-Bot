import assert from 'node:assert/strict'
import { test } from 'node:test'
import { install } from '../src/host/goals.js'

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function setup() {
  const rooms = new Map(['one', 'two'].map(id => [id, {
    id, admin: 'admin', members: ['admin'],
    goal: { id: `goal-${id}`, status: 'active', nudges: 0, revision: 0 },
  }]))
  const relays = []
  const rt = {
    ctx: { sessions: { flush: async () => {} } },
    teamTools: [], roomProgress: new Map(), roomInbox: new Map(),
    botOf: id => ({ id }), roomOf: id => rooms.get(id),
    workingInRoom: () => [], roomBatchPending: () => false,
    sessionOfRoom: room => room.id,
    resolveAgent: async id => ({ session: { id }, followup: message => relays.push({ id, message }) }),
    save: async () => {},
  }
  install(rt)
  return { rt, rooms, relays }
}

test('concurrent settlement and round completion save and queue one goal check', async () => {
  const { rt, rooms, relays } = setup()
  const room = rooms.get('one')
  const gate = deferred()
  let saves = 0
  rt.save = () => { saves += 1; return gate.promise }
  const settled = rt.goalSettled(room)
  const ended = rt.goalDrive(room, { slots: [{ id: 'member', worked: true }] })
  await Promise.resolve()
  assert.equal(saves, 1)
  assert.equal(relays.length, 0)
  gate.resolve()
  await Promise.all([settled, ended])
  assert.equal(relays.length, 1)
  assert.equal(relays[0].message.source.goalId, 'goal-one')
  assert.equal(room.goal.nudges, 1)
})

test('a pending goal check in one room does not hold another room', async () => {
  const { rt, rooms, relays } = setup()
  const gate = deferred()
  let saves = 0
  rt.save = () => ++saves === 1 ? gate.promise : Promise.resolve()
  const one = rt.goalSettled(rooms.get('one'))
  await Promise.resolve()
  await rt.goalSettled(rooms.get('two'))
  assert.deepEqual(relays.map(relay => relay.id), ['two'])
  gate.resolve()
  await one
  assert.deepEqual(relays.map(relay => relay.id), ['two', 'one'])
})

for (const failure of ['save', 'relay']) {
  test(`a failed ${failure} releases the pending goal check for a later settlement`, async () => {
    const { rt, rooms, relays } = setup()
    const room = rooms.get('one')
    const save = rt.save
    const resolveAgent = rt.resolveAgent
    const error = new Error(`${failure} failed`)
    if (failure === 'save') rt.save = async () => { throw error }
    else rt.resolveAgent = async () => { throw error }
    await assert.rejects(rt.goalSettled(room), error)
    assert.equal(relays.length, 0)
    rt.save = save
    rt.resolveAgent = resolveAgent
    await rt.goalSettled(room)
    assert.equal(relays.length, 1)
    assert.equal(room.goal.nudges, 1)
  })
}

for (const change of ['pause', 'stop', 'replace']) {
  test(`a ${change} while the goal check saves leaves no stale check to send`, async () => {
    const { rt, rooms, relays } = setup()
    const room = rooms.get('one')
    const gate = deferred()
    rt.save = () => gate.promise
    const pending = rt.goalSettled(room)
    await Promise.resolve()
    if (change === 'replace') room.goal = { ...room.goal, id: 'next-goal' }
    else if (change === 'pause') room.goal.status = 'paused'
    else rt.goalUserStopped(room.id)
    gate.resolve()
    await pending
    assert.equal(relays.length, 0)
  })
}

test('a relay awaiting its Session keeps the goal id whose check created it', async () => {
  const { rt, rooms, relays } = setup()
  const room = rooms.get('one')
  const gate = deferred()
  const resolving = deferred()
  const resolveAgent = rt.resolveAgent
  rt.resolveAgent = async id => { resolving.resolve(); await gate.promise; return resolveAgent(id) }
  const pending = rt.goalSettled(room)
  await resolving.promise
  room.goal = { ...room.goal, id: 'next-goal' }
  gate.resolve()
  await pending
  assert.equal(relays.length, 1)
  assert.equal(relays[0].message.source.goalId, 'goal-one')
})
