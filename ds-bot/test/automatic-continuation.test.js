import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { install, continuationKind } from '../src/host/resume.js'
import { fakeContext } from './fake-ctx.js'

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)) }
function fixture(t, config = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-auto-'))
  const ctx = fakeContext(), events = [], calls = [], prompts = [], warnings = []
  const agent = { session: { snapshotEvents: () => events },
    continueInterrupted: seq => { calls.push(['interrupted', seq]); return true },
    continueQuotaFailure: seq => { calls.push(['quota', seq]); return true } }
  let release, reads = 0
  const rt = { ctx, home, config, load: async () => {}, readOnly: () => undefined,
    isBotSession: id => id === 'bot', chatOwners: new Map([['bot', 'owner']]), groupOwners: new Map(), live: new Map(),
    deliver: async message => prompts.push(message), warn: (...args) => warnings.push(args),
    resolveAgent: async () => { reads++; if (release) await release; return agent } }
  install(rt)
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true }) })
  const emit = (type, data, id = 'bot') => {
    const event = { type, seq: events.length + 1, data }
    if (id === 'bot') events.push(event)
    for (const listener of ctx.listeners.get('session/event')) listener({ id }, event)
  }
  const end = reason => { emit('turn/start', { turn: 1 }); emit('turn/end', { reason }) }
  return { rt, ctx, agent, events, calls, prompts, warnings, emit, end, reads: () => reads,
    hold: promise => { release = promise } }
}

test('interrupted work resumes once through the original turn without another prompt', async t => {
  const f = fixture(t)
  f.end({ kind: 'interrupted' })
  t.mock.timers.tick(999)
  await flush()
  assert.equal(f.calls.length, 0)
  t.mock.timers.tick(1)
  await flush()
  assert.deepEqual(f.calls, [['interrupted', 1]])
  t.mock.timers.tick(60000)
  await flush()
  assert.equal(f.calls.length, 1)
  assert.deepEqual(f.prompts, [])
})

test('quota continuation backs off between attempts and caps the delay', async t => {
  const f = fixture(t, { autoContinueDelayMs: 10, autoContinueMaxDelayMs: 20 })
  const quota = { kind: 'error', error: { code: 'QUOTA' } }
  f.end(quota)
  t.mock.timers.tick(10)
  await flush()
  assert.deepEqual(f.calls, [['quota', 1]])
  f.end(quota)
  t.mock.timers.tick(19)
  await flush()
  assert.equal(f.calls.length, 1)
  t.mock.timers.tick(1)
  await flush()
  assert.equal(f.calls.length, 2)
  f.end(quota)
  t.mock.timers.tick(20)
  await flush()
  assert.equal(f.calls.length, 3)
})

test('new input, explicit stop, other sessions and disposal prevent automatic continuation', async t => {
  const f = fixture(t)
  f.end({ kind: 'interrupted' })
  f.emit('user/message', { source: { kind: 'user' } })
  t.mock.timers.tick(1000)
  await flush()
  assert.equal(f.calls.length, 0)
  f.end({ kind: 'interrupted' })
  f.emit('turn/end', { reason: { kind: 'aborted', reason: { kind: 'user' } } })
  f.emit('turn/end', { reason: { kind: 'interrupted' } }, 'ordinary-dsh')
  t.mock.timers.tick(1000)
  await flush()
  assert.equal(f.calls.length, 0)
  f.end({ kind: 'interrupted' })
  await f.ctx.dispose()
  t.mock.timers.tick(1000)
  await flush()
  assert.equal(f.calls.length, 0)
})

test('a cancelled pending lookup cannot wake a later turn', async t => {
  const f = fixture(t)
  let release
  f.hold(new Promise(resolve => { release = resolve }))
  f.end({ kind: 'interrupted' })
  t.mock.timers.tick(1000)
  await flush()
  assert.equal(f.reads(), 1)
  f.emit('user/message', { source: { kind: 'user' } })
  release()
  await flush()
  assert.deepEqual(f.calls, [])
})

test('unknown Hook outcomes and active stops are never automatically replayed', () => {
  assert.equal(continuationKind({ kind: 'error', error: { code: 'UNKNOWN', message: 'Rabi operation outcome is uncertain' } }), undefined)
  assert.equal(continuationKind({ kind: 'aborted', reason: { kind: 'user' } }), undefined)
  assert.equal(continuationKind({ kind: 'error', error: { code: 'AUTH' } }), undefined)
  assert.equal(continuationKind({ kind: 'error', error: { code: 'PI_AI_ERROR', message: '402 status code' } }), 'quota')
})

test('an exception from native continuation is reported without another attempt', async t => {
  const f = fixture(t)
  f.rt.resolveAgent = async () => { throw new Error('Unknown continuation outcome') }
  f.end({ kind: 'interrupted' })
  t.mock.timers.tick(1000)
  await flush()
  t.mock.timers.tick(60000)
  await flush()
  assert.equal(f.warnings.length, 1)
  assert.deepEqual(f.calls, [])
  assert.deepEqual(f.prompts, [])
})

