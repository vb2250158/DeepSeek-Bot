// The first run asks where the app keeps its data, on the start page. A quit while it asks
// ends the app even when the page never answers it (#401).
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import os from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { app, state } from './helpers/fake-electron.mjs'
import { state as hostState } from './helpers/fake-host-process.mjs'
import { startApp, waitFor } from './helpers/app-harness.mjs'
import { installHooks } from './helpers/register.mjs'

await installHooks()

const originalHomedir = os.homedir
const originalDshHome = process.env.DSH_HOME
const entered = Promise.withResolvers()
const release = Promise.withResolvers()
const gateKey = 'ds-bot-first-run-updater'
globalThis[Symbol.for(gateKey)] = { entered: entered.resolve, release: release.promise }
const updater = new URL('./helpers/fake-updater.mjs', import.meta.url).href
const heldUpdater = `data:text/javascript,${encodeURIComponent(`globalThis[Symbol.for('${gateKey}')].entered(); await globalThis[Symbol.for('${gateKey}')].release; export { default } from '${updater}'`)}`
const modules = new Set()
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const fromMain = context.parentURL?.endsWith('/app/src/main.mjs')
    if (fromMain && specifier === 'electron-updater') return { url: heldUpdater, shortCircuit: true }
    const resolved = nextResolve(specifier, context)
    if (fromMain) modules.add(resolved.url)
    return resolved
  },
})

let places
before(async () => { places = await startApp({ firstRun: true }) })

after(async () => {
  release.resolve()
  hostState.release()
  app.quit()
  await new Promise(done => setImmediate(done))
  hooks.deregister()
  delete globalThis[Symbol.for(gateKey)]
  app.emit('will-quit')
  places.dispose()
  assert.equal(os.homedir, originalHomedir)
  assert.equal(process.env.DSH_HOME, originalDshHome)
})

const isStart = win => (win.options.webPreferences?.additionalArguments ?? []).some(arg => arg.startsWith('--ds-bot-start='))

test('a quit while the first run loads its modules starts no Host or window afterward', async () => {
  assert.equal(os.homedir(), places.home)
  assert.equal(process.env.DSH_HOME, join(places.home, 'original-dsh'))
  await waitFor(() => state.windows.some(isStart), 'the start window')
  await entered.promise
  // Let every other startup import finish; only the updater keeps loadModules waiting.
  await Promise.all([...modules].map(url => import(url)))
  app.quit()
  await waitFor(() => state.windows.every(win => win.destroyed), 'leave anyway')
  const windows = state.windows.length
  release.resolve()
  await import(heldUpdater)
  await new Promise(done => setImmediate(done))
  assert.equal(hostState.starts, 0, 'a late import must not start a Host after quit')
  assert.equal(state.windows.length, windows, 'a late import must not create the team window after quit')
  assert.ok(state.windows.every(win => win.destroyed))
})
