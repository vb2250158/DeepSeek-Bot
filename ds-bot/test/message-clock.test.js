import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clockLabel, messageClock, rowTime } from '../src/client/text.js'
import { dateLocale } from '../src/client/i18n.js'

// A time in the machine's own zone, some days back, so the test does not depend on the zone.
const at = (daysAgo, hour, minute) => {
  const today = new Date()
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, hour, minute).getTime()
}
const clockOf = ms => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

test('a message shows the clock today, and the day it came in before that', () => {
  const today = at(0, 14, 5)
  assert.equal(messageClock(today), clockOf(today))
  const yesterday = at(1, 9, 3)
  assert.equal(messageClock(yesterday), `Yesterday ${clockOf(yesterday)}`)
  const older = at(5, 9, 3)
  const date = new Date(older)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  const day = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
  assert.equal(messageClock(older), `${day} ${clockOf(older)}`)
  // The hover title always names the day.
  assert.equal(clockLabel(today), `Today ${clockOf(today)}`)
  assert.equal(clockLabel(yesterday), `Yesterday ${clockOf(yesterday)}`)
  assert.equal(clockLabel(older), messageClock(older))
})

test('a conversation row shows the clock today, Yesterday, then a short date', () => {
  const today = at(0, 14, 5)
  assert.equal(rowTime(today), clockOf(today))
  assert.equal(rowTime(at(1, 9, 3)), 'Yesterday')
  const older = at(5, 9, 3)
  assert.equal(rowTime(older), new Date(older).toLocaleDateString(dateLocale(), { month: 'numeric', day: 'numeric' }))
  // The caller's own `now` is the authority, not the machine clock at render.
  assert.equal(rowTime(at(0, 8, 0), at(0, 14, 5)), clockOf(at(0, 8, 0)))
})
