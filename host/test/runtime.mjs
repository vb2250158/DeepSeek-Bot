// Isolated real-process fixture for browser and HTTP checks. Startup credentials stay in memory.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { request } from 'node:https'
import { join, resolve } from 'node:path'
import { HOST_ROOT } from '../config.mjs'

const root = resolve(HOST_ROOT, '..')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const clean = value => String(value).replace(/([?&]token=)[^\s"'<>]+/g, '$1<redacted>')

async function freePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}

/** Start the public host launcher, mock model and real TLS proxy in an isolated data directory. */
export async function startFixture({ caddyBin, npmCli, onProgress = () => {} }) {
  const home = mkdtempSync(join(root, '.dsh-test-host-'))
  const ports = []
  while (ports.length < 3) {
    const port = await freePort()
    if (!ports.includes(port)) ports.push(port)
  }
  const [webPort, mockPort, proxyPort] = ports
  const origin = `https://ds-bot.test:${proxyPort}`
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD/i.test(key)))
  const env = {
    ...inherited,
    DS_BOT_HOST_HOME: home,
    DS_BOT_HOST_PORT: String(webPort),
    DS_BOT_PUBLIC_URL: origin,
    DS_BOT_PUBLIC_ADDRESS: `ds-bot.test:${proxyPort}`,
    DEEPSEEK_BASE_URL: `http://127.0.0.1:${mockPort}/v1`,
    DEEPSEEK_API_KEY: 'mock-key',
    MOCK_PORT: String(mockPort), MOCK_DELAY_MS: '1200',
    MOCK_LOG: join(home, 'mock.jsonl'),
    XDG_DATA_HOME: join(home, 'proxy-data'),
    XDG_CONFIG_HOME: join(home, 'proxy-config'),
    npm_execpath: npmCli,
  }
  const children = new Set()
  const launch = (bin, args, extraEnv = {}) => {
    const child = spawn(bin, args, { cwd: root, env: { ...env, ...extraEnv }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    children.add(child)
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    child.on('error', error => { output += error.message })
    return { child, output: () => output }
  }
  const stop = async ({ child }) => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const closed = once(child, 'close')
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      await once(killer, 'close')
    } else child.kill('SIGTERM')
    await closed
  }
  const close = async () => {
    for (const child of [...children].reverse()) await stop({ child })
  }
  const ready = async (running, predicate, label, timeout = 120_000) => {
    const deadline = Date.now() + timeout
    while (!predicate(running.output())) {
      if (running.child.exitCode !== null || Date.now() > deadline) throw new Error(`${label} did not become ready: ${clean(running.output()).slice(-5000)}`)
      await pause(150)
    }
  }
  let host
  let proxy
  let loginUrl
  const startHost = async () => {
    host = launch(process.execPath, [join(HOST_ROOT, 'start.mjs')])
    await ready(host, text => /dsh web: https:\/\/ds-bot\.test:\d+\/\?token=/.test(text), 'DS Bot host')
    loginUrl = host.output().match(/https:\/\/ds-bot\.test:\d+\/\?token=[^\s]+/)[0]
  }
  try {
    onProgress('Installing the fork into an isolated host profile')
    const setup = launch(process.execPath, [join(HOST_ROOT, 'setup.mjs')])
    const [code] = await once(setup.child, 'close')
    if (code !== 0) throw new Error(`Host setup failed: ${clean(setup.output()).slice(-5000)}`)
    onProgress('Host profile installed; starting mock model and Web host')
    const mock = launch(process.execPath, [join(root, 'ds-bot', 'dev', 'mock-llm.mjs')])
    await ready(mock, text => text.includes('ds-bot mock on'), 'Mock model')
    await startHost()
    onProgress('Web host ready; starting HTTPS proxy')
    proxy = launch(caddyBin, ['run', '--config', join(HOST_ROOT, 'Caddyfile'), '--adapter', 'caddyfile'])
    await ready(proxy, text => text.includes('serving initial configuration'), 'HTTPS proxy')
    await ready(proxy, text => text.includes('certificate obtained successfully'), 'HTTPS certificate')
    onProgress('HTTPS certificate issued')
  } catch (error) {
    await close()
    throw error
  }
  // A synthetic hostname exercises --trusted-host without changing the machine's DNS.
  const http = (path, { cookie, body, originHeader, hostHeader } = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const req = request({
      hostname: '127.0.0.1', port: proxyPort, servername: 'ds-bot.test', path,
      // Only this fixture's ephemeral local CA is untrusted by the test process.
      rejectUnauthorized: false,
      method: payload ? 'POST' : 'GET',
      headers: { host: hostHeader ?? `ds-bot.test:${proxyPort}`, ...(cookie ? { cookie } : {}), ...(originHeader ? { origin: originHeader } : {}), ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}) },
    }, response => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { text += chunk })
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text }))
    })
    req.on('error', error => reject(new Error(`${error.message}\n${clean(proxy.output()).slice(-4000)}`)))
    req.setTimeout(30_000, () => req.destroy(new Error('Fixture request timed out')))
    req.end(payload)
  })
  return {
    home, origin, proxyPort, webPort, http,
    waitForHTTPS: async () => {
      const deadline = Date.now() + 30_000
      for (;;) {
        try {
          const response = await http('/')
          if (response.status === 401) return
          throw new Error(`HTTPS readiness returned ${response.status}`)
        } catch (error) {
          if (Date.now() >= deadline) throw error
          await pause(100)
        }
      }
    },
    loginUrl: () => loginUrl,
    restart: async () => { await stop(host); await startHost() },
    close,
  }
}
