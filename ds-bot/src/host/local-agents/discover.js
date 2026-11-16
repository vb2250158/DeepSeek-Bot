// Finding agent CLIs and the environment they run in: PATH plus the user's
// login-shell PATH plus the usual install folders, and an environment that
// keeps their own sign-in but leaks nothing of ours.
import { execAgent } from './command.js'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

// The CLI signs in by itself; an API key or another agent's backend variable in
// our environment would shadow that or leak, so neither reaches the child.
const DROP_EXACT = new Set([
  'ACP_BACKEND', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_OAUTH_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'XAI_API_KEY', 'ELECTRON_RUN_AS_NODE',
])
const DROP_PREFIX = ['DS_BOT_', 'DSH_', 'ANTIGRAVITY_', 'AGY_', 'DEEPSEEK_']

function isFile(path) {
  try { return statSync(path).isFile() } catch { return false }
}

export function cleanEnv(extra = {}) {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    const upper = key.toUpperCase()
    // Git's injected config is one group; dropping only KEY leaves COUNT/VALUE malformed.
    if (/^GIT_CONFIG_(?:COUNT|PARAMETERS|(?:KEY|VALUE)_\d+)$/.test(upper) || DROP_EXACT.has(upper) || /KEY|TOKEN|SECRET|PASSWORD/.test(upper) || DROP_PREFIX.some(prefix => upper.startsWith(prefix))) continue
    env[key] = value
  }
  // A CLI found outside our sparse PATH (a script with `#!/usr/bin/env node`)
  // needs the same folders to find its interpreter. Windows spells it `Path`.
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH'
  env[pathKey] = searchDirs().join(delimiter)
  return { ...env, ...extra }
}

// A command's output, or undefined. Never synchronous: this runs inside the DSH
// host, and a blocking child process there freezes every Session.
const outputOf = (file, args) => new Promise((resolve) => {
  try {
    execAgent(file, args, { encoding: 'utf8', timeout: 5_000, env: cleanEnv() }, (error, stdout) => resolve(error === null ? stdout : undefined))
  } catch { resolve(undefined) }
})

// macOS/Linux apps launched from a dock icon inherit a sparse PATH; the login
// shell knows where the user actually installed things, and so does npm's global
// prefix. Both are looked up in the background and kept for a minute.
let found = { at: 0, dirs: [] }
let looking
export function refreshSearchDirs() {
  if (Date.now() - found.at < 60_000) return Promise.resolve()
  const windows = process.platform === 'win32'
  looking ??= Promise.all([
    windows ? undefined : outputOf(process.env.SHELL ?? '/bin/sh', ['-l', '-c', 'printf %s "$PATH"']),
    // `npm bin -g` is gone since npm 9; the prefix holds the bin folder. Node starts
    // no `.cmd` without a shell, and npm's Windows prefix is fixed, so it is not asked.
    windows ? undefined : outputOf('npm', ['prefix', '-g']),
  ]).then(([loginPath, prefix]) => {
    const npmBin = windows ? (process.env.APPDATA ? join(process.env.APPDATA, 'npm') : undefined)
      : prefix?.trim() ? join(prefix.trim(), 'bin') : undefined
    found = { at: Date.now(), dirs: [...(loginPath ?? '').split(delimiter).filter(Boolean), ...(npmBin ? [npmBin] : [])] }
  }).finally(() => { looking = undefined })
  return looking
}

const WIN_EXT = ['.cmd', '.exe', '.bat', '']
const candidates = (name) => (process.platform === 'win32' ? WIN_EXT.map(ext => `${name}${ext}`) : [name])

// Every folder a CLI may hide in, in lookup order.
function searchDirs() {
  const home = homedir()
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const extra of [
    ...found.dirs,
    join(home, '.local', 'bin'),
    join(home, '.local', 'share', 'devin', 'cli', '_versions', 'current', 'bin'),
    join(home, '.opencode', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.cargo', 'bin'),
    join(home, '.npm-global', 'bin'),
    process.platform === 'darwin' ? join(home, 'Library', 'pnpm') : join(home, '.local', 'share', 'pnpm'),
    process.platform === 'win32' ? join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'npm') : '',
    process.platform === 'win32' ? join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'agy', 'bin') : '',
    process.platform === 'win32' ? join(home, 'scoop', 'shims') : '',
    join(home, 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]) {
    if (extra !== '' && !dirs.includes(extra) && existsSync(extra)) dirs.push(extra)
  }
  return dirs
}

