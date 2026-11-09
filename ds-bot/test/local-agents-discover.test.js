import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { findExecutable, refreshSearchDirs } from '../src/host/local-agents/discover.js'
import { spawnAgent } from '../src/host/local-agents/command.js'

// npm-*.cmd are what npm 11's cmd-shim writes for a Node script and for an .exe;
// pnpm-node.cmd follows pnpm 11's shim template with a NODE_PATH.
const shim = name => readFileSync(new URL(`./fixtures/windows-shims/${name}`, import.meta.url), 'utf8')
// The maintained shim resolver has exhaustive argument and rejection tests in local-agent-command.test.js.
const SYSTEM = 'Line one.\nSay "hi" & 100% done | <ok>'

// The real thing on the Windows runner: npm's shim, a Node script behind it, and an
// argument that cmd.exe would have cut or expanded.
test('an agent CLI installed by npm starts on Windows', { skip: process.platform !== 'win32' }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsb-shim-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'node_modules', 'opencode-ai', 'bin'), { recursive: true })
  copyFileSync(fileURLToPath(new URL('./fixtures/echo-argv-env.mjs', import.meta.url)), join(root, 'node_modules', 'opencode-ai', 'bin', 'opencode'))
  writeFileSync(join(root, 'opencode.cmd'), shim('npm-node.cmd'))
  const child = spawnAgent(join(root, 'opencode.cmd'), ['acp', SYSTEM], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true })
  let out = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { out += chunk })
  const code = await new Promise(resolve => child.on('exit', resolve))
  assert.equal(code, 0)
  assert.deepEqual(JSON.parse(out).argv, ['acp', SYSTEM])
})

// A slow npm on PATH stands for the real one: it takes seconds to start, and the
// host must not wait for it on the way to a Session.
test('finding a CLI never waits on npm, and npm\'s global folder joins in the background', { skip: process.platform === 'win32' }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsb-discover-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const fakeBin = join(root, 'bin')
  const prefix = join(root, 'npm-global')
  mkdirSync(fakeBin)
  mkdirSync(join(prefix, 'bin'), { recursive: true })
  writeFileSync(join(fakeBin, 'npm'), `#!/bin/sh\nsleep 2\nprintf '%s\\n' '${prefix}'\n`)
  writeFileSync(join(prefix, 'bin', 'dsb-fake-agent'), '#!/bin/sh\n')
  chmodSync(join(fakeBin, 'npm'), 0o755)
  chmodSync(join(prefix, 'bin', 'dsb-fake-agent'), 0o755)
  const { PATH, SHELL } = process.env
  process.env.PATH = `${fakeBin}${delimiter}${PATH}`
  process.env.SHELL = '/bin/false'
  t.after(() => { process.env.PATH = PATH; process.env.SHELL = SHELL })

  const started = Date.now()
  assert.equal(findExecutable('dsb-fake-agent'), undefined)
  const refresh = refreshSearchDirs()
  assert.ok(Date.now() - started < 1000, 'the lookup waited on npm')
  await refresh
  assert.equal(findExecutable('dsb-fake-agent'), join(prefix, 'bin', 'dsb-fake-agent'))
})
