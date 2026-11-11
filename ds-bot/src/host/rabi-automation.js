import { createHash, randomUUID } from 'node:crypto'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'

const invalid = message => { throw Object.assign(new Error(message), { code: 'bot/rabi-validation' }) }
const requestIdOf = deliveryId => deliveryId
const textOf = message => Array.isArray(message?.content) && message.content.every(block => block.type === 'text') ? message.content.map(block => block.text).join('') : null

/** Exposes personal Bot destinations and native queue receipts through the authenticated Bot channel. */
export function install(rt) {
  const { ctx, state } = rt
  const runtimeId = randomUUID()
  const inflight = new Map()
  const uncertain = new Map()
  const flights = new Set()
  let closing = false
  const scope = () => {
    if (typeof state.workspaceId !== 'string' || !state.workspaceId) invalid('DS Bot workspace is not ready. Open the Bot team first.')
    const homeId = getOrCreateAnonymousUserId({ env: { ...process.env, DSH_HOME: rt.dshHome } })
    return createHash('sha256').update(JSON.stringify(['ds-bot-v1', homeId, state.workspaceId])).digest('hex')
  }
  rt.rabiAutomationIdentity = () => ({ botScopeId: scope(), runtimeId })
  const validate = body => {
    if (body?.schemaVersion !== 1) invalid('Unsupported DS Bot automation schema')
    const botScopeId = scope()
    if (body.botScopeId !== botScopeId) invalid('This automation belongs to a different DS Bot workspace')
    const bot = typeof body.botId === 'string' ? rt.botOf(body.botId) : undefined
    if (!bot || bot.id !== body.botId) invalid('Select an existing personal Bot; groups are not supported')
    if (typeof body.deliveryId !== 'string' || !body.deliveryId || body.deliveryId.length > 200 || /[\x00-\x1f]/.test(body.deliveryId)) invalid('Provide a stable delivery ID')
    if (typeof body.message !== 'string' || !body.message.trim()) invalid('Provide the automation message')
    return { bot, botScopeId, botId: bot.id, deliveryId: body.deliveryId, requestId: requestIdOf(body.deliveryId) }
  }
  const reconcile = async (body, signal) => {
    const target = validate(body)
    let unreadable = false
    const sessions = new Set([rt.chatOf(target.botId), target.botId, ...(target.bot.segments ?? []).map(part => part.sessionId)])
    for (const sessionId of sessions) {
      signal?.throwIfAborted()
      try {
        const agent = await rt.resolveAgent(sessionId)
        const session = agent.session
        for (const event of session.snapshotEvents()) {
          if (Number(event.seq) < Number(session.inheritedEventCount ?? 0)) continue
          const messages = event.type === 'agent/inbox/spliced' ? event.data.inserted : event.type === 'user/message' ? [event.data] : []
          for (const message of messages) {
            if (!['user', 'retry'].includes(message.source?.kind) || message.source.rpcId !== target.requestId) continue
            const outcome = textOf(message) === body.message ? 'accepted' : 'conflict'
            if (outcome === 'accepted') await ctx.sessions.flush(session)
            return { schemaVersion: 1, state: outcome, botScopeId: target.botScopeId, botId: target.botId, deliveryId: target.deliveryId, requestId: target.requestId, sessionId, runtimeId }
          }
        }
      } catch {
        signal?.throwIfAborted()
        // An unreadable part cannot prove absence of an earlier acceptance.
        unreadable = true
      }
    }
    const key = JSON.stringify([target.botScopeId, target.botId, target.deliveryId])
    return { schemaVersion: 1, state: uncertain.has(key) && uncertain.get(key) !== body.message ? 'conflict' : unreadable || uncertain.has(key) ? 'uncertain' : 'not_found', botScopeId: target.botScopeId, botId: target.botId, deliveryId: target.deliveryId, requestId: target.requestId, runtimeId }
  }
  const handle = async (endpoint, body = {}, signal) => {
    await rt.load()
    if (body.schemaVersion !== 1) invalid('Unsupported DS Bot automation schema')
    if (endpoint === 'rabi-automation-catalog') return { schemaVersion: 1, ...rt.rabiAutomationIdentity(), bots: Object.values(state.bots).map(bot => ({ botId: bot.id, botName: bot.name, ...(bot.rabiPersona?.roleId ? { roleId: bot.rabiPersona.roleId } : {}) })) }
    if (endpoint === 'rabi-automation-reconcile') return reconcile(body, signal)
    if (endpoint !== 'rabi-automation-deliver') invalid('Unknown DS Bot automation operation')
    if (rt.readOnly() !== undefined) invalid('This DS Bot instance does not own the team write lock')
    const target = validate(body)
    const key = JSON.stringify([target.botScopeId, target.botId, target.deliveryId])
    const pending = inflight.get(key)
    if (pending) return pending.message === body.message ? pending.promise : { schemaVersion: 1, state: 'conflict', botScopeId: target.botScopeId, botId: target.botId, deliveryId: target.deliveryId, runtimeId }
    const promise = (async () => {
      const previous = await reconcile(body, signal)
      if (previous.state !== 'not_found') return previous
      signal?.throwIfAborted()
      try {
        const accepted = await rt.sendUser({ sessionId: target.botId, requestId: target.requestId, content: [{ type: 'text', text: body.message }] })
        const agent = await rt.resolveAgent(accepted.sessionId)
        await ctx.sessions.flush(agent.session)
        return { schemaVersion: 1, state: 'accepted', botScopeId: target.botScopeId, botId: target.botId, deliveryId: target.deliveryId, requestId: target.requestId, sessionId: accepted.sessionId, runtimeId }
      } catch {
        // Failed outcomes remain fenced for this runtime; accepted ticks add no team-state receipts.
        uncertain.set(key, body.message)
        return { schemaVersion: 1, state: 'uncertain', botScopeId: target.botScopeId, botId: target.botId, deliveryId: target.deliveryId, requestId: target.requestId, runtimeId }
      }
    })()
    inflight.set(key, { message: body.message, promise })
    try { return await promise } finally { inflight.delete(key) }
  }
  rt.rabiAutomationEndpoint = (endpoint, body, signal) => {
    if (closing) return Promise.reject(Object.assign(new Error('DS Bot automation is stopping. Retry after it restarts.'), { code: 'bot/rabi-unavailable' }))
    const flight = handle(endpoint, body, signal).finally(() => flights.delete(flight))
    flights.add(flight)
    return flight
  }
  ctx.effect(() => async () => {
    // The removed route may still have callers: stop admission before awaiting their real queue/flush work.
    closing = true
    await Promise.allSettled([...flights])
    inflight.clear(); uncertain.clear()
  }, 'ds-bot: Rabi automation')
}
