import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import { thinClientEntry } from '../scripts/build-client.mjs'

const flush = () => new Promise(resolve => setImmediate(resolve))

for (const mode of ['fetch-pending', 'body-pending']) {
  test(`real Cordis dispose waits for ${mode} without late evaluation or apply`, async t => {
    const ctx = new Context()
    const gate = Promise.withResolvers()
    const entered = Promise.withResolvers()
    const events = []
    const warnings = []
    const app = 'const probe = require("probe"); probe.evaluated(); module.exports = { apply: ctx => probe.applied(ctx.fiber.uid) }'
    let registration
    const response = () => ({ ok: true, text: () => Promise.resolve(app) })
    runInNewContext(thinClientEntry(app), {
      window: { __ModuleLoader__: { load: value => { registration = value } } },
      fetch: (_url, options) => {
        assert.equal(options.signal, undefined)
        if (mode === 'fetch-pending') { entered.resolve(); return gate.promise }
        return Promise.resolve({ ok: true, text: () => { entered.resolve(); return gate.promise } })
      },
      console: { warn: (...args) => warnings.push(args) },
    })
    const plugin = registration.factory(name => {
      assert.equal(name, 'probe')
      return { evaluated: () => events.push('evaluated'), applied: uid => events.push(`applied:${String(uid)}`) }
    })
    for (const name of plugin.inject) ctx.provide(name, {})
    const fiber = ctx.plugin(plugin)
    t.after(async () => {
      gate.resolve(mode === 'fetch-pending' ? response() : app)
      await fiber.dispose()
      await ctx.fiber.dispose()
    })
    await entered.promise
    let disposed = false
    const disposing = fiber.dispose().then(() => { disposed = true })
    await flush()
    assert.equal(fiber.uid, null)
    assert.equal(disposed, false)
    gate.resolve(mode === 'fetch-pending' ? response() : app)
    await disposing
    assert.equal(disposed, true)
    assert.deepEqual(events, [])
    assert.deepEqual(warnings, [])
  })
}
