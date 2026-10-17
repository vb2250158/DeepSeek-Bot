import { rabiClient, rabiRefuse as refuse, rabiSegment as segment } from './rabi-client.js'

/** Rabi owns persona documents and bindings; Bots keep only the imported persona reference. */
export function install(rt) {
  const { ctx, state } = rt
  const timeout = rt.config.rabiRequestTimeoutMs ?? 8000
  const maxBytes = rt.config.rabiPersonaMaxBytes ?? 262144
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 120000) throw new TypeError('rabiRequestTimeoutMs must be 1000-120000')
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 2097152) throw new TypeError('rabiPersonaMaxBytes must be 1024-2097152')
  const client = rabiClient(ctx, timeout)
  const shutdown = new AbortController()
  const contexts = new Map()
  const pending = new Map()
  const signalOf = signal => signal ? AbortSignal.any([signal, shutdown.signal]) : shutdown.signal
  const pathOf = id => `/api/codex-hook/sessions/${segment(id)}`
  const binding = async (id, signal) => {
    const { data } = await client.json(pathOf(id), 'GET', undefined, signal)
    if (data === null) return null
    if (data?.sessionId !== id || typeof data.roleId !== 'string' || !data.roleId) refuse('Rabi returned an invalid session binding')
    return data
  }
  const bind = async (id, roleId, signal) => {
    const current = await binding(id, signal)
    if (current?.roleId === roleId) return
    if (current) refuse('This session is linked to another Rabi persona. Check its binding in Rabi first.')
    await client.json(pathOf(id), 'PUT', { roleId }, signal)
    if ((await binding(id, signal))?.roleId !== roleId) refuse('Rabi persona binding was not confirmed. Check the original Bot before retrying.')
  }
  const catalog = async signal => {
    const result = await client.json('/api/personas', 'GET', undefined, signal)
    if (!Array.isArray(result.personas)) refuse('Rabi returned an invalid persona list')
    return result.personas.map(item => {
      segment(item.personaId)
      if (typeof item.name !== 'string') refuse('Rabi returned an invalid persona name')
      return { id: item.personaId, name: item.name }
    })
  }
  const imported = roleId => Object.values(state.bots).find(bot => bot.rabiPersona?.roleId === roleId)
  const uniqueName = name => {
    const base = name.trim().slice(0, 34)
    let value = base, index = 2
    while (rt.findBot(value)) value = `${base} ${index++}`
    return value
  }
  const importRole = async (roleId, signal, selected) => {
    const persona = selected ?? (await catalog(signal)).find(item => item.id === roleId)
    if (!persona) refuse('The selected Rabi persona is no longer available. Refresh the list.')
    let bot = imported(roleId)
    if (!bot) {
      bot = await rt.createBot({ name: uniqueName(persona.name), role: 'Rabi', pickModel: true })
      // Saved before the first remote write so retries and restarts reuse this exact Bot.
      bot.rabiPersona = { roleId }
      await rt.save()
    }
    if (bot.rabiPersona.enabled === false) {
      bot.rabiPersona.enabled = true
      await rt.save()
    }
    await bind(bot.id, roleId, signal)
    const currentId = bot.sessionId ?? bot.id
    if (currentId !== bot.id) await bind(currentId, roleId, signal)
    return { botId: bot.id, roleId, linked: true }
  }
  const importOnce = async (roleId, signal, selected) => {
    if (pending.has(roleId)) return pending.get(roleId)
    const task = importRole(roleId, signal, selected)
    pending.set(roleId, task)
    try { return await task } finally { pending.delete(roleId) }
  }
  rt.rabiPersonaEndpoint = async (endpoint, body = {}, callerSignal) => {
    await rt.load()
    if (endpoint === 'rabi-connection-status') return { available: client.available() }
    const signal = signalOf(callerSignal)
    if (endpoint === 'rabi-personas-list') {
      const personas = await catalog(signal)
      const result = await client.json('/api/codex-hook/sessions', 'GET', undefined, signal)
      if (!Array.isArray(result.data?.sessions)) refuse('Rabi returned an invalid binding list')
      const bindings = new Map(result.data.sessions.map(item => [item.sessionId, item.roleId]))
      return { available: true, connected: true, personas: personas.map(persona => {
        const bot = imported(persona.id)
        return { ...persona, ...(bot ? { botId: bot.id, botName: bot.name, linked: bindings.get(bot.id) === persona.id } : {}) }
      }) }
    }
    if (endpoint === 'rabi-persona-import') {
      segment(body.roleId)
      return importOnce(body.roleId, signal)
    }
    if (endpoint === 'rabi-personas-import-all') {
      const personas = await catalog(signal)
      const results = []
      for (const persona of personas) {
        signal.throwIfAborted()
        try { results.push({ ...await importOnce(persona.id, signal, persona), name: persona.name, ok: true }) }
        catch (error) {
          signal.throwIfAborted()
          results.push({ roleId: persona.id, name: persona.name, ok: false, error: error.message })
        }
      }
      return { results }
    }
    if (endpoint === 'rabi-persona-unlink') {
      const bot = rt.botOf(body.botId)
      if (!bot?.rabiPersona) refuse('This Bot has no Rabi persona link')
      if (rt.workView()[bot.id]) refuse('Wait until this Bot is idle before unlinking its Rabi persona')
      const roleId = bot.rabiPersona.roleId
      const sessions = new Set([bot.id, bot.sessionId, ...(bot.segments ?? []).map(part => part.sessionId)].filter(Boolean))
      for (const room of Object.values(state.rooms)) {
        if (room.sessions?.[bot.id]) sessions.add(room.sessions[bot.id])
        for (const part of room.segments?.[bot.id] ?? []) sessions.add(part.sessionId)
      }
      for (const id of sessions) {
        const current = await binding(id, signal)
        if (!current) continue
        if (current.roleId !== roleId) refuse('This session is linked to another Rabi persona. Check its binding in Rabi first.')
        await client.json(pathOf(id), 'DELETE', undefined, signal)
        if (await binding(id, signal)) refuse('Rabi persona unlink was not confirmed. Check the original Bot before retrying.')
      }
      bot.rabiPersona.enabled = false
      await rt.save()
      for (const id of sessions) contexts.delete(id)
      return { botId: bot.id, linked: false }
    }
    refuse('Unknown Rabi connection operation')
  }
  ctx.effect(() => ctx.systemPrompt.context({
    name: 'ds-bot:rabi-persona', order: 630, interpolate: false, required: true,
    text: ({ agent }) => {
      const bot = rt.botOf(rt.selfOf(agent?.id))
      const entry = contexts.get(agent?.id)
      return bot?.rabiPersona?.enabled !== false && entry?.roleId === bot?.rabiPersona?.roleId ? entry?.text ?? '' : ''
    },
  }), 'ds-bot: Rabi persona context')
  ctx.on('system-prompt/assemble', async (assembly, payload, next) => {
    await rt.load()
    const bot = rt.botOf(rt.selfOf(payload.agent?.id))
    if (!bot?.rabiPersona || bot.rabiPersona.enabled === false) return next()
    contexts.delete(payload.agent.id)
    const signal = signalOf(payload.signal)
    const roleId = bot.rabiPersona.roleId
    if ((await binding(bot.id, signal))?.roleId !== roleId) refuse('Rabi persona binding changed. Check the Bot in Rabi connection before continuing.')
    if (payload.agent.id !== bot.id) await bind(payload.agent.id, roleId, signal)
    const receipt = await client.request(`/api/roles/${segment(roleId)}/persona-document`, 'GET', undefined, signal)
    if (typeof receipt.body !== 'string' || !receipt.body.trim()) refuse('The Rabi persona document is empty')
    if (Buffer.byteLength(receipt.body) > maxBytes) refuse('The Rabi persona document exceeds rabiPersonaMaxBytes')
    const text = `Rabi persona: ${roleId}\n\n${receipt.body}`
    const contribution = assembly.contexts.find(entry => entry.name === 'ds-bot:rabi-persona')
    if (!contribution) refuse('Rabi persona context is unavailable. Reload DSH before continuing.')
    contribution.text = text
    contexts.set(payload.agent.id, { roleId, text })
    return next()
  }, { prepend: true })
  ctx.on('session/event', (session, event) => { if (event.type === 'turn/end') contexts.delete(session.id) })
  ctx.effect(() => () => { shutdown.abort(); contexts.clear() }, 'ds-bot: Rabi connection lifetime')
}
