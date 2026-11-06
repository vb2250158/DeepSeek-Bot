import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { once } from 'node:events'
import { syncBuiltinESMExports } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { agentCommand, execAgent, spawnAgent } from '../src/host/local-agents/command.js'
import { cleanEnv, findExecutable, probeVersion } from '../src/host/local-agents/discover.js'
import { validateCustom } from '../src/host/local-agents/engines.js'
import { AcpEngine } from '../src/host/local-agents/acp.js'
import { CodexEngine } from '../src/host/local-agents/codex.js'
import { ClaudeEngine } from '../src/host/local-agents/claude.js'

const fixture = name => fileURLToPath(new URL(`./fixtures/local agent shims/${name}`, import.meta.url))
const windows = { skip: process.platform !== 'win32' }
const output = (file, args, options = {}) => new Promise((resolve, reject) => {
  execAgent(file, args, { encoding: 'utf8', ...options }, (error, stdout) => error === null ? resolve(stdout) : reject(error))
})
const closeChild = async child => {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return
  const closed = once(child, 'close')
  child.kill('SIGTERM')
  await closed
}

test('agent environments omit inherited credential variables while keeping explicit CLI settings', () => {
  const keys = ['DSBOT_FIXTURE_API_KEY', 'DSBOT_FIXTURE_TOKEN', 'DSBOT_FIXTURE_SECRET', 'DSBOT_FIXTURE_PASSWORD', 'dsh_fixture_variable']
  const before = keys.map(key => [key, process.env[key]])
  try {
    for (const key of keys) process.env[key] = 'fake-env-value'
    const env = cleanEnv({ EXPLICIT_CLI_TOKEN: 'fake-explicit-value' })
    for (const key of keys) assert.equal(Object.hasOwn(env, key), false, key)
    assert.equal(env.EXPLICIT_CLI_TOKEN, 'fake-explicit-value')
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('custom command paths and array arguments retain spaces and empty arguments', () => {
  const args = [' leading ', '', 'a"b', 'x & y']
  const input = { name: 'Fixture', command: 'C:/CLI tools/agent.cmd', args }
  assert.deepEqual(validateCustom(input), input)
  assert.throws(() => validateCustom({ ...input, command: 'C:/cli\n/agent.cmd' }), /Command/)
  assert.throws(() => validateCustom({ ...input, args: ['a\0b'] }), /Arguments/)
})

test('an executable runs without a shell', async () => {
  const args = [fixture('arguments.mjs'), ' a ', '']
  assert.deepEqual(JSON.parse(await output(process.execPath, args)).args, [' a ', ''])
})

test('agent subprocesses always request hidden Windows windows', async t => {
  const original = childProcess.spawn
  let options
  t.mock.method(childProcess, 'spawn', (file, args, opts) => {
    options = opts
    return original(file, args, opts)
  })
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  const child = spawnAgent(process.execPath, [fixture('arguments.mjs')], { shell: true, windowsHide: false, stdio: 'pipe' })
  t.after(() => closeChild(child))
  await once(child, 'exit')
  assert.equal(options.windowsHide, true)
  assert.equal(options.shell, false)
})

test('a Windows npm shim passes quotes, spaces and shell characters verbatim to Node', windows, async () => {
  const args = ['', ' leading and trailing ', 'quotes "inside"', 'x\\', '&|<>^()%PATH%!', 'a\r\nb', '中文']
  const bin = fixture('arguments.cmd')
  assert.equal(findExecutable(bin), bin)
  const command = agentCommand(bin, args)
  assert.equal(command.file, process.execPath)
  assert.deepEqual(JSON.parse(await output(bin, args)).args, args)
})

test('unsupported Windows batch files fail with an actionable code without execution', windows, async () => {
  for (const name of ['unsupported.cmd', 'unsupported.bat']) {
    assert.throws(() => spawnAgent(fixture(name), [], {}), { code: 'UNSUPPORTED_AGENT_WRAPPER' })
    assert.deepEqual(await probeVersion(fixture(name), []), { ok: false, error: 'UNSUPPORTED_AGENT_WRAPPER' })
  }
})

test('version discovery starts a Node shim and filters inherited DSH variables', windows, async () => {
  assert.deepEqual(await probeVersion(fixture('arguments.cmd'), ['--version']), { ok: true, version: 'fixture 1.0.0' })
  const before = process.env.DSH_TEST_NOT_FOR_CHILD
  process.env.DSH_TEST_NOT_FOR_CHILD = 'synthetic-do-not-inherit'
  try {
    assert.deepEqual(await probeVersion(fixture('arguments.cmd'), ['--env']), { ok: true, version: 'clean' })
  } finally {
    if (before === undefined) delete process.env.DSH_TEST_NOT_FOR_CHILD
    else process.env.DSH_TEST_NOT_FOR_CHILD = before
  }
})

test('a Windows shim exposes the real Node PID and closes that process', windows, async t => {
  const child = spawnAgent(fixture('arguments.cmd'), ['--wait'], { stdio: 'pipe' })
  t.after(() => closeChild(child))
  await once(child, 'spawn')
  const exited = once(child, 'exit')
  assert.equal(child.spawnfile, process.execPath)
  assert.equal(child.spawnargs.includes(fixture('arguments.cmd')), false)
  child.kill('SIGTERM')
  await exited
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' })
})

test('a timeout terminates the Node process launched through a Windows shim', { ...windows, timeout: 10_000 }, async t => {
  let child
  const done = new Promise(resolve => {
    child = execAgent(fixture('arguments.cmd'), ['--wait'], { timeout: 100, encoding: 'utf8' }, error => resolve(error))
  })
  t.after(() => closeChild(child))
  const error = await done
  assert.equal(error.killed, true)
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' })
})

for (const [name, Engine] of [['codex', CodexEngine], ['acp', AcpEngine], ['claude', ClaudeEngine]]) {
  test(`${name} uses its stdio protocol through a Windows npm shim and closes its real child`, windows, async t => {
    const bin = fixture(`${name}.cmd`)
    const engine = new Engine('fixture', { name: 'Fixture', command: bin, args: [] }, { findExecutable: value => value })
    t.after(async () => {
      const children = [engine.child, ...[...(engine.sessions?.values() ?? [])].map(session => session.child)]
      await engine.close()
      await Promise.all(children.map(closeChild))
    })
    let child
    try {
      if (name === 'claude') {
        const session = await engine.open('fixture', { cwd: import.meta.dirname })
        child = session.child
        engine.cancel(session)
      } else {
        await engine.ensure()
        child = engine.child
        if (name === 'acp') engine.cancel({ acpSessionId: 'fixture' })
        else engine.cancel({ threadId: 'fixture', turnId: 'fixture' })
      }
      assert.equal(child.spawnfile, process.execPath)
      const exited = once(child, 'exit')
      await engine.close()
      await exited
      assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' })
    } finally {
      const pending = child ?? engine.child ?? engine.sessions?.get('fixture')?.child
      await engine.close()
      await closeChild(pending)
    }
  })
}
