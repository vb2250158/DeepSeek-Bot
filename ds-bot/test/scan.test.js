import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SCANNER = fileURLToPath(new URL('../../scripts/scan.mjs', import.meta.url))
const repository = ['DeepSeek', 'Bot'].join('-')
const web = `https://github.com/Fei2411/${repository}`

function scan(t, content) {
  const home = mkdtempSync(join(tmpdir(), 'dsb-scan-'))
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }))
  const tree = join(home, 'tree')
  mkdirSync(join(tree, 'ds-bot'), { recursive: true })
  for (const path of ['LICENSE', 'README.md', 'README.zh.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'AGENTS.md', '.gitignore', 'ds-bot/LICENSE']) writeFileSync(join(tree, path), '')
  writeFileSync(join(tree, 'ds-bot/package.json'), JSON.stringify({ name: 'ds-bot', files: ['LICENSE'], homepage: web, repository: { url: `git+${web}.git` }, bugs: { url: `${web}/issues` } }))
  writeFileSync(join(tree, 'references.md'), content)
  const report = join(home, 'findings.json')
  const result = spawnSync(process.execPath, [SCANNER, tree, '--json', report], { encoding: 'utf8' })
  assert.equal(result.signal, null)
  return { ...result, findings: JSON.parse(readFileSync(report, 'utf8')) }
}
const brandFindings = findings => findings.filter(entry => entry.id === 'retired-product-name')

test('public GitHub repository URLs and their exact Markdown labels pass the scanner entry point', (t) => {
  const references = [
    web, `${web}/issues/new`, `${web}#readme`, `git+${web}.git`,
    `https://api.github.com/repos/Fei2411/${repository}/releases/latest`,
    `https://raw.githubusercontent.com/Fei2411/${repository}/main/ds-bot/package.json`,
    `[Fei2411/${repository}](${web})`, `[${repository}](${web}/tree/main)`,
  ]
  const result = scan(t, references.join('\n'))
  assert.deepEqual(result.findings.filter(entry => entry.level === 'must fix'), [])
  assert.equal(result.status, 0)
})

test('allowing a repository reference does not hide retired prose on the same line', (t) => {
  const result = scan(t, `${web} — ${repository} is the product name.\n[Fei2411/${repository}](${web}) followed by ${repository}.`)
  assert.equal(result.status, 1)
  assert.equal(brandFindings(result.findings).length, 2)
  assert.deepEqual(brandFindings(result.findings).map(entry => entry.file), ['references.md', 'references.md'])
})

test('unrelated hosts, lookalike repositories and non-repository Markdown labels remain findings', (t) => {
  const lines = [
    `https://github.com.invalid/Fei2411/${repository}`,
    `https://github.com/Fei2411/${repository}-other`,
    `https://unrelated.invalid/https://github.com/Fei2411/${repository}`,
    `[${repository}](https://unrelated.invalid/repository)`,
    `[${repository}](https://github.com/Fei2411/unrelated)`,
    `[OtherOwner/${repository}](${web})`,
    `[${['DeepSeek', 'Bot'].join(' ')}](${web})`,
    `${web}/issues?q=${repository}`,
  ]
  const result = scan(t, lines.join('\n'))
  assert.equal(result.status, 1)
  assert.equal(brandFindings(result.findings).length, lines.length)
})

test('a secret on the same line as an allowed repository reference is still rejected and redacted', (t) => {
  const secret = 'ghp_' + 'A'.repeat(36)
  const result = scan(t, `[Fei2411/${repository}](${web}) ${secret}`)
  assert.equal(result.status, 1)
  assert.deepEqual(brandFindings(result.findings), [])
  assert.ok(result.findings.some(entry => entry.id === 'secret-github' && entry.level === 'must fix'))
  assert.equal(result.stdout.includes(secret), false)
  assert.equal(JSON.stringify(result.findings).includes(secret), false)
})
