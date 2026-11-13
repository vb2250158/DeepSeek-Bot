import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { installAssistantChat } from '../src/host/assistant-chat.js'

test('assistant chat awaits real Core projection registration and publishes the wire cutoff', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  const rt = { ctx: { get: key => ctx.get(key) } }
  installAssistantChat(rt)
  await rt.assistantChatReady
  const session = ctx.sessions.create()
  assert.deepEqual(rt.assistantChatState(session.id, [], session), { since: null })
  const marker = session.append('rabiroute/assistant-mode', { version: 1 }, { ignorable: true })
  assert.deepEqual(await rt.loadAssistantChat(session.id, session), { since: marker.seq })
  assert.deepEqual(ctx.sessionProjections.snapshot(session).values.dsBotAssistantChat, { since: marker.seq })
})


test('ordinary history reads retain their existing page budget', async () => {
  let pages = 0
  const rt = { ctx: { get: key => key === 'agentPresets' ? { presetForSession: () => 'standard' } : undefined,
    sessionController: { projections() { throw new Error('Ordinary history must not read extra projections') }, page() { pages += 1 } } } }
  installAssistantChat(rt)
  assert.deepEqual(await rt.loadAssistantChat('plain', { id: 'plain' }), { since: null })
  assert.equal(pages, 0)
})

test('agentless history uses the cancellable public projection read without scanning pages', async () => {
  const signal = AbortSignal.timeout(1000)
  const rt = { ctx: { sessionController: {
    async projections(request, actualSignal) { assert.deepEqual(request, { sessionId: 'archived' }); assert.equal(actualSignal, signal); return { kind: 'sequenced', values: { dsBotAssistantChat: { since: 9 } } } },
    page() { throw new Error('Archived history must not rescan the log') },
  } } }
  installAssistantChat(rt)
  assert.deepEqual(await rt.loadAssistantChat('archived', undefined, signal), { since: 9 })
})
