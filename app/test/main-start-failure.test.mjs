import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import os from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { startApp } from './helpers/app-harness.mjs'

test('a failed main import restores the first-run home and environment before rejecting', async t => {
  const homedir = os.homedir
  const names = ['DSH_HOME', 'DS_BOT_HOME', 'DS_BOT_WORKSPACE']
  const previous = names.map(name => [name, process.env[name]])
  const listeners = new Set(process.listeners('exit'))
  const failure = new Error('the fixture main cannot load')
  let observed, dispose
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context)
      if (resolved.url.endsWith('/app/src/main.mjs')) {
        observed = { home: os.homedir(), dsh: process.env.DSH_HOME, bot: process.env.DS_BOT_HOME, workspace: process.env.DS_BOT_WORKSPACE }
        dispose = process.listeners('exit').find(listener => !listeners.has(listener))
        throw failure
      }
      return resolved
    },
  })
  t.after(() => {
    hooks.deregister()
    dispose?.()
  })
  await assert.rejects(startApp({ firstRun: true }), error => error === failure)
  assert.notEqual(observed.home, homedir())
  assert.equal(observed.dsh, join(observed.home, 'original-dsh'))
  assert.equal(observed.bot, undefined)
  assert.equal(observed.workspace, undefined)
  assert.equal(os.homedir, homedir)
  for (const [name, value] of previous) assert.equal(process.env[name], value, name)
  assert.equal(process.listeners('exit').includes(dispose), false)
})
