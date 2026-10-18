import { rabiClient, rabiRefuse as refuse, rabiSegment as segment } from './rabi-client.js'

/** Rabi owns persona documents and bindings; Bots keep only the imported persona reference. */
export function install(rt) {
  const { ctx, state } = rt
  const timeout = rt.config.rabiRequestTimeoutMs ?? 45000
  const maxBytes = rt.config.rabiPersonaMaxBytes ?? 262144
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 120000) throw new TypeError('rabiRequestTimeoutMs must be 1000-120000')
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 2097152) throw new TypeError('rabiPersonaMaxBytes must be 1024-2097152')
  const client = rabiClient(ctx, timeout)
  const shutdown = new AbortController()
  const requirements = new Map()
  const hooks = () => ctx.get?.('rabiAgentHooks')
  const requireHooks = () => {
    const service = hooks()
    if (!service?.requireBinding) refuse('Update dsh-rabiroute-agent and enable Rabi Agent Hooks before binding a Bot')
    return service
  }
  const roleOf = bot => bot?.rabiPersona && bot.rabiPersona.enabled !== false ? bot.rabiPersona.roleId : undefined
  rt.rabiRoleOf = roleOf
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
  const linkedBot = async (botId, signal) => {
    const bot = rt.botOf(botId)
    const roleId = roleOf(bot)
    if (!roleId) refuse('This Bot has no Rabi persona link')
    if ((await binding(bot.id, signal))?.roleId !== roleId) refuse('Rabi persona binding changed. Check the Bot in Rabi connection before continuing.')
    return { bot, roleId, base: `/api/roles/${segment(roleId)}` }
  }
  rt.rabiAvatar = async (botId, callerSignal) => {
    await rt.load()
    const signal = signalOf(callerSignal)
    const { base } = await linkedBot(botId, signal)
    const image = await client.json(`${base}/avatar`, 'GET', undefined, signal)
    if (!/^image\/(png|jpeg|webp|gif)$/.test(image.contentType) || typeof image.contentBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.contentBase64)) refuse('Rabi returned an invalid avatar')
    const bytes = Buffer.from(image.contentBase64, 'base64')
    if (bytes.length > 5 * 1024 * 1024) refuse('Rabi avatar exceeds the image size limit')
    return { bytes, contentType: image.contentType }
  }
  const imported = roleId => Object.values(state.bots).find(bot => bot.rabiPersona?.roleId === roleId)
  const uniqueName = name => {
    const base = name.trim().slice(0, 34)
    let value = base, index = 2
    while (rt.findBot(value)) value = `${base} ${index++}`
    return value
  }
  const importRole = async (roleId, signal, selected) => {
    requireHooks()
    const persona = selected ?? (await catalog(signal)).find(item => item.id === roleId)
    if (!persona) refuse('The selected Rabi persona is no longer available. Refresh the list.')
    let bot = imported(roleId)
    if (!bot) {
      bot = await rt.createBot({ name: uniqueName(persona.name), role: '', pickModel: true })
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
    if (endpoint === 'rabi-connection-status') return { available: client.available(), hooksReady: Boolean(hooks()?.requireBinding) }
    const signal = signalOf(callerSignal)
    if (endpoint === 'rabi-bot-view') {
      const { roleId, base } = await linkedBot(body.botId, signal)
      const resources = { plans: 'plans', memory: 'memory', skills: 'skills', persona: 'persona-document' }
      const resource = Object.hasOwn(resources, body.resource) ? resources[body.resource] : undefined
      if (!resource) refuse('Unknown Rabi resource')
      if (resource === 'persona-document') {
        const value = await client.json(`${base}/${resource}`, 'GET', undefined, signal)
        if (typeof value.text !== 'string' || Buffer.byteLength(value.text) > maxBytes) refuse('The Rabi persona document exceeds rabiPersonaMaxBytes')
        return { roleId, text: value.text, items: [] }
      }
      const kind = body.kind ?? 'recent'
      if (!['recent', 'consolidated', 'archived'].includes(kind)) refuse('Unknown Rabi memory kind')
      let path = `${base}/${resource}`
      if (body.itemId) path += `/${resource === 'memory' ? `${kind}/` : ''}${segment(body.itemId)}`
      else if (resource !== 'skills') {
        const query = new URLSearchParams({ limit: '20', ...(resource === 'memory' ? { kind } : { view: 'current', detail: 'summary' }) })
        if (body.cursor) query.set('cursor', body.cursor)
        path += `?${query}`
      }
      const value = await client.json(path, 'GET', undefined, signal)
      if (body.itemId) {
        const item = value.data
        if (!item || typeof item !== 'object' || Array.isArray(item)) refuse('Rabi returned an invalid resource')
        const text = key => typeof item[key] === 'string' ? item[key] : undefined
        return { roleId, detail: { title: text('title'), content: text('content'), description: text('description'), text: text('text'),
          ...(Array.isArray(item.steps) ? { steps: item.steps.map(step => ({ id: step.id, title: step.title, description: step.description, content: step.content, status: step.status })) } : {}) } }
      }
      const items = Array.isArray(value.data) ? value.data : value.data?.items
      if (!Array.isArray(items)) refuse('Rabi returned an invalid resource list')
      return { roleId, items: items.map(item => {
        segment(item.id)
        return { id: item.id, title: typeof item.title === 'string' ? item.title : item.id, summary: typeof item.summary === 'string' ? item.summary : undefined, status: typeof item.presentation?.label === 'string' ? item.presentation.label : typeof item.status === 'string' ? item.status : undefined }
      }), nextCursor: value.data?.nextCursor ?? null, total: value.data?.total ?? items.length }
    }
    if (endpoint === 'rabi-personas-list') {
      const personas = await catalog(signal)
      const result = await client.json('/api/codex-hook/sessions', 'GET', undefined, signal)
      if (!Array.isArray(result.data?.sessions)) refuse('Rabi returned an invalid binding list')
      const bindings = new Map(result.data.sessions.map(item => [item.sessionId, item.roleId]))
      return { available: true, connected: true, hooksReady: Boolean(hooks()?.requireBinding), personas: personas.map(persona => {
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
      for (const id of sessions) { requirements.get(id)?.dispose(); requirements.delete(id) }
      return { botId: bot.id, linked: false }
    }
    refuse('Unknown Rabi connection operation')
  }
  ctx.effect(() => ctx.systemPrompt.context({
    name: 'ds-bot:rabi-persona', order: 630, interpolate: false, required: true,
    text: ({ agent }) => {
      const bot = rt.botOf(rt.selfOf(agent?.id))
      if (!bot?.rabiPersona) return ''
      if (!roleOf(bot)) return 'Rabi persona binding was removed. Earlier Rabi persona, memory, plan and skill instructions no longer apply. Use the ordinary Bot instructions.'
      return 'Rabi persona binding: ' + bot.rabiPersona.roleId + '. Rabi Agent Hooks provide this role’s persona, memories, plans and skills. Rabi owns their reads and changes; use rabiroute_manager_api and discover the current contract with GET /api/agent/help. Do not create a separate DS Bot memory or copy Rabi plans into local tasks.'
    },
  }), 'ds-bot: Rabi persona context')
  ctx.on('system-prompt/assemble', async (assembly, payload, next) => {
    await rt.load()
    const bot = rt.botOf(rt.selfOf(payload.agent?.id))
    const roleId = roleOf(bot)
    if (!roleId) return next()
    const service = requireHooks()
    assembly.tools = assembly.tools.filter(tool => !['remember', 'forget', 'recall'].includes(tool.name))
    const signal = signalOf(payload.signal)
    if ((await binding(bot.id, signal))?.roleId !== roleId) refuse('Rabi persona binding changed. Check the Bot in Rabi connection before continuing.')
    const id = payload.agent.id
    if (id !== bot.id) await bind(id, roleId, signal)
    const prior = requirements.get(id)
    if (prior?.service !== service || prior?.roleId !== roleId) {
      prior?.dispose()
      requirements.set(id, { service, roleId, dispose: service.requireBinding(id, roleId) })
    }
    return next()
  }, { prepend: true })
  ctx.effect(() => () => { shutdown.abort(); for (const entry of requirements.values()) entry.dispose(); requirements.clear() }, 'ds-bot: Rabi connection lifetime')
}