test('Retry continues the pending quota turn and replaces its automatic timer', async t => {
  const f = fixture(t)
  f.end({ kind: 'error', error: { code: 'QUOTA' } })
  assert.equal(await f.rt.continuePending('bot'), true)
  assert.deepEqual(f.calls, [['quota', 1]])
  t.mock.timers.tick(60000)
  await flush()
  assert.deepEqual(f.calls, [['quota', 1]])
  assert.deepEqual(f.prompts, [])
  // The native driver accepted, but may not have published turn/start yet.
  assert.equal(await f.rt.continuePending('bot'), true)
  assert.deepEqual(f.calls, [['quota', 1]])
})

test('Retry takes over an automatic lookup already in flight without a second native call', async t => {
  const f = fixture(t)
  let release
  f.hold(new Promise(resolve => { release = resolve }))
  f.end({ kind: 'error', error: { code: 'QUOTA' } })
  t.mock.timers.tick(1000)
  await flush()
  assert.equal(f.reads(), 1)
  const manual = f.rt.continuePending('bot')
  await flush()
  assert.equal(f.reads(), 2)
  release()
  assert.equal(await manual, true)
  await flush()
  assert.deepEqual(f.calls, [['quota', 1]])
  assert.deepEqual(f.prompts, [])
})

test('Retry during the accepted automatic continuation waits for its turn to start', async t => {
  const f = fixture(t)
  f.end({ kind: 'error', error: { code: 'QUOTA' } })
  t.mock.timers.tick(1000)
  await flush()
  assert.deepEqual(f.calls, [['quota', 1]])
  assert.equal(await f.rt.continuePending('bot'), true)
  assert.deepEqual(f.calls, [['quota', 1]])
  f.emit('turn/start', { turn: 2 })
  assert.equal(await f.rt.continuePending('bot'), false)
})

test('new input during a manual lookup prevents it from reviving the old turn', async t => {
  const f = fixture(t)
  let release
  f.hold(new Promise(resolve => { release = resolve }))
  f.end({ kind: 'error', error: { code: 'QUOTA' } })
  const manual = f.rt.continuePending('bot')
  await flush()
  f.emit('user/message', { source: { kind: 'user' } })
  release()
  assert.equal(await manual, true)
  assert.equal(await f.rt.continuePending('bot'), false)
  t.mock.timers.tick(60000)
  await flush()
  assert.deepEqual(f.calls, [])
  assert.deepEqual(f.prompts, [])
})

test('Retry returns false only when no pending native turn or no native driver is available', async t => {
  const f = fixture(t)
  assert.equal(await f.rt.continuePending('bot'), false)
  f.end({ kind: 'error', error: { code: 'QUOTA' } })
  f.agent.continueQuotaFailure = undefined
  assert.equal(await f.rt.continuePending('bot'), false)
  assert.deepEqual(f.calls, [])
  assert.deepEqual(f.prompts, [])
})

test('a native refusal still handles Retry without sending a replacement message', async t => {
  const f = fixture(t)
  f.agent.continueQuotaFailure = seq => { f.calls.push(['refused', seq]); return false }
  f.end({ kind: 'error', error: { code: 'QUOTA' } })
  assert.equal(await f.rt.continuePending('bot'), true)
  assert.deepEqual(f.calls, [['refused', 1]])
  assert.deepEqual(f.prompts, [])
})

test('concurrent Retry requests share one pending native lookup', async t => {
  const f = fixture(t)
  let release
  f.hold(new Promise(resolve => { release = resolve }))
  f.end({ kind: 'error', error: { code: 'QUOTA' } })
  const one = f.rt.continuePending('bot')
  const two = f.rt.continuePending('bot')
  await flush()
  assert.equal(f.reads(), 1)
  release()
  assert.deepEqual(await Promise.all([one, two]), [true, true])
  assert.deepEqual(f.calls, [['quota', 1]])
})

test('a failed Retry reports the unknown result and settles the original continuation', async t => {
  const f = fixture(t)
  const failures = []
  f.rt.cancelTurnContinuation = (id, failure) => { if (failure) failures.push([id, failure]) }
  f.end({ kind: 'error', error: { code: 'QUOTA' } })
  f.agent.continueQuotaFailure = () => { throw new Error('Unknown native outcome') }
  await assert.rejects(f.rt.continuePending('bot'), /Unknown native outcome/)
  assert.deepEqual(failures, [['bot', { code: 'UNKNOWN', message: 'Unknown native outcome' }]])
  t.mock.timers.tick(60000)
  await flush()
  assert.deepEqual(f.calls, [])
  assert.deepEqual(f.prompts, [])
})

for (const stop of ['user-stop', 'read-only', 'active-turn', 'dispose']) {
  test(`a ${stop} during Retry lookup leaves the pending turn stopped`, async t => {
    const f = fixture(t)
    let release
    f.hold(new Promise(resolve => { release = resolve }))
    f.end({ kind: 'error', error: { code: 'QUOTA' } })
    const manual = f.rt.continuePending('bot')
    await flush()
    if (stop === 'user-stop') f.emit('turn/end', { reason: { kind: 'aborted', reason: { kind: 'user' } } })
    if (stop === 'read-only') f.rt.readOnly = () => 'another Host owns the team'
    if (stop === 'active-turn') f.rt.live.set('bot', { turn: 2 })
    if (stop === 'dispose') await f.ctx.dispose()
    release()
    assert.equal(await manual, true)
    t.mock.timers.tick(60000)
    await flush()
    assert.deepEqual(f.calls, [])
    assert.deepEqual(f.prompts, [])
  })
}
