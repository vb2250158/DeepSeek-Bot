// Current-source Web composition: a private profile, authenticated API/assets, public shutdown.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
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
    await mkdir(join(home, 'bot'), { recursive: true })
    await writeFile(join(home, 'bot/state.json'), JSON.stringify({
      version: 1, mainBotIds: ['seed-a'],
      bots: {
        'seed-a': { id: 'seed-a', name: 'Synthetic Chief', role: 'Coordinator', sessionId: 'seed-a', createdAt: 1 },
        'seed-b': { id: 'seed-b', name: 'Synthetic Writer', role: 'Writer', sessionId: 'seed-b', createdAt: 2 },
      },
      rooms: { 'seed-room': { id: 'seed-room', name: 'Synthetic group', members: ['seed-a', 'seed-b'], admin: 'seed-a', mode: 'admin', named: true, sessions: {}, log: [{ seq: 1, who: 'User', text: 'Earlier group line.', time: 1 }], seq: 1, seen: {} } },
      agents: {}, exchanges: [{ id: 'seed-exchange', from: 'seed-a', to: 'seed-b', role: 'request', text: 'Earlier pair exchange.', time: 1 }],
      exchangeTurns: {}, questions: {}, prefs: {}, revision: 0,
    }))
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
    const call = async (endpoint, payload) => {
      const response = await fetch(`${base}/api/bot`, {
        method: 'POST', headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint, payload }), signal: AbortSignal.timeout(15_000),
      })
      assert.equal(response.status, 200)
      const result = await response.json()
      assert.equal(result.ok, true)
      return result.value
    }
    const pair = await call('exchange', { a: 'seed-a', b: 'seed-b' })
    assert.equal(pair.find(entry => entry.id === 'seed-exchange')?.text, 'Earlier pair exchange.')
    const group = await call('group-rows', { roomId: 'seed-room', from: 1 })
    assert.equal(group.rows.find(row => row.kind === 'user')?.text, 'Earlier group line.')
    const asset = await fetch(`${base}/api/ds-bot-client-app`, { headers: { cookie }, signal: AbortSignal.timeout(15_000) })
    assert.equal(asset.status, 200)
    const clientBytes = await readFile(join(plugin, 'client-app.js'))
    const hash = createHash('sha256').update(clientBytes).digest('hex')
    const etag = `"${hash}"`
    assert.ok(Buffer.from(await asset.arrayBuffer()).equals(clientBytes), 'Served client-app.js differs from source')
    assert.equal(asset.headers.get('etag'), etag)
    assert.equal(asset.headers.get('cache-control'), 'private, no-cache')
    const unchanged = await fetch(`${base}/api/ds-bot-client-app`, {
      headers: { cookie, 'if-none-match': etag }, signal: AbortSignal.timeout(15_000),
    })
    assert.equal(unchanged.status, 304)
    assert.equal((await unchanged.arrayBuffer()).byteLength, 0)
    const versioned = await fetch(`${base}/api/ds-bot-client-app?v=${hash}`, { headers: { cookie }, signal: AbortSignal.timeout(15_000) })
    assert.equal(versioned.status, 200)
    assert.equal(versioned.headers.get('cache-control'), 'private, max-age=31536000, immutable')
    assert.equal(versioned.headers.get('etag'), etag)
    assert.ok(Buffer.from(await versioned.arrayBuffer()).equals(clientBytes))
    const unknown = await fetch(`${base}/api/ds-bot-client-app?v=${'0'.repeat(64)}`, { headers: { cookie }, signal: AbortSignal.timeout(15_000) })
    assert.equal(unknown.status, 404)
    assert.equal(unknown.headers.get('cache-control'), 'no-store')
    child.send('shutdown')
    const [code, signal] = await Promise.race([exited, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Host did not stop through public shutdown')), 30_000)
      timer.unref()
    })])
    assert.equal(code, 0)
    assert.equal(signal, null)
    for (const [book, text] of [['pair-seed-a-seed-b', 'Earlier pair exchange.'], ['group-seed-room', 'Earlier group line.']]) {
      const rows = (await readFile(join(home, 'bot/ledger', book + '.jsonl'), 'utf8')).trim().split('\n').map(row => JSON.parse(row))
      assert.ok(rows.some(row => row.text === text), 'Imported history must persist before shutdown')
    }
    const socket = connect({ host: '127.0.0.1', port: Number(new URL(base).port) })
    try {
      await assert.rejects(once(socket, 'connect', { signal: AbortSignal.timeout(5000) }), { code: 'ECONNREFUSED' })
    } finally { socket.destroy() }
    console.log('Source Web smoke passed: page, Bot API, legacy pair/group ledger import, exact client bytes, content hash and ETag, public exit 0, port closed')
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
