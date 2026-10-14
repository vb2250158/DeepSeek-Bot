import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { startFixture } from './runtime.mjs'
const require = createRequire(resolve(process.env.DS_BOT_PLAYWRIGHT_ROOT, 'package.json'))
const { chromium } = require('playwright')
const fixture = await startFixture({ caddyBin: process.env.DS_BOT_CADDY, npmCli: process.env.npm_execpath, onProgress: console.log, pluginPaths: [join(import.meta.dirname, 'rabi-fixture')] })
let browser
let page
try {
  await fixture.waitForHTTPS()
  const loginAddress = new URL(fixture.loginUrl())
  const login = await fixture.http(loginAddress.pathname + loginAddress.search)
  const cookie = login.headers['set-cookie'].map(value => value.split(';')[0]).join('; ')
  const api = async (endpoint, payload = {}) => {
    const response = await fixture.http('/api/bot', { cookie, body: { endpoint, payload } })
    const result = JSON.parse(response.text)
    assert.equal(result.ok, true, result.error?.message)
    return result.value
  }
  // Complete the isolated team's model setup before opening its settings UI.
  const initial = await api('state')
  const model = initial.models.find(item => item.provider === 'deepseek-official' && item.id === 'deepseek-flash')
  assert.ok(model)
  await api('update-bot', { id: initial.mainBotId, model: model.ref })
  browser = await chromium.launch({ headless: true, executablePath: process.env.DS_BOT_BROWSER_EXECUTABLE,
    args: ['--host-resolver-rules=MAP ds-bot.test 127.0.0.1', '--no-proxy-server'],
  })
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, locale: 'en-US' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(fixture.loginUrl())
  await page.getByText('Chief', { exact: true }).first().waitFor({ timeout: 60000 })
  // The account menu owns the Bot settings entry.
  await page.getByRole('button', { name: /^(Account|账户)$/ }).click()
  await page.getByRole('menuitem', { name: /^(Bot settings|Bot 设置)$/ }).click()
  await page.getByRole('button', { name: /^(Computers|电脑)$/ }).click()
  const toggle = page.getByRole('switch', { name: /^(Use Rabi computer panel|使用 Rabi 电脑面板)$/ })
  await toggle.waitFor()
  await toggle.click()
  const machine = page.locator('.bt-set-row').filter({ hasText: 'Build computer' })
  await machine.getByRole('button', { name: /^(Remote terminal|远端终端)$/ }).click()
  await page.getByRole('button', { name: /^(New powershell terminal|新建 powershell 终端)$/ }).click()
  const output = page.getByLabel(/^(Terminal output|终端输出)$/)
  await output.filter({ hasText: 'Synthetic terminal ready' }).waitFor()
  const terminalLabel = await page.locator('.bt-rabi-terminal > div > p').allTextContents()
  const input = page.getByLabel(/^(Remote command|远程命令)$/)
  await input.fill('echo Synthetic GUI check')
  await page.getByRole('button', { name: /^(Send command|发送命令)$/ }).click()
  await output.filter({ hasText: 'Received: echo Synthetic GUI check' }).waitFor()
  await input.fill('TEST_UNCERTAIN')
  await page.getByRole('button', { name: /^(Send command|发送命令)$/ }).click()
  await page.getByRole('alert').filter({ hasText: 'outcome is uncertain' }).waitFor()
  assert.equal(await page.getByRole('button', { name: /^(Send command|发送命令)$/ }).isDisabled(), true)
  await page.getByRole('button', { name: /^(Query original sessions|查询原会话)$/ }).click()
  await output.filter({ hasText: 'Received: TEST_UNCERTAIN' }).waitFor()
  await input.fill('echo after readback')
  await page.getByRole('button', { name: /^(Send command|发送命令)$/ }).click()
  await output.filter({ hasText: 'Received: echo after readback' }).waitFor()
  // Toggle off detaches viewing; re-enable and select the original terminal.
  await toggle.click()
  await toggle.click()
  await machine.getByRole('button', { name: /^(Remote terminal|远端终端)$/ }).click()
  const original = page.getByRole('button', { name: /^powershell ·/ })
  await original.waitFor()
  assert.equal(await original.count(), 1)
  await original.click()
  await output.filter({ hasText: 'Received: echo after readback' }).waitFor()
  const evidence = process.env.DS_BOT_EVIDENCE_DIR
  if (evidence) { mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, 'rabi-computers.png') }) }
  await page.getByRole('button', { name: /^(Exit terminal and stop child processes|退出终端并结束子程序)$/ }).click()
  await page.getByRole('button', { name: /^powershell ·.*exited$/ }).waitFor()
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log(JSON.stringify({ guiSwitch: true, originalTerminalReuse: true, inputAndOutput: true, uncertainInputReadback: true, noReplacementTransport: true, pageErrors: 0, initialTerminalLabelCount: terminalLabel.length }))
} catch (error) {
  if (page) {
    console.log('Fixture UI controls:', await page.getByRole('button').allTextContents())
    console.log('Fixture alerts:', await page.getByRole('alert').allTextContents())
  }
  throw error
} finally { await browser?.close(); await fixture.close() }
