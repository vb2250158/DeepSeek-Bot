import { rabiClient, rabiRefuse as refuse, rabiSegment as segment } from './rabi-client.js'
import { splitRef } from './text.js'

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
  const rebuilding = new Map()
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
  // The roster renders a Bot under its Session id, which is not a key in the
  // Bot table. Both the avatar route and the bound Bot resolve to the same
  // persona id, so read the image by roleId and keep the Bot path as a check.
  const roleAvatar = async (roleId, signal) => {
    const image = await client.json(`/api/roles/${segment(roleId)}/avatar`, 'GET', undefined, signal)
    if (!/^image\/(png|jpeg|webp|gif)$/.test(image.contentType) || typeof image.contentBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.contentBase64)) refuse('Rabi returned an invalid avatar')
    const bytes = Buffer.from(image.contentBase64, 'base64')
    if (bytes.length > 5 * 1024 * 1024) refuse('Rabi avatar exceeds the image size limit')
    return { bytes, contentType: image.contentType }
  }
  rt.rabiRoleAvatar = async (roleId, callerSignal) => {
    await rt.load()
    return roleAvatar(roleId, signalOf(callerSignal))
  }
  rt.rabiAvatar = async (botId, callerSignal) => {
    await rt.load()
    const signal = signalOf(callerSignal)
    const { roleId } = await linkedBot(botId, signal)
    return roleAvatar(roleId, signal)
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
      bot = await rt.createBot({ name: uniqueName(persona.name), role: '', pickModel: true, agentPreset: 'rabi-assistant' })
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
  const scheduleOperations = new Map()
  const validSchedule = schedule => schedule && ['interval', 'daily_time', 'once_at'].includes(schedule.type)
    && (schedule.type !== 'interval' || Number.isFinite(schedule.intervalSeconds) && schedule.intervalSeconds > 0)
    && (schedule.type !== 'daily_time' || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule.timeOfDay ?? ''))
    && (schedule.type !== 'once_at' || typeof schedule.onceAt === 'string' && Number.isFinite(Date.parse(schedule.onceAt)))
  const configuration = async (roleId, base, signal) => {
    const { data } = await client.json(`${base}/configuration`, 'GET', undefined, signal)
    if (data?.roleId !== roleId || !data.config || !Array.isArray(data.config.automationRules)) refuse('Rabi returned an invalid automation list')
    return data
  }
  const scheduleView = (roleId, data) => {
    const items = [], warnings = [], ids = new Set()
    for (const [index, rule] of data.config.automationRules.entries()) {
      if (rule?.trigger?.type !== 'schedule') continue
      const schedule = rule.trigger.schedule
      if (typeof rule.id !== 'string' || !rule.id || ids.has(rule.id) || !validSchedule(schedule)) { warnings.push(index); continue }
      ids.add(rule.id)
      const enabled = rule.enabled !== false && schedule.enabled !== false
      items.push({ id: rule.id, source: 'rabi', title: typeof rule.name === 'string' && rule.name ? rule.name : rule.id,
        status: enabled ? 'active' : 'paused', enabled, kind: 'rabi', actionType: rule.action?.type,
        message: typeof rule.action?.message === 'string' ? rule.action.message : '', template: typeof rule.action?.template === 'string' ? rule.action.template : '', editable: ['deliver_agent', 'run_script'].includes(rule.action?.type),
        schedule: { type: schedule.type, intervalSeconds: schedule.intervalSeconds, timeOfDay: schedule.timeOfDay,
          onceAt: schedule.onceAt, windowStartTime: schedule.windowStartTime, windowEndTime: schedule.windowEndTime } })
    }
    return { roleId, revision: data.revision, items, warnings, nextCursor: null }
  }
  const invalidScheduleInput = message => refuse(message, 'bot/rabi-validation')
  const changeSchedule = async (endpoint, body, signal) => {
    const { roleId, base } = await linkedBot(body.botId, signal)
    if (typeof body.expectedRoleId !== 'string' || body.expectedRoleId !== roleId) refuse('The Bot persona changed. Refresh Rabi schedules before continuing.', 'bot/rabi-binding-conflict')
    if (typeof body.operationId !== 'string' || !/^[A-Za-z0-9:._-]{1,128}$/.test(body.operationId)) invalidScheduleInput('A stable Rabi operationId is required')
    if (typeof body.revision !== 'string' || !body.revision) invalidScheduleInput('Refresh Rabi schedules before saving')
    const signature = JSON.stringify({ endpoint, roleId, body })
    let operation = scheduleOperations.get(body.operationId)
    if (operation && operation.signature !== signature) refuse('Keep the original Rabi operation and payload while checking its result')
    if (!operation) {
      const data = await configuration(roleId, base, signal)
      if (data.revision !== body.revision) refuse('Rabi schedules changed. Refresh before saving.', 'bot/rabi-revision-conflict')
      const rules = data.config.automationRules.slice()
      const matches = body.id === undefined ? [] : rules.map((rule, index) => rule?.id === body.id ? index : -1).filter(index => index >= 0)
      if (body.id !== undefined && (typeof body.id !== 'string' || matches.length !== 1 || rules[matches[0]]?.trigger?.type !== 'schedule')) invalidScheduleInput('The Rabi scheduled rule is missing or ambiguous. Refresh the list.')
      if (endpoint === 'rabi-schedule-delete') {
        if (body.id === undefined) invalidScheduleInput('Select a Rabi scheduled rule to delete')
        rules.splice(matches[0], 1)
      } else if (endpoint === 'rabi-schedule-toggle') {
        if (body.id === undefined || typeof body.enabled !== 'boolean') invalidScheduleInput('Select a Rabi scheduled rule and enabled state')
        const previous = rules[matches[0]]
        rules[matches[0]] = { ...previous, enabled: body.enabled, trigger: { ...previous.trigger, schedule: { ...previous.trigger.schedule, enabled: body.enabled } } }
      } else {
        if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 120 || typeof body.enabled !== 'boolean' || !validSchedule(body.schedule)) invalidScheduleInput('Provide a title, enabled state and valid Rabi schedule')
        const previous = matches.length ? rules[matches[0]] : undefined
        if (previous && !['deliver_agent', 'run_script'].includes(previous.action?.type)) invalidScheduleInput('Edit this action type in Rabi')
        if ((!previous || previous.action.type === 'deliver_agent') && (typeof body.message !== 'string' || !body.message.trim())) invalidScheduleInput('Provide the scheduled message')
        if ((!previous || previous.action.type === 'deliver_agent') && Object.hasOwn(body, 'template') && typeof body.template !== 'string') invalidScheduleInput('Provide a text instructions template')
        const id = previous?.id ?? `ds-bot-${body.operationId}`
        if (!previous && rules.some(rule => rule?.id === id)) invalidScheduleInput('This schedule ID already exists. Refresh the list.')
        const recipients = data.personaConfig?.agentRecipients ?? data.config.agentRecipients
        if (!previous && Array.isArray(recipients) && !recipients.some(item => item?.id === 'primary')) invalidScheduleInput('Configure the primary Agent recipient in Rabi before creating a schedule')
        const timing = { ...previous?.trigger?.schedule, type: body.schedule.type }
        for (const key of ['intervalSeconds', 'timeOfDay', 'onceAt']) delete timing[key]
        const timingKey = { interval: 'intervalSeconds', daily_time: 'timeOfDay', once_at: 'onceAt' }[body.schedule.type]
        timing[timingKey] = body.schedule[timingKey]
        if (Object.hasOwn(body.schedule, 'windowStartTime') || Object.hasOwn(body.schedule, 'windowEndTime')) {
          const start = body.schedule.windowStartTime, end = body.schedule.windowEndTime
          if (start === '' && end === '') {
            delete timing.windowStartTime; delete timing.windowEndTime
          } else {
            const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
            if (!validTime(start) || !validTime(end)) invalidScheduleInput('Provide both Rabi schedule window times as HH:mm, or clear both')
            timing.windowStartTime = start; timing.windowEndTime = end
          }
        }
        const rule = { ...previous, id, name: body.title.trim(), enabled: body.enabled,
          trigger: { ...previous?.trigger, type: 'schedule', schedule: { id: previous?.trigger?.schedule?.id ?? id, ...timing, enabled: body.enabled } },
          action: previous ? { ...previous.action, ...(previous.action.type === 'deliver_agent' ? { message: body.message, ...(Object.hasOwn(body, 'template') ? { template: body.template } : {}) } : {}) }
            : { type: 'deliver_agent', target: { kind: 'recipient', recipientId: 'primary' }, message: body.message, ...(Object.hasOwn(body, 'template') ? { template: body.template } : {}) } }
        if (previous) rules[matches[0]] = rule
        else rules.push(rule)
      }
      operation = { signature, payload: { expectedRevision: body.revision, config: { automationRules: rules } } }
      // Retain the exact CAS payload across an uncertain response; never rebuild it from newer configuration.
      scheduleOperations.set(body.operationId, operation)
    }
    await client.json(`${base}/configuration`, 'PATCH', operation.payload, signal, { 'Idempotency-Key': body.operationId })
    try { return scheduleView(roleId, await configuration(roleId, base, signal)) }
    catch (error) { refuse(`Rabi accepted the schedule operation but its readback failed. Keep operation ${body.operationId} and refresh: ${error.message}`, 'bot/rabi-readback-failed') }
  }
  rt.rabiPersonaEndpoint = async (endpoint, body = {}, callerSignal) => {
    await rt.load()
    if (endpoint === 'rabi-connection-status') return { available: client.available(), hooksReady: Boolean(hooks()?.requireBinding) }
    const signal = signalOf(callerSignal)
    if (['rabi-schedule-save', 'rabi-schedule-delete', 'rabi-schedule-toggle'].includes(endpoint)) return changeSchedule(endpoint, body, signal)
    if (endpoint === 'rabi-bot-view') {
      const { roleId, base } = await linkedBot(body.botId, signal)
      if (body.resource === 'schedules') return scheduleView(roleId, await configuration(roleId, base, signal))
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
    if (endpoint === 'rabi-persona-rebuild') {
      const bot = rt.botOf(body.botId)
      if (!roleOf(bot)) refuse('This Bot has no Rabi persona link')
      if (rebuilding.has(bot.id)) return rebuilding.get(bot.id)
      const task = rebuild(bot, body.expectedSessionId, signal)
      rebuilding.set(bot.id, task)
      try { return await task } finally { rebuilding.delete(bot.id) }
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
  async function rebuild(bot, expectedSessionId, signal) {
    const roleId = roleOf(bot)
    const current = bot.sessionId ?? bot.id
    let change = bot.rabiPersona.rebuild
    if (!change && current !== expectedSessionId) refuse('The Bot conversation changed. Refresh before rebuilding.')
    if (rt.workView()[bot.id]) refuse('Wait until this Bot is idle before rebuilding its conversation')
    const agent = await rt.resolveAgent(current)
    if (agent.inbox.nextStep.length || agent.inbox.nextTurn.length || state.questions?.[current] || state.views?.[current]) refuse('Resolve pending Bot input before rebuilding its conversation')
    await linkedBot(bot.id, signal)
    if (!change) {
      const freshId = await rt.createSession(bot.name, { dir: bot.workDir, agentPreset: 'rabi-assistant' })
      change = { previous: current, sessionId: freshId }
      bot.rabiPersona.rebuild = change
      await rt.save()
    }
    if ((bot.sessionId ?? bot.id) !== change.sessionId) {
      await bind(change.sessionId, roleId, signal)
      const ref = bot.model ?? bot.appliedModel
      if (ref) {
        await rt.selectSessionModel(change.sessionId, { ...splitRef(ref), reasoningEffort: bot.effort ?? bot.appliedEffort })
      }
      await rt.applyPermission(bot, change.sessionId)
      await rt.moveSchedules?.(change.previous, change.sessionId)
      ;(bot.segments ??= []).push({ sessionId: change.previous, endedAt: Date.now() })
      bot.sessionId = change.sessionId
      await rt.save()
    }
    await ctx.workspaceRegistry.archiveSession(change.previous, { stopActivity: true })
    delete bot.rabiPersona.rebuild
    await rt.save()
    return { botId: bot.id, previousSessionId: change.previous, sessionId: change.sessionId, agentPreset: 'rabi-assistant', archived: true }
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
    // Older DSH assemblies include schemas; current presentations contain text only.
    if (assembly.tools !== undefined) assembly.tools = assembly.tools.filter(tool => !['remember', 'forget', 'recall'].includes(tool.name))
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
