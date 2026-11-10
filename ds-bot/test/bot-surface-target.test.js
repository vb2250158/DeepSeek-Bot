import assert from 'node:assert/strict'
import { test } from 'node:test'
import { botSurfaceTarget, indexRoster } from '../src/client/sources.js'

// Two Bots: one with an archived part, one fresh. `indexRoster` maps every part id to
// its Bot, which is what the module reads.
const roster = (over = {}) => indexRoster({
  revision: 1, mainBotId: 'bot-a', mainBotIds: ['bot-a'],
  bots: [
    { id: 'bot-a', sessionId: 'part-a2', parts: ['part-a1'] },
    { id: 'bot-b', sessionId: 'part-b1', parts: [] },
  ],
  rooms: [], agents: [],
  ...over,
})

test('a Bot conversation already in the main view stays where it is', () => {
  assert.deepEqual(botSurfaceTarget(roster(), 'bot-a', undefined), {})
  // The current part and an archived part both belong to the Bot.
  assert.deepEqual(botSurfaceTarget(roster(), 'part-a2', undefined), {})
  assert.deepEqual(botSurfaceTarget(roster(), 'part-a1', undefined), {})
})

test('a group chat in the main view stays too, but another Session gives way to a Bot', () => {
  const withRoom = roster({ rooms: [{ id: 'room-1', sessionId: 'room-1-part2', ownParts: [] }] })
  assert.deepEqual(botSurfaceTarget(withRoom, 'room-1', undefined), {})
  assert.deepEqual(botSurfaceTarget(withRoom, 'room-1-part2', undefined), {})
  // A DSH Agent Session, or any Session no Bot owns, is not the Bot surface's to keep.
  assert.deepEqual(botSurfaceTarget(withRoom, 'session-agent', undefined), { open: 'bot-a' })
})

test('without a Bot conversation it opens the last one this browser showed', () => {
  assert.deepEqual(botSurfaceTarget(roster(), 'session-agent', 'bot-b'), { open: 'bot-b' })
  assert.deepEqual(botSurfaceTarget(roster(), undefined, 'part-a1'), { open: 'bot-a' })
})

test('a forgotten Bot falls back to the Main Bot, and an empty team opens nothing', () => {
  assert.deepEqual(botSurfaceTarget(roster(), undefined, undefined), { open: 'bot-a' })
  assert.deepEqual(botSurfaceTarget(roster(), 'session-agent', 'deleted-bot'), { open: 'bot-a' })
  assert.deepEqual(botSurfaceTarget(roster({ mainBotId: null, bots: [] }), undefined, 'deleted-bot'), {})
})
