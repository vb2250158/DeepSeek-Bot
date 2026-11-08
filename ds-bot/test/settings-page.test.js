import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

// Settings run() owns error reporting and resolves a boolean; it is not the API result.
test('Local agents reads API data while the settings runner returns a boolean', async () => {
  const { outputFiles } = await build({
    stdin: { contents: "export { LocalAgentsPage } from './src/client/local-agents-page.js'", resolveDir: fileURLToPath(new URL('..', import.meta.url)) },
    bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent', external: ['react'],
  })
  let state = null
  let effect
  const calls = []
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: initial => initial === null ? [state, value => { state = value }] : [initial, () => {}],
    useEffect: fn => { effect = fn },
  }
  const module = { exports: {} }
  const view = { available: true, detected: [], custom: [] }
  runInNewContext(outputFiles[0].text, {
    module, exports: module.exports, require: () => react,
    fetch: async url => { calls.push(url); return { ok: true, json: async () => ({ ok: true, value: view }) } },
    window: {}, localStorage: { getItem: () => null }, navigator: { language: 'en' },
  })
  const pending = []
  const props = { run: value => { const promise = value.then(() => true); pending.push(promise); return promise }, Section: 'section', Row: 'row' }
  assert.equal(module.exports.LocalAgentsPage(props), null)
  effect()
  await Promise.all(pending)
  assert.deepEqual(JSON.parse(JSON.stringify(state)), view)
  assert.doesNotThrow(() => module.exports.LocalAgentsPage(props))
  assert.equal(calls.length, 1)
})
