import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { displayLine, hostConfig, launchArgs } from '../config.mjs'

test('dedicated host does not inherit the personal DSH_HOME or a public listener', () => {
  const config = hostConfig({ DSH_HOME: join(homedir(), '.dsh') })
  assert.notEqual(config.home, join(homedir(), '.dsh'))
  assert.equal(config.port, 3097)
  const args = launchArgs(config, 'host.patch.yml')
  assert.equal(args[args.indexOf('--host') + 1], '127.0.0.1')
  assert.ok(args.includes('--no-open'))
  assert.ok(!args.includes('--public-url'))
})

test('reject the personal data directory even when explicitly selected', () => {
  assert.throws(() => hostConfig({ DS_BOT_HOST_HOME: join(homedir(), '.dsh') }), /separate/)
})

test('reject a relative host data directory', () => {
  assert.throws(() => hostConfig({ DS_BOT_HOST_HOME: 'relative-data' }), /absolute/)
})

test('an HTTPS browser authority supplies both advertisement and request trust', () => {
  const config = hostConfig({ DS_BOT_PUBLIC_URL: 'https://bots.example:8443', DS_BOT_HOST_PORT: '3197' })
  const args = launchArgs(config, 'host.patch.yml')
  assert.equal(config.publicUrl, 'https://bots.example:8443/')
  assert.equal(args[args.indexOf('--trusted-host') + 1], 'bots.example:8443')
  assert.equal(args[args.indexOf('--port') + 1], '3197')
  assert.ok(!args.includes('--public-url'), 'The pinned DSH release has no public-url flag')
  assert.equal(displayLine('dsh web: http://127.0.0.1:3197/?token=fixture', config), 'dsh web: https://bots.example:8443/?token=fixture')
  assert.equal(displayLine('log http://127.0.0.1:3197/', config), 'log http://127.0.0.1:3197/')
})

for (const url of ['http://bots.example', 'https://user:pass@bots.example', 'https://bots.example/ui/', 'https://bots.example/?token=example', 'https://bots.example/#fragment', ' https://bots.example']) {
  test(`reject an unsupported public origin: ${url.replace(/user:pass|token=example/g, 'example')}`, () => {
    assert.throws(() => hostConfig({ DS_BOT_PUBLIC_URL: url }))
  })
}

for (const port of ['0', '65536', '-1', '3097x', '3.5']) {
  test(`reject an invalid host port: ${port}`, () => {
    assert.throws(() => hostConfig({ DS_BOT_HOST_PORT: port }), /integer/)
  })
}