// The executable's full path, or undefined when the CLI is not installed. Only
// file checks: the folders from refreshSearchDirs() join once it has run.
export function findExecutable(name) {
  if (name.includes('/') || name.includes('\\')) {
    const path = name.startsWith('~') ? join(homedir(), name.slice(1)) : name
    return isFile(path) ? path : undefined
  }
  for (const dir of searchDirs()) {
    for (const file of candidates(name)) {
      const path = join(dir, file)
      if (isFile(path)) return path
    }
  }
  return undefined
}

export function findEngineExecutable(spec, find = findExecutable) {
  for (const command of spec.commands ?? [spec.command]) {
    const path = find(command)
    if (path !== undefined) return path
  }
  return undefined
}

// spawn() for an agent CLI, also when Windows found it as a `.cmd` shim.
export function terminateChild(child) {
  if (child === undefined) return
  try { child.kill('SIGTERM') } catch {}
  setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 5_000).unref?.()
}

// One `--version` call, bounded; the version line is for display only.
export function probeVersion(executable, args, env) {
  return new Promise((resolve) => {
    try {
      execAgent(executable, args, { encoding: 'utf8', timeout: 10_000, env: env ?? cleanEnv() }, (error, stdout, stderr) => {
        const text = `${stdout ?? ''}${stderr ?? ''}`.split('\n').map(line => line.trim()).find(Boolean)
        resolve({ ok: error === null, version: text })
      })
    } catch (error) { resolve({ ok: false, error: error.code }) }
  })
}

function parseJsonSignIn(stdout) {
  const trimmed = String(stdout ?? '').trim()
  if (trimmed === '') return null
  const candidate = trimmed.startsWith('{') ? trimmed : trimmed.match(/\{[\s\S]*\}$/u)?.[0]
  if (!candidate) return null
  try {
    const parsed = JSON.parse(candidate)
    if (parsed === null || typeof parsed !== 'object') return null
    for (const key of ['loggedIn', 'logged_in', 'authenticated', 'signedIn', 'signed_in']) {
      if (typeof parsed[key] === 'boolean') return parsed[key]
    }
  } catch {}
  return null
}

function classifySignIn(error, stdout, stderr, check) {
  const fromJson = parseJsonSignIn(stdout)
  if (fromJson !== null) return fromJson
  const text = `${stdout ?? ''}${stderr ?? ''}`
  if (/not (?:logged|signed) in|not authenticated|unauthenticated|no (?:active )?(?:account|credentials|token)|please (?:log ?in|sign ?in|authenticate)/iu.test(text)) {
    return false
  }
  if (/(?:logged|signed) in/iu.test(text) || /^authenticated(?:\s|$|[:.,])/imu.test(text)) {
    return true
  }
  if (check.nonEmpty === true && error === null && String(stdout ?? '').trim() !== '') return true
  return null
}

// Whether a CLI is signed in: true, false, or null when it cannot tell. A missing
// credential file proves nothing (macOS keeps some in the Keychain), so only a
// command can say false. The output and the file stay here; only the answer leaves.
export function probeSignIn(executable, check, { home = homedir() } = {}) {
  if (check === undefined) return Promise.resolve(null)
  if (check.file !== undefined) return Promise.resolve(isFile(join(home, ...check.file)) ? true : null)
  return new Promise((resolve) => {
    try {
      execAgent(executable, check.args, { encoding: 'utf8', timeout: 3_000, env: cleanEnv(), windowsHide: true }, (error, stdout, stderr) => {
        const result = classifySignIn(error, stdout, stderr, check)
        if (result !== null || check.fallback === undefined) {
          resolve(result)
          return
        }
        void probeSignIn(executable, check.fallback, { home }).then(resolve, () => resolve(null))
      })
    } catch { resolve(null) }
  })
}
