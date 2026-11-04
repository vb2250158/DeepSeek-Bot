// Current-source Web composition: a private profile, authenticated API/assets, public shutdown.
import assert from 'node:assert/strict'
import { spawn, execSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const core = process.env.DSH_HARNESS
assert.ok(core, 'Set DSH_HARNESS to the tested Core source checkout')
const plugin = resolve(import.meta.dirname, '..')

if (process.argv[2] === '--host') {
  const require = createRequire(join(core, 'apps/cli/package.json'))
  const { runProfile } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh/profile-boot')).href)
  const { loadLayeredEnv } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href)
  const running = runProfile({ environment: loadLayeredEnv('dsh', process.env.DSH_HOME), profile: 'web', patchFiles: [], args: ['--no-open', '--host', '127.0.0.1', '--port', '0'] })
  process.on('message', async message => {
    if (message !== 'shutdown') return
    const app = await running
    await app.shutdown.shutdown(0)
    process.disconnect?.()
  })
  const app = await running
  process.send({ url: app.ctx.get('connection').authenticatedUrl(`http://127.0.0.1:${app.ctx.get('webServer').port}`) })
} else {
  const home = await mkdtemp(join(tmpdir(), 'dsbot-ci-web-'))
  const profile = join(home, 'profiles/web')
  let child
  let exited
  let output = ''
  try {
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      name: 'dsbot-ci-web', private: true, dependencies: { 'ds-bot': `link:${plugin.replaceAll('\\', '/')}` },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'ds-bot'] } },
    }))
    await writeFile(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n')
    const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }
    execSync('pnpm install --no-frozen-lockfile', { cwd: profile, env, stdio: 'pipe', windowsHide: true })
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--host'], {
      cwd: core, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    exited = once(child, 'exit')
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk })
    const [ready] = await Promise.race([
      once(child, 'message', { signal: AbortSignal.timeout(120_000) }),
      exited.then(([code]) => { throw new Error(`Host exited before readiness (${code})`) }),
    ])
    const login = await fetch(ready.url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    assert.ok(cookie, 'The Web login must set an authentication cookie')
    const base = new URL(ready.url).origin
    const page = await fetch(base, { headers: { cookie }, signal: AbortSignal.timeout(15_000) })
    assert.equal(page.status, 200)
    const api = await fetch(`${base}/api/bot`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'diagnostics', payload: {} }), signal: AbortSignal.timeout(15_000),
    })
    assert.equal(api.status, 200)
    assert.equal((await api.json()).ok, true)
    const asset = await fetch(`${base}/api/ds-bot-client-app`, { headers: { cookie }, signal: AbortSignal.timeout(15_000) })
    assert.equal(asset.status, 200)
    assert.ok(Buffer.from(await asset.arrayBuffer()).equals(await readFile(join(plugin, 'client-app.js'))), 'Served client-app.js differs from source')
    child.send('shutdown')
    const [code, signal] = await Promise.race([exited, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Host did not stop through public shutdown')), 30_000)
      timer.unref()
    })])
    assert.equal(code, 0)
    assert.equal(signal, null)
    const socket = connect({ host: '127.0.0.1', port: Number(new URL(base).port) })
    try {
      await assert.rejects(once(socket, 'connect', { signal: AbortSignal.timeout(5000) }), { code: 'ECONNREFUSED' })
    } finally { socket.destroy() }
    console.log('Source Web smoke passed: page, Bot API, exact client bytes, public exit 0, port closed')
  } catch (error) {
    console.error(output.replace(/([?&]token=)[^&\s]+/gu, '$1<hidden>').slice(-4000))
    throw error
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      if (child.connected) child.send('shutdown')
      const stopped = await Promise.race([exited.then(() => true), new Promise(resolve => {
        const timer = setTimeout(() => resolve(false), 30_000)
        timer.unref()
      })])
      if (!stopped) { child.kill(); await exited }
    }
    await rm(home, { recursive: true, force: true, maxRetries: 5 })
  }
}
