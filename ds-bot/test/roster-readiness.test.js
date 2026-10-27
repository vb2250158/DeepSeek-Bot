import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rosterReadiness } from '../src/client/roster-readiness.js'

function fixture() {
  let available = false
  let opened = 0
  const listeners = new Set()
  const wait = rosterReadiness({
    getSnapshot: () => ({ ready: available }),
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
  }, () => { opened += 1 })
  return { wait, listeners, opened: () => opened, publish() { available = true; for (const fn of listeners) fn() } }
}

test('repeated landing requests share one wait and release it before opening', () => {
  const f = fixture()
  f.wait.ensure(); f.wait.ensure()
  assert.equal(f.listeners.size, 1)
  f.publish()
  assert.equal(f.listeners.size, 0)
  assert.equal(f.opened(), 1)
})

test('leaving the Bot panel cancels its pending landing but permits a later visit', () => {
  const f = fixture()
  f.wait.ensure(); f.wait.cancel(); f.publish()
  assert.equal(f.opened(), 0)
  f.wait.ensure()
  assert.equal(f.opened(), 1)
})

test('plugin disposal releases an unready roster and prevents later navigation', () => {
  const f = fixture()
  f.wait.ensure(); f.wait.dispose(); f.publish(); f.wait.ensure()
  assert.equal(f.listeners.size, 0)
  assert.equal(f.opened(), 0)
})
