import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { displayLine, dshBin, hostConfig, HOST_ROOT, launchArgs } from './config.mjs'

const config = hostConfig()
if (!existsSync(join(config.home, 'profiles', 'web', 'package.json'))) {
  throw new Error('Host profile is not installed. Run npm run setup first.')
}
const child = spawn(process.execPath, [dshBin(), ...launchArgs(config, join(HOST_ROOT, 'host.patch.yml'))], {
  cwd: HOST_ROOT,
  env: { ...process.env, DSH_HOME: config.home },
  stdio: ['inherit', 'pipe', 'inherit'],
  windowsHide: true,
})
const output = createInterface({ input: child.stdout })
output.on('line', line => console.log(displayLine(line, config)))
const stop = () => child.kill('SIGTERM')
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
child.on('error', error => {
  console.error(`DS Bot host could not start: ${error.message}`)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  output.close()
  process.off('SIGINT', stop)
  process.off('SIGTERM', stop)
  process.exitCode = code ?? (signal ? 1 : 0)
})
