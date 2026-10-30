// Builds the browser half from src/client.
//
//   node scripts/build-client.mjs
//     writes client-app.js  (heavy CJS UI body, loaded after boot)
//     writes client.js      (thin ModuleLoader entry; does not block sibling plugins)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const OUTPUT_APP = join(PLUGIN, 'client-app.js')
const OUTPUT_ENTRY = join(PLUGIN, 'client.js')
const PLATFORM_MODULES = ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives']

export async function bundleClientApp() {
  const result = await build({
    absWorkingDir: PLUGIN,
    entryPoints: ['src/client/index.js'],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    external: PLATFORM_MODULES,
    treeShaking: false,
    charset: 'utf8',
    write: false,
    logLevel: 'silent',
  })
  if (result.warnings.length > 0) throw new Error('esbuild warnings:\n' + result.warnings.map(w => w.text).join('\n'))
  return [
    '// Generated from src/client by `npm run build` (scripts/build-client.mjs). Do not edit by hand.',
    '// Plain CJS body evaluated by the thin client.js after web boot (GET /api/bot/client-app.js).',
    result.outputFiles[0].text.trimEnd(),
    '',
  ].join('\n')
}

const OFFICE_OUTPUT = join(PLUGIN, 'office.js')

export async function bundleOffice() {
  const result = await build({
    absWorkingDir: PLUGIN,
    entryPoints: ['src/office/cli.js'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    charset: 'utf8',
    write: false,
    logLevel: 'silent',
    banner: {
      js: '#!/usr/bin/env node\n// Generated from src/office by `npm run build` (scripts/build-client.mjs). Do not edit by hand.',
    },
  })
  if (result.warnings.length > 0) throw new Error(`esbuild warnings:\n${result.warnings.map(warning => warning.text).join('\n')}`)
  return result.outputFiles[0].text
}

export function thinClientEntry() {
  return readFileSync(join(PLUGIN, 'scripts/thin-client.js'), 'utf8')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await bundleClientApp()
  const entry = thinClientEntry()
  const office = await bundleOffice()
  if (process.argv.includes('--check')) {
    let currentApp = null
    let currentEntry = null
    let currentOffice = null
    try { currentApp = readFileSync(OUTPUT_APP, 'utf8') } catch {}
    try { currentEntry = readFileSync(OUTPUT_ENTRY, 'utf8') } catch {}
    try { currentOffice = readFileSync(OFFICE_OUTPUT, 'utf8') } catch {}
    if (currentApp !== app || currentEntry !== entry || currentOffice !== office) {
      console.error('client artifacts are stale: run `npm run build` in ds-bot and commit the result')
      process.exit(1)
    }
  } else {
    writeFileSync(OUTPUT_APP, app)
    writeFileSync(OUTPUT_ENTRY, entry)
    writeFileSync(OFFICE_OUTPUT, office)
  }
}
