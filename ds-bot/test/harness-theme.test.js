import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allThemes, shellTokens, themeCss } from '../src/client/themes.js'

test('the Harness theme inherits its surfaces and text without overriding host tokens', () => {
  const theme = allThemes().harness
  assert.ok(theme)
  const css = themeCss(theme)
  assert.match(css, /--bt-main:var\(--dsw-alias-bg-base\)/)
  assert.match(css, /--bt-sidebar:var\(--dsw-specific-sidebar-fill\)/)
  assert.match(css, /--bt-ink:var\(--dsw-alias-label-primary\)/)
  assert.match(css, /--bt-user:var\(--dsw-alias-button-primary-fill\)/)
  assert.match(css, /--bt-user-ink:var\(--dsw-alias-label-primary-foreground\)/)
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|--dsw-[\w-]+:/i)
  assert.deepEqual(shellTokens(theme), {})
})

test('a custom accent in Harness mode preserves the inherited surfaces', () => {
  const css = themeCss(allThemes().harness, '#abcdef')
  assert.match(css, /--bt-accent:#abcdef/)
  assert.match(css, /--bt-main:var\(--dsw-alias-bg-base\)/)
})
