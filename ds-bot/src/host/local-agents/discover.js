import { spawn } from 'node:child_process'
// Finding agent CLIs and the environment they run in: PATH plus the user's
// login-shell PATH plus the usual install folders, and an environment that
// keeps their own sign-in but leaks nothing of ours.
import { execAgent } from './command.js'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join, win32 } from 'node:path'

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
    if (/^GIT_CONFIG_(?:COUNT|PARAMETERS|(?:KEY|VALUE)_\d+)$/.test(upper) || DROP_EXACT.has(upper) || DROP_PREFIX.some(prefix => upper.startsWith(prefix))) continue
    env[key] = value
  }
  // A CLI found outside our sparse PATH (a script with `#!/usr/bin/env node`)
  // needs the same folders to find its interpreter. Windows spells it `Path`.
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH'
  env[pathKey] = searchDirs().join(delimiter)
  return { ...env, ...extra }
}

export function agentEnv(executable, env, { platform = process.platform, find = name => findExecutable(name, { platform, env }) } = {}) {
  if (platform !== 'win32' || !/^pi-acp(?:\.(?:cmd|bat|exe))?$/iu.test(win32.basename(executable)) || Object.keys(env).some(key => key.toUpperCase() === 'PI_ACP_PI_COMMAND')) return env
  const pi = find('pi')
  return pi === undefined ? env : { ...env, PI_ACP_PI_COMMAND: pi }
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
export function findExecutable(name, { platform = process.platform, env = process.env, isFile: fileExists = isFile } = {}) {
  const windows = platform === 'win32'
  const pathJoin = windows ? win32.join : join
  const allowedExt = ['.cmd', '.exe', '.bat', '.com']
  const hasExtension = allowedExt.includes(win32.extname(name).toLowerCase())
  if (name.includes('/') || name.includes('\\')) {
    if (windows && !hasExtension) return undefined
    const path = name.startsWith('~') ? join(homedir(), name.slice(1)) : name
    return fileExists(path) ? path : undefined
  }
  const pathExt = env.PATHEXT === undefined ? allowedExt : env.PATHEXT.split(';').map(ext => ext.toLowerCase()).filter(ext => allowedExt.includes(ext))
  const extensions = windows && !hasExtension ? pathExt : ['']
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH'
  const dirs = windows ? [...(env[pathKey] ?? '').split(';').filter(Boolean), ...(platform === process.platform ? searchDirs() : [])] : searchDirs()
  for (const dir of dirs) {
    if (windows && !win32.isAbsolute(dir)) continue
    for (const ext of extensions) {
      const path = pathJoin(dir, `${name}${ext}`)
      if (fileExists(path)) return path
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

const SIGN_IN_TIMEOUT_MS = 3_000

function probeMacKeychain({ service, account }, spawnKeychain) {
  return new Promise((resolve) => {
    try {
      // Without -g or -w this looks up metadata only. A miss proves nothing:
      // the CLI may be using a fallback credential store.
      const child = spawnKeychain('/usr/bin/security', ['find-generic-password', '-s', service, '-a', account], {
        env: cleanEnv(), stdio: 'ignore', signal: AbortSignal.timeout(SIGN_IN_TIMEOUT_MS), killSignal: 'SIGKILL',
      })
      child.once('error', () => resolve(null))
      child.once('close', (code) => resolve(code === 0 ? true : null))
    } catch { resolve(null) }
  })
}

// The per-user data folder as CodeBuddy resolves it from the home directory
// (it ignores XDG_DATA_HOME and LOCALAPPDATA).
const APP_DATA = { darwin: ['Library', 'Application Support'], win32: ['AppData', 'Local'] }

function hasJsonPaths(file, paths) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return paths.every((path) => Boolean(path.reduce((value, key) => value?.[key], data)))
  } catch {
    return false
  }
}

function probeAppDataFile({ path, loggedOut, has = [] }, home, platform) {
  const file = join(home, ...(APP_DATA[platform] ?? ['.local', 'share']), ...path)
  if (!isFile(file) || (loggedOut !== undefined && isFile(`${file}${loggedOut}`))) return null
  return has.length === 0 || hasJsonPaths(file, has) ? true : null
}

// true, false, or null when the check cannot tell. Only a CLI's status command
// can say false; a missing credential in one store proves nothing.
export function probeSignIn(executable, check, { home = homedir(), platform = process.platform, spawnKeychain = spawn } = {}) {
  if (check === undefined) return Promise.resolve(null)
  if (check.macKeychain !== undefined) {
    return platform === 'darwin' ? probeMacKeychain(check.macKeychain, spawnKeychain) : Promise.resolve(null)
  }
  if (check.file !== undefined) return Promise.resolve(isFile(join(home, ...check.file)) ? true : null)
  if (check.appDataFile !== undefined) return Promise.resolve(probeAppDataFile(check.appDataFile, home, platform))
  return new Promise((resolve) => {
    try {
      execAgent(executable, check.args, { encoding: 'utf8', timeout: SIGN_IN_TIMEOUT_MS, env: cleanEnv(), windowsHide: true }, (error, stdout, stderr) => {
        const result = classifySignIn(error, stdout, stderr, check)
        if (result !== null || check.fallback === undefined) {
          resolve(result)
          return
        }
        void probeSignIn(executable, check.fallback, { home, platform, spawnKeychain }).then(resolve, () => resolve(null))
      })
    } catch { resolve(null) }
  })
}
