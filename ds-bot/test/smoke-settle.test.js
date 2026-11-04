import assert from 'node:assert/strict'
import { test } from 'node:test'
import { waitForBenchIdle } from '../dev/smoke-settle.mjs'

function bench(readState) {
  let clock = 0
  let calls = 1
  return {
    options: { readState: () => readState(clock), readMockCount: () => calls, now: () => clock, wait: async ms => { clock += ms } },
    now: () => clock, modelCall: () => { calls += 1 },
  }
}

test('an unlabelled native turn cannot settle before its tool and turn end', async () => {
  const toolFinished = 6000
  const host = bench(clock => ({ activity: {}, work: { turns: clock < toolFinished ? { writer: 1 } : {}, bots: {}, rooms: {} } }))
  await waitForBenchIdle(host.options)
  assert.ok(host.now() >= toolFinished + 2500, `settled at ${host.now()} before the running turn finished`)
})

test('a pending view awaiting the user is idle once its native turn ended', async () => {
  const host = bench(() => ({ activity: {}, work: { turns: {}, bots: {}, rooms: {} }, views: { writer: { id: 'pending-view' } } }))
  await waitForBenchIdle({ ...host.options, timeoutMs: 4000 })
  assert.ok(host.now() >= 2500 && host.now() < 4000)
})

test('Bot and group work keep the bench busy even without an activity label', async () => {
  for (const work of [{ bots: { writer: { since: 1 } }, rooms: {} }, { bots: {}, rooms: { team: [{ botId: 'writer', since: 1 }] } }]) {
    const host = bench(clock => ({ activity: {}, work: clock < 6000 ? work : { bots: {}, rooms: { team: [] } } }))
    await waitForBenchIdle(host.options)
    assert.ok(host.now() >= 8500)
  }
})

test('a stuck native turn times out instead of allowing the next scripted input', async () => {
  const host = bench(() => ({ activity: {}, work: { turns: { writer: 1 } } }))
  await assert.rejects(waitForBenchIdle({ ...host.options, timeoutMs: 4000 }), /did not go quiet/)
})
