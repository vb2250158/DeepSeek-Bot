import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { startFixture } from './runtime.mjs'

if (!process.env.DS_BOT_CADDY || !process.env.DS_BOT_PLAYWRIGHT_ROOT) {
  throw new Error('Set DS_BOT_CADDY to the Caddy executable and DS_BOT_PLAYWRIGHT_ROOT to a package root containing Playwright')
}
const require = createRequire(resolve(process.env.DS_BOT_PLAYWRIGHT_ROOT, 'package.json'))
const { chromium } = require('playwright')
const fixture = await startFixture({ caddyBin: process.env.DS_BOT_CADDY, npmCli: process.env.npm_execpath, onProgress: console.log })
let browser
let pages = []
try {
  await fixture.waitForHTTPS()
  console.log('HTTPS requests ready; checking authentication and browser clients')
  const unauthenticated = await fixture.http('/api/bot', { body: { endpoint: 'state' } })
  assert.equal(unauthenticated.status, 401)
  const login = await fixture.http(new URL(fixture.loginUrl()).pathname + new URL(fixture.loginUrl()).search)
  assert.equal(login.status, 303)
  assert.ok(login.headers['set-cookie'].every(cookie => /;\s*Secure/i.test(cookie)))
  const cookie = login.headers['set-cookie'].map(value => value.split(';')[0]).join('; ')
  const forbidden = await fixture.http('/api/bot', { cookie, originHeader: 'https://other.test', body: { endpoint: 'state' } })
  assert.equal(forbidden.status, 403)
  const api = async (endpoint, payload = {}) => {
    const response = await fixture.http('/api/bot', { cookie, body: { endpoint, payload } })
    assert.equal(response.status, 200)
    const result = JSON.parse(response.text)
    assert.equal(result.ok, true, result.error?.message)
    return result.value
  }
  const initial = await api('state')
  const chief = initial.bots.find(bot => bot.name === 'Chief')
  assert.ok(chief)
  const model = initial.models.find(item => item.provider === 'deepseek-official' && item.id === 'deepseek-flash')
  assert.ok(model, 'The isolated mock DeepSeek route must be available')
  await api('update-bot', { id: chief.id, model: model.ref })
  await api('create-bot', { name: 'Browser QA', role: 'Shared host verification', instructions: 'Answer the user.', model: model.ref })

  browser = await chromium.launch({
    headless: true,
    ...(process.env.DS_BOT_BROWSER_EXECUTABLE ? { executablePath: process.env.DS_BOT_BROWSER_EXECUTABLE } : {}),
    args: ['--host-resolver-rules=MAP ds-bot.test 127.0.0.1', '--no-proxy-server'],
  })
  const errors = []
  let stage = 'open clients'
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true })
  pages = [await desktop.newPage(), await mobile.newPage()]
  for (const page of pages) {
    page.on('pageerror', error => errors.push(`${stage}: ${error.message}`))
    await page.goto(fixture.loginUrl(), { waitUntil: 'domcontentloaded' })
    await page.getByText('Chief', { exact: true }).first().waitFor({ timeout: 60_000 })
    assert.ok(!page.url().includes('token='))
  }
  stage = 'shared roster'
  await api('update-bot', { id: (await api('state')).bots.find(bot => bot.name === 'Browser QA').id, name: 'Shared QA' })
  for (const page of pages) {
    await page.bringToFront()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /^Shared QA(?:,|$)/ }).waitFor({ timeout: 30_000 })
  }

  // The model continues after the initiating browser closes; another client sees the result.
  stage = 'send and close client'
  const composer = pages[0].locator('[contenteditable="true"]').first()
  await composer.fill('Browser disconnect verification')
  await composer.press('Enter')
  const startDeadline = Date.now() + 30_000
  let state
  do {
    state = await api('state')
    if (Object.keys(state.activity ?? {}).length) break
    await new Promise(resolve => setTimeout(resolve, 50))
  } while (Date.now() < startDeadline)
  assert.ok(Object.keys(state.activity ?? {}).length, 'Host did not begin the requested work')
  await pages[0].close()
  const deadline = Date.now() + 90_000
  do {
    await new Promise(resolve => setTimeout(resolve, 500))
    state = await api('state')
  } while (Object.keys(state.activity ?? {}).length && Date.now() < deadline)
  assert.equal(Object.keys(state.activity ?? {}).length, 0)
  await pages[1].reload({ waitUntil: 'domcontentloaded' })
  await pages[1].getByRole('button', { name: /^Shared QA(?:,|$)/ }).waitFor({ timeout: 30_000 })
  await pages[1].getByRole('button', { name: /^Chief,/ }).click()
  await pages[1].getByText('收到：Browser disconnect verification', { exact: false }).waitFor({ timeout: 30_000 })

  const evidence = process.env.DS_BOT_EVIDENCE_DIR
  stage = 'reopen desktop client'
  const desktopPage = await desktop.newPage()
  await desktopPage.goto(fixture.origin, { waitUntil: 'domcontentloaded' })
  await desktopPage.getByRole('button', { name: /^Shared QA(?:,|$)/ }).waitFor({ timeout: 30_000 })
  if (evidence) {
    mkdirSync(evidence, { recursive: true })
    await desktopPage.screenshot({ path: join(evidence, 'desktop.png') })
    await pages[1].screenshot({ path: join(evidence, 'mobile.png') })
  }
  const fit = await pages[1].evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }))
  assert.ok(fit.scroll <= fit.width + 1, `Mobile page overflows: ${fit.scroll} > ${fit.width}`)
  assert.deepEqual(errors, [])
  stage = 'restart host'
  await fixture.restart()
  const restored = await api('state')
  assert.ok(restored.bots.some(bot => bot.name === 'Shared QA'))
  assert.ok(restored.bots.some(bot => bot.id === chief.id))
  await pages[1].reload({ waitUntil: 'domcontentloaded' })
  await pages[1].getByRole('button', { name: /^Shared QA(?:,|$)/ }).waitFor({ timeout: 30_000 })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ authentication: true, originCheck: true, secureCookie: true, desktopAndMobile: true, sharedRoster: true, workAfterClientClose: true, persistedAfterRestart: true, pageErrors: errors.length, mobileFit: fit }))
} catch (error) {
  for (const [index, page] of pages.entries()) {
    if (page.isClosed()) continue
    if (process.env.DS_BOT_EVIDENCE_DIR) {
      mkdirSync(process.env.DS_BOT_EVIDENCE_DIR, { recursive: true })
      await page.screenshot({ path: join(process.env.DS_BOT_EVIDENCE_DIR, `failure-${index}.png`) })
    }
    console.error(JSON.stringify({ client: index, sharedBotMatches: await page.getByText('Shared QA', { exact: true }).count(), buttons: await page.getByRole('button').evaluateAll(items => items.map(item => item.getAttribute('aria-label') ?? item.getAttribute('title') ?? item.textContent).filter(Boolean).slice(0, 30)) }))
  }
  throw error
} finally {
  await browser?.close()
  await fixture.close()
}
