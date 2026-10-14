import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, existsSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { dshBin, hostConfig, HOST_ROOT } from './config.mjs'

const config = hostConfig()
const npm = process.env.npm_execpath
if (!npm) throw new Error('Run setup through npm run setup')
const plugin = resolve(HOST_ROOT, '..', 'ds-bot')
const env = { ...process.env, DSH_HOME: config.home }
const run = (args, cwd, capture = false) => {
  const result = spawnSync(process.execPath, args, {
    cwd, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Host setup command failed with exit code ${result.status}`)
  return result.stdout
}
// Pack the fork, rather than installing the unrelated npm release named ds-bot.
const temporary = mkdtempSync(join(tmpdir(), 'ds-bot-pack-'))
let archive
try {
  const packed = JSON.parse(run([npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', temporary], plugin, true))
  const filename = packed[0]?.filename
  if (typeof filename !== 'string' || filename !== filename.split(/[\\/]/).at(-1)) throw new Error('npm pack returned an invalid archive name')
  const source = join(temporary, filename)
  const packages = join(config.home, 'packages')
  mkdirSync(packages, { recursive: true })
  archive = join(packages, filename)
  const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')
  if (existsSync(archive) && digest(archive) !== digest(source)) {
    throw new Error('This host already has a different archive with the same version. Increment the fork version before setup.')
  }
  if (!existsSync(archive)) copyFileSync(source, archive)
} finally {
  // Only the fresh mkdtemp directory created above is removed.
  rmSync(temporary, { recursive: true, force: true })
}
run([dshBin(), 'plugin', '--profile', 'web', 'add', archive], HOST_ROOT)
console.log('DS Bot host profile installed. Start with npm start. Configure models in the host browser settings.')
