import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { build } from 'esbuild'

const harness = createRequire(`${process.env.DSH_HARNESS}/package.json`)
const ui = createRequire(`${process.env.DSH_HARNESS}/packages/client/ui-primitives/package.json`)
const React = ui('react')
const ReactDOM = ui('react-dom')
const { createRoot } = ui('react-dom/client')
const { act } = React
const { JSDOM } = harness('jsdom')
const bundle = await build({
  stdin: { contents: "export { ComposerPlus } from './src/client/composer.js'", resolveDir: fileURLToPath(new URL('..', import.meta.url)) },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})

test('the attachment control survives roster readiness and a later unowned session', async t => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' })
  let root
  const previous = new Map()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  t.after(async () => {
    if (root) await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  const module = { exports: {} }
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, window: dom.window, document: dom.window.document,
    setTimeout, clearTimeout,
    require: name => name === 'react' ? React : name === 'react-dom' ? ReactDOM : {},
  })
  root = createRoot(dom.window.document.getElementById('root'))
  let roster = { byId: {}, roomsById: {} }
  const render = sessionId => act(async () => root.render(React.createElement(module.exports.ComposerPlus, {
    sessionId, useRoster: select => select(roster), actions: { canReferenceChat: () => false },
  })))
  await render('bot')
  assert.equal(dom.window.document.querySelector('button'), null)
  roster = { byId: { bot: { id: 'bot' } }, roomsById: {} }
  await render('bot')
  assert(dom.window.document.querySelector('button.bt-plus'))
  await render(undefined)
  assert.equal(dom.window.document.querySelector('button'), null)
  await render('bot')
  assert(dom.window.document.querySelector('button.bt-plus'))
})
