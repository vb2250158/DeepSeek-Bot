import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { readFileSync, realpathSync, existsSync } from 'node:fs'

export const HOST_ROOT = import.meta.dirname
const CHECKOUT = resolve(HOST_ROOT, '..')

/** Resolve deployment settings without borrowing the operator's active DSH home. */
export function hostConfig(env = process.env) {
  if (env.DS_BOT_HOST_HOME && !isAbsolute(env.DS_BOT_HOST_HOME)) {
    throw new Error('DS_BOT_HOST_HOME must be an absolute directory')
  }
  const home = resolve(env.DS_BOT_HOST_HOME || join(CHECKOUT, '.ds-bot-host'))
  const canonical = path => existsSync(path) ? realpathSync(path) : resolve(path)
  const personal = join(homedir(), '.dsh')
  if (canonical(home).toLowerCase() === canonical(personal).toLowerCase()) {
    throw new Error('DS_BOT_HOST_HOME must be separate from the personal DSH home')
  }
  const rawPort = env.DS_BOT_HOST_PORT || '3097'
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new Error('DS_BOT_HOST_PORT must be an integer from 1 to 65535')
  }
  const port = Number(rawPort)
  let publicUrl
  if (env.DS_BOT_PUBLIC_URL) {
    const raw = env.DS_BOT_PUBLIC_URL
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || /\s/.test(raw)) {
      throw new Error('DS_BOT_PUBLIC_URL must be an HTTPS origin without credentials, a path, query or fragment')
    }
    publicUrl = url.origin + '/'
  }
  return { home, port, publicUrl }
}

/** Arguments for DSH's public profile launcher. The proxy owns the external listener. */
export function launchArgs(config, patch) {
  const args = ['--profile', 'web', '--patch', patch, '--host', '127.0.0.1', '--port', String(config.port), '--no-open']
  if (config.publicUrl) args.push('--trusted-host', new URL(config.publicUrl).host)
  return args
}

/** Advertise the proxy origin in the launcher's startup line; leave other output intact. */
export function displayLine(line, config) {
  if (!config.publicUrl || !line.startsWith('dsh web: ')) return line
  return line.replace(`http://127.0.0.1:${config.port}`, config.publicUrl.slice(0, -1))
}

/** Find the CLI from its published bin manifest, without importing runtime internals. */
export function dshBin() {
  const require = createRequire(import.meta.url)
  const manifest = require.resolve('@deepseek-ai/dsh/package.json')
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.dsh
  if (typeof bin !== 'string' || isAbsolute(bin) || bin.split(/[\\/]/).includes('..')) {
    throw new Error('The installed DSH package does not declare a relative dsh executable')
  }
  return join(dirname(manifest), bin)
}
