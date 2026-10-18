import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/client/rabi-connection.js', import.meta.url))], bundle: true, format: 'cjs', platform: 'node', write: false, external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'] })

test('Rabi connects on entry and focus without overlapping requests, and removes listeners on leave', async () => {
  const module = { exports: {} }, effects = [], listeners = new Map(), calls = []
  let finish
  const gate = new Promise(resolve => { finish = resolve })
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, AbortController,
    window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    require: name => name === 'react' ? {
      createElement: () => null, useState: initial => [initial, () => {}], useRef: initial => ({ current: initial }), useEffect: fn => effects.push(fn), useCallback: fn => fn,
    } : {},
  })
  module.exports.RabiConnectionPage({ actions: { async rabiConnection(endpoint, body, signal) {
    calls.push({ endpoint, signal })
    if (endpoint === 'rabi-connection-status') { await gate; return { available: true } }
    return { connected: true, personas: [] }
  } } })
  const cleanup = effects[0]()
  const focus = listeners.get('focus')
  await focus()
  assert.deepEqual(calls.map(call => call.endpoint), ['rabi-connection-status'])
  finish()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls.map(call => call.endpoint), ['rabi-connection-status', 'rabi-connect'])
  await focus()
  assert.equal(calls.length, 4)
  cleanup()
  assert.equal(listeners.size, 0)
  assert.ok(calls.every(call => call.signal.aborted))
  await focus()
  assert.equal(calls.length, 4)
})

test('persona switches use confirmed binding operations and retain the original Bot when disabled', async () => {
  for (const linked of [false, true]) {
    const module = { exports: {} }, calls = [], persona = { id: 'persona', name: 'Fixture', botId: 'original', linked }
    runInNewContext(bundle.outputFiles[0].text, {
      module, exports: module.exports,
      require: name => name === 'react' ? {
        createElement: (type, props, ...children) => ({ type, props, children }),
        useState: initial => [initial?.personas ? { available: true, hooksReady: true, connected: true, personas: [persona] } : initial, () => {}],
        useRef: () => ({ current: { signal: new AbortController().signal } }), useEffect() {}, useCallback: fn => fn,
      } : {},
    })
    const tree = module.exports.RabiConnectionPage({ actions: { async rabiConnection(endpoint, body) { calls.push({ endpoint, body }); return { personas: [persona] } } } })
    const find = node => !node || typeof node !== 'object' ? null : node.props?.label === 'Connect Fixture automatically' ? node : [node.children].flat(Infinity).map(find).find(Boolean)
    const toggle = find(tree)
    assert.equal(toggle.props.on, linked)
    assert.equal(toggle.props.label, 'Connect Fixture automatically')
    toggle.props.onChange(!linked)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(calls.map(call => call.endpoint), [linked ? 'rabi-persona-unlink' : 'rabi-persona-import', 'rabi-connect'])
    assert.equal(JSON.stringify(calls[0].body), JSON.stringify(linked ? { botId: 'original' } : { roleId: 'persona' }))
  }
})
