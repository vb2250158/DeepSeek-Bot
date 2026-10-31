import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { bundleClientApp, thinClientEntry, bundleOffice } from '../scripts/build-client.mjs'

const committed = () => readFileSync(new URL('../client.js', import.meta.url), 'utf8')

test('build rejects an external node_modules link before generating artifacts', t => {
  const root = mkdtempSync(join(tmpdir(), 'ds-bot-build-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'scripts'))
  copyFileSync(new URL('../scripts/build-client.mjs', import.meta.url), join(root, 'scripts/build-client.mjs'))
  symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/build-client.mjs'), '--check'], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Build dependency is outside the plugin directory/)
})

test('both deferred client artifacts match their sources', async () => {
  assert.equal(thinClientEntry(), committed(), 'client.js is stale: run `npm run build` and commit it')
  assert.equal(await bundleClientApp(), readFileSync(new URL('../client-app.js', import.meta.url), 'utf8'))
})

test('Office CLI artifact matches its sources', async () => {
  assert.equal(await bundleOffice(), readFileSync(new URL('../office.js', import.meta.url), 'utf8'))
})

// dsh runs client.js as a classic script that hands a factory to the module loader; the
// factory's `require` answers only the shell's platform modules.
test('client.js registers a factory that exports apply and inject', () => {
  const registrations = []
  runInNewContext(committed(), { window: { __ModuleLoader__: { load: registration => registrations.push(registration) } } })
  assert.equal(registrations.length, 1)
  const [{ id, factory, ...rest }] = registrations
  assert.equal(id, 'ds-bot')
  assert.deepEqual(Object.keys(rest), [])

  const requested = []
  const platform = {
    'react': { createElement: () => null, Fragment: Symbol('Fragment'), useState: initial => [initial, () => {}], useEffect: () => {}, useMemo: make => make(), useCallback: fn => fn, useRef: current => ({ current }), useId: () => 'id', useSyncExternalStore: (sub, get) => get(), createContext: initial => ({ value: initial, Provider: () => null }), useContext: ctx => ctx.value },
    'react-dom': { createPortal: node => node },
    '@deepseek-ai/dsh-client-ui-primitives': { MarkdownText: () => null },
  }
  const exports = factory((specifier) => {
    requested.push(specifier)
    if (!(specifier in platform)) throw new Error(`no platform module ${specifier}`)
    return platform[specifier]
  })
  assert.deepEqual(requested, [])
  assert.equal(Object.prototype.toString.call(exports), '[object Module]')
  assert.deepEqual(Object.keys(exports).sort(), ['apply', 'inject'])
  assert.equal(typeof exports.apply, 'function')
  // No `configForms`: the client never writes the user's DSH settings, such as the
  // work-details mode it once held at `verbose`.
  assert.deepEqual(Array.from(exports.inject), ['sessions', 'uiWorkspace', 'uiConversation', 'slots', 'theme', 'layout'])
})
