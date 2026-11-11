import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { install } from '../src/host/rabi-personas.js'
import { fakeContext } from './fake-ctx.js'

function fixture({ state = { bots: {}, rooms: {} }, installed = true, config = {}, bindings = new Map(), personas = [{ personaId: 'fixture', name: 'Fixture', routes: [{ token: 'private' }] }] } = {}) {
  const requirements = new Map()
  const hooks = { requireBinding(id, roleId) { requirements.set(id, roleId); return () => requirements.delete(id) } }
  const ctx = fakeContext({ services: { rabiAgentHooks: hooks } })
  const responses = new Map()
  const requests = []
  const created = []
  const saves = []
  let document = '# Fixture persona\n\nBe concise and answer from evidence.'
  let failure
  ctx.tools.get = () => installed ? {} : undefined
  ctx.tools.execute = async input => {
    requests.push(input.arguments)
    input.signal.throwIfAborted()
    const { path, method } = input.arguments
    if (path.startsWith('/api/agent/providers/dsh/ds-bot-destination?')) return { isError: false, value: { ok: true, body: JSON.stringify({ data: { target: { kind: 'ds_bot', agentAdapter: 'dsh', agentTargetId: 'local:dsh', dshBaseUrl: 'http://127.0.0.1:6328', botScopeId: 'scope', botId: 'bot', botName: 'Bot' } } }) } }
    if (path.startsWith('/api/automation/ds-bot-rules?')) {
      const items = []
      for (const [key, response] of responses) {
        if (!key.endsWith('/configuration')) continue
        const roleId = response.data?.roleId
        for (const rule of response.data?.config?.automationRules ?? []) if (rule?.trigger?.type === 'schedule') items.push({ id: Buffer.from(JSON.stringify([roleId, rule.id])).toString('base64url'), sourceRoleId: roleId, rawRuleId: rule.id, rule })
      }
      return { isError: false, value: { ok: true, body: JSON.stringify({ data: { botScopeId: 'scope', botId: 'bot', revision: 'catalog', items, warnings: [], nextCursor: null } }) } }
    }
    if (failure?.(input.arguments)) return { isError: false, value: { ok: false, uncertain: method !== 'GET', statusCode: 0, body: '{}' } }
    if (responses.has(path)) return { isError: false, value: { ok: true, statusCode: 200, body: JSON.stringify(responses.get(path)) } }
    let body
    if (path === '/api/personas') body = { code: 0, personas }
    else if (path === '/api/codex-hook/sessions') body = { code: 0, data: { sessions: [...bindings].map(([sessionId, roleId]) => ({ sessionId, roleId })) } }
    else if (path.endsWith('/persona-document')) return { isError: false, value: { ok: true, statusCode: 200, body: JSON.stringify({ text: document }) } }
    else {
      const sessionId = decodeURIComponent(path.split('/').at(-1))
      if (method === 'PUT') {
        assert.ok(Object.values(state.bots).some(bot => bot.rabiPersona?.roleId === JSON.parse(input.arguments.bodyJson).roleId), 'save import reference before remote mutation')
        bindings.set(sessionId, JSON.parse(input.arguments.bodyJson).roleId)
      }
      if (method === 'DELETE') bindings.delete(sessionId)
      body = { code: 0, data: bindings.has(sessionId) ? { sessionId, roleId: bindings.get(sessionId) } : null }
    }
    return { isError: false, value: { ok: true, statusCode: 200, body: JSON.stringify(body) } }
  }
  const rt = {
    rabiAutomationIdentity: () => ({ botScopeId: 'scope', runtimeId: 'runtime' }),
    ctx, config, state, load: async () => {}, save: async () => { saves.push(JSON.parse(JSON.stringify(state))) },
    findBot: name => Object.values(state.bots).find(bot => bot.name === name), botOf: id => state.bots[id],
    selfOf: id => state.bots[id] ? id : Object.values(state.bots).find(bot => bot.sessionId === id)?.id ?? Object.values(state.rooms).find(room => Object.values(room.sessions ?? {}).includes(id))?.members?.[0],
    workView: () => ({}),
    createBot: async args => {
      created.push(args)
      const id = `bot-${created.length}`
      return state.bots[id] = { id, ...args, instructions: '' }
    },
  }
  install(rt)
  const call = (endpoint, body, signal) => rt.rabiPersonaEndpoint(endpoint, body, signal)
  const assemble = id => {
    const payload = { agent: { id }, signal: new AbortController().signal }
    const assembly = { contexts: [...ctx.contexts.values()].map(entry => ({ name: entry.name, text: entry.text(payload) })), tools: [{ name: 'remember' }, { name: 'rabiroute_manager_api' }] }
    return ctx.listeners.get('system-prompt/assemble')[0](assembly, payload, async () => assembly)
  }
  const step = async id => { await assemble(id); return { kind: 'enter' } }
  const context = id => ctx.contexts.get('ds-bot:rabi-persona').text({ agent: { id } })
  return { rt, ctx, hooks, requirements, responses, call, step, assemble, context, requests, created, saves, bindings, setDocument: value => { document = value }, fail: fn => { failure = fn } }
}

test('activation and local connection status never discover Manager or read persona files', async () => {
  const f = fixture({ installed: false })
  assert.equal(f.requests.length, 0)
  assert.deepEqual(await f.call('rabi-connection-status'), { available: false, hooksReady: true })
  await assert.rejects(f.call('rabi-personas-list'), /Install and configure/)
  assert.equal(f.requests.length, 0)
})

test('scheduled rules use the verified destination without exposing execution paths or changing persona binding', async () => {
  const f = fixture({ state: { bots: { bot: { id: 'bot', rabiPersona: { roleId: 'fixture' } } }, rooms: {} }, bindings: new Map([['bot', 'fixture']]) })
  const rule = (id, schedule, extra = {}) => ({ id, name: id, enabled: true, trigger: { type: 'schedule', schedule }, action: { target: { kind: 'ds_bot', agentAdapter: 'dsh', agentTargetId: 'local:dsh', dshBaseUrl: 'http://127.0.0.1:6328', botScopeId: 'scope', botId: 'bot' }, message: 'private prompt', scriptPath: 'private path' }, ...extra })
  f.responses.set('/api/roles/fixture/configuration', { data: { roleId: 'fixture', config: { automationRules: [
    rule('daily', { type: 'daily_time', timeOfDay: '09:00' }),
    rule('held', { type: 'interval', intervalSeconds: 600, enabled: false }),
    rule('disabled', { type: 'once_at', onceAt: '2030-01-01T09:00:00' }, { enabled: false }),
    rule('broken', { type: 'daily_time', timeOfDay: '99:00' }),
    { id: 'message', trigger: { type: 'message' } },
  ] } } })
  const view = await f.call('rabi-bot-view', { botId: 'bot', resource: 'schedules' })
  assert.deepEqual(view.items.map(item => [item.rawRuleId, item.source, item.status]), [['daily', 'rabi', 'active'], ['held', 'rabi', 'paused'], ['disabled', 'rabi', 'paused']])
  assert.equal(view.warnings.length, 1)
  assert.equal(view.items[0].message, 'private prompt')
  assert.equal(JSON.stringify(view).includes('private path'), false)
  assert.ok(f.requests.every(request => request.method === 'GET'))
  f.bindings.set('bot', 'another')
  assert.equal((await f.call('rabi-bot-view', { botId: 'bot', resource: 'schedules' })).items.length, 3)
})

test('missing or mismatched Rabi schedule configuration is an error instead of an empty task list', async () => {
  const f = fixture({ state: { bots: { bot: { id: 'bot', rabiPersona: { roleId: 'fixture' } } }, rooms: {} }, bindings: new Map([['bot', 'fixture']]) })
  for (const data of [{ roleId: 'another', config: { automationRules: [] } }, { roleId: 'fixture', config: {} }]) {
    f.responses.set('/api/roles/fixture/configuration', { data })
    await assert.rejects(f.call('rabi-schedule-read', { botId: 'bot', sourceRoleId: 'fixture' }), /invalid automation list/)
  }
})

test('persona catalog returns only names and verified Bot links', async () => {
  const f = fixture()
  assert.deepEqual((await f.call('rabi-personas-list')).personas, [{ id: 'fixture', name: 'Fixture' }])
  assert.ok(!JSON.stringify(await f.call('rabi-personas-list')).includes('private'))
})

test('ordinary Bots keep their existing behavior without contacting Rabi', async () => {
  const f = fixture({ state: { bots: { ordinary: { id: 'ordinary', name: 'Ordinary' } }, rooms: {} } })
  assert.deepEqual(await f.step('ordinary'), { kind: 'enter' })
  assert.equal(f.context('ordinary'), '')
  assert.equal(f.requests.length, 0)
})

test('importing a persona leaves its work title for actual responsibilities instead of naming its provider', async () => {
  const f = fixture()
  await f.call('rabi-persona-import', { roleId: 'fixture' })
  assert.equal(f.created[0].role, '')
  assert.equal(f.created[0].agentPreset, 'rabi-assistant')
})

test('an invalid binding read cannot be mistaken for an unbound session and overwritten', async () => {
  const f = fixture()
  const execute = f.ctx.tools.execute
  f.ctx.tools.execute = input => input.arguments.path.startsWith('/api/codex-hook/sessions/')
    ? Promise.resolve({ isError: false, value: { ok: true, body: JSON.stringify({ code: 0, data: {} }) } }) : execute(input)
  await assert.rejects(f.call('rabi-persona-import', { roleId: 'fixture' }), /invalid session binding/)
  assert.equal(f.created.length, 1)
  assert.equal(f.requests.filter(req => req.method === 'PUT').length, 0)
})

test('concurrent import saves one Bot before binding and leaves model choice to the user', async () => {
  const f = fixture()
  const [first, second] = await Promise.all([f.call('rabi-persona-import', { roleId: 'fixture' }), f.call('rabi-persona-import', { roleId: 'fixture' })])
  assert.deepEqual(first, second)
  assert.equal(f.created.length, 1)
  assert.equal(f.created[0].pickModel, true)
  assert.equal(f.saves[0].bots['bot-1'].rabiPersona.roleId, 'fixture')
  assert.equal(f.requests.filter(req => req.method === 'PUT').length, 1)
  assert.equal(f.rt.state.bots['bot-1'].instructions, '')
  assert.equal((await f.call('rabi-personas-list')).personas[0].linked, true)
})

test('uncertain binding is not replayed; another import resumes the same saved Bot', async () => {
  const f = fixture()
  f.fail(req => req.method === 'PUT')
  await assert.rejects(f.call('rabi-persona-import', { roleId: 'fixture' }), /outcome is uncertain/)
  assert.equal(f.requests.filter(req => req.method === 'PUT').length, 1)
  // The remote write did commit; only its response was lost.
  f.bindings.set('bot-1', 'fixture')
  f.fail(undefined)
  assert.equal((await f.call('rabi-persona-import', { roleId: 'fixture' })).botId, 'bot-1')
  assert.equal(f.created.length, 1)
  assert.equal(f.requests.filter(req => req.method === 'PUT').length, 1)
})

test('a restart reuses the durable import reference and rejects conflicting remote bindings', async () => {
  const state = { bots: { existing: { id: 'existing', name: 'Fixture', rabiPersona: { roleId: 'fixture' } } }, rooms: {} }
  const f = fixture({ state, bindings: new Map([['existing', 'another-persona']]) })
  await assert.rejects(f.call('rabi-persona-import', { roleId: 'fixture' }), /another Rabi persona/)
  assert.equal(f.created.length, 0)
  assert.equal(f.requests.filter(req => req.method === 'PUT').length, 0)
})

test('persona context follows the current source and links new group and conversation parts', async () => {
  const f = fixture()
  await f.call('rabi-persona-import', { roleId: 'fixture' })
  const assembly = await f.assemble('bot-1')
  assert.equal(assembly.contexts[0].text, f.context('bot-1'), 'the first assembly contains live persona text before model admission')
  assert.deepEqual(assembly.tools.map(tool => tool.name), ['rabiroute_manager_api'])
  assert.equal(f.context('bot-1'), readFileSync(new URL('./fixtures/rabi-persona-context.txt', import.meta.url), 'utf8').trimEnd())
  assert.equal(f.ctx.contexts.get('ds-bot:rabi-persona').required, true)
  f.setDocument('# Updated persona\n\nUse the revised identity.')
  f.rt.state.bots['bot-1'].sessionId = 'next-part'
  await f.step('next-part')
  assert.equal(f.bindings.get('next-part'), 'fixture')
  assert.equal(f.requirements.get('next-part'), 'fixture')
  f.rt.state.rooms.room = { members: ['bot-1'], sessions: { 'bot-1': 'group-part' } }
  await f.step('group-part')
  assert.equal(f.bindings.get('group-part'), 'fixture')
  assert.equal(f.requirements.get('group-part'), 'fixture')
})

test('a failed refresh cannot reuse a stale persona and a removed source binding is respected', async () => {
  const f = fixture()
  await f.call('rabi-persona-import', { roleId: 'fixture' })
  await f.step('bot-1')
  f.fail(req => req.path.startsWith('/api/codex-hook/sessions/'))
  await assert.rejects(f.step('bot-1'), /Rabi HTTP/)
  f.fail(undefined)
  f.bindings.delete('bot-1')
  await assert.rejects(f.step('bot-1'), /binding changed/)
  assert.equal(f.requests.filter(req => req.method === 'PUT').length, 1)
})

test('unlink preserves the Bot and relinking never creates another one', async () => {
  const f = fixture()
  await f.call('rabi-persona-import', { roleId: 'fixture' })
  await f.step('bot-1')
  await f.call('rabi-persona-unlink', { botId: 'bot-1' })
  assert.equal(f.rt.state.bots['bot-1'].rabiPersona.enabled, false)
  assert.equal(f.bindings.size, 0)
  assert.match(f.context('bot-1'), /binding was removed/)
  assert.equal(f.requirements.size, 0)
  const count = f.requests.length
  await f.step('bot-1')
  assert.equal(f.requests.length, count)
  await f.call('rabi-persona-import', { roleId: 'fixture' })
  assert.equal(f.created.length, 1)
  assert.equal(f.bindings.get('bot-1'), 'fixture')
})

test('persona size, cancellation and invalid configuration stop before model admission', async () => {
  assert.throws(() => fixture({ config: { rabiRequestTimeoutMs: 0 } }), /rabiRequestTimeoutMs/)
  const f = fixture({ config: { rabiPersonaMaxBytes: 1024 } })
  await f.call('rabi-persona-import', { roleId: 'fixture' })
  f.setDocument('a'.repeat(1025))
  await assert.rejects(f.call('rabi-bot-view', { botId: 'bot-1', resource: 'persona' }), /rabiPersonaMaxBytes/)
  const abort = new AbortController()
  abort.abort(new Error('cancelled by caller'))
  await assert.rejects(f.call('rabi-personas-list', {}, abort.signal), /cancelled by caller/)
})

test('bulk import shares single imports, reads one catalog and reuses every Bot on retry', async () => {
  const f = fixture({ personas: [{ personaId: 'fixture', name: 'Fixture' }, { personaId: 'second', name: 'Second' }] })
  const first = await f.call('rabi-personas-import-all')
  assert.equal(first.results.length, 2)
  assert.ok(first.results.every(item => item.ok))
  assert.equal(f.requests.filter(req => req.path === '/api/personas').length, 1)
  assert.equal(f.created.length, 2)
  const [again, single] = await Promise.all([f.call('rabi-personas-import-all'), f.call('rabi-persona-import', { roleId: 'fixture' })])
  assert.equal(again.results[0].botId, single.botId)
  assert.equal(f.created.length, 2)
  assert.equal(f.requests.filter(req => req.method === 'PUT').length, 2)
})

test('bulk import reports a failed persona and continues without replaying its uncertain write', async () => {
  const f = fixture({ personas: [{ personaId: 'fixture', name: 'Fixture' }, { personaId: 'second', name: 'Second' }] })
  f.fail(req => req.method === 'PUT' && JSON.parse(req.bodyJson).roleId === 'fixture')
  const { results } = await f.call('rabi-personas-import-all')
  assert.equal(results[0].ok, false)
  assert.match(results[0].error, /outcome is uncertain/)
  assert.equal(results[1].ok, true)
  assert.equal(f.requests.filter(req => req.method === 'PUT').length, 2)
  assert.equal(f.created.length, 2)
})

test('cancelled bulk import stops before creating the next persona Bot', async () => {
  const f = fixture({ personas: [{ personaId: 'fixture', name: 'Fixture' }, { personaId: 'second', name: 'Second' }] })
  const controller = new AbortController()
  const execute = f.ctx.tools.execute
  f.ctx.tools.execute = async input => {
    const result = await execute(input)
    if (input.arguments.method === 'PUT') controller.abort(new Error('cancelled bulk import'))
    return result
  }
  await assert.rejects(f.call('rabi-personas-import-all', {}, controller.signal), /cancelled bulk import/)
  assert.equal(f.created.length, 1)
})

test('bound resources stay in Rabi, preserve pagination and omit local paths', async () => {
  const f=fixture();await f.call('rabi-persona-import',{roleId:'fixture'})
  f.responses.set('/api/roles/fixture/memory?limit=20&kind=recent',{code:0,data:{items:[{id:'m1',title:'Rabi memory',summary:'Summary',path:'private-local-path'}],nextCursor:'next/opaque',total:21}})
  const view=await f.call('rabi-bot-view',{botId:'bot-1',resource:'memory'})
  assert.equal(view.nextCursor,'next/opaque');assert.equal(view.total,21);assert.ok(!JSON.stringify(view).includes('private-local-path'))
  f.responses.set('/api/roles/fixture/skills',{code:0,data:[{id:'s1',title:'Skill',path:'private-skill-path'}]})
  assert.deepEqual((await f.call('rabi-bot-view',{botId:'bot-1',resource:'skills'})).items,[{id:'s1',title:'Skill',summary:undefined,status:undefined}])
  f.responses.set('/api/roles/fixture/memory/recent/m1',{code:0,data:{id:'m1',title:'Memory',content:'From Rabi',path:'private-local-path'}})
  assert.equal((await f.call('rabi-bot-view',{botId:'bot-1',resource:'memory',itemId:'m1'})).detail.content,'From Rabi')
  await assert.rejects(f.call('rabi-bot-view',{botId:'bot-1',resource:'__proto__'}),/Unknown Rabi resource/)
  f.bindings.delete('bot-1');await assert.rejects(f.call('rabi-bot-view',{botId:'bot-1',resource:'memory'}),/binding changed/)
})

test('avatar bytes come from the bound role and reject invalid image receipts', async () => {
  const f=fixture();await f.call('rabi-persona-import',{roleId:'fixture'})
  f.responses.set('/api/roles/fixture/avatar',{contentType:'image/png',contentBase64:Buffer.from('fixture-image').toString('base64')})
  const image=await f.rt.rabiAvatar('bot-1');assert.equal(image.bytes.toString(),'fixture-image');assert.equal(image.contentType,'image/png')
  assert.equal(f.rt.state.bots['bot-1'].avatar,undefined)
  f.responses.set('/api/roles/fixture/avatar',{contentType:'text/html',contentBase64:'aW1n'})
  await assert.rejects(f.rt.rabiAvatar('bot-1'),/invalid avatar/)
})

test('binding cannot create a partial Bot when full Rabi lifecycle support is missing', async () => {
  const f=fixture();f.ctx.get=()=>undefined
  await assert.rejects(f.call('rabi-persona-import',{roleId:'fixture'}),/Update dsh-rabiroute-agent/)
  assert.equal(f.created.length,0)
})

test('text-only prompt presentations retain Rabi binding checks', async () => {
  const f = fixture()
  await f.call('rabi-persona-import', { roleId: 'fixture' })
  const presentation = { sections: [], contexts: [], variables: {} }
  const result = await f.ctx.listeners.get('system-prompt/assemble')[0](presentation, { agent: { id: 'bot-1' }, signal: new AbortController().signal }, async () => presentation)
  assert.equal(result, presentation)
  assert.equal(f.requirements.get('bot-1'), 'fixture')
  assert.equal('tools' in presentation, false)
})

test('rebuild retains Bot identity and retries archiving without creating another conversation', async () => {
  const f = fixture()
  await f.call('rabi-persona-import', { roleId: 'fixture' })
  let created = 0, failArchive = true
  f.rt.resolveAgent = async () => ({ inbox: { nextStep: [], nextTurn: [] } })
  f.rt.createSession = async (name, options) => { assert.equal(options.agentPreset, 'rabi-assistant'); created++; return 'fresh' }
  f.rt.applyPermission = async () => {}
  f.ctx.workspaceRegistry = { archiveSession: async id => { assert.equal(id, 'bot-1'); if (failArchive) throw new Error('archive unavailable') } }
  const body = { botId: 'bot-1', expectedSessionId: 'bot-1' }
  await assert.rejects(f.call('rabi-persona-rebuild', body), /archive unavailable/)
  assert.equal(f.rt.state.bots['bot-1'].sessionId, 'fresh')
  assert.equal(f.bindings.get('fresh'), 'fixture')
  failArchive = false
  assert.equal((await f.call('rabi-persona-rebuild', body)).archived, true)
  assert.equal(created, 1)
  assert.equal(f.rt.state.bots['bot-1'].segments[0].sessionId, 'bot-1')
  assert.equal(f.rt.state.bots['bot-1'].rabiPersona.rebuild, undefined)
  await assert.rejects(f.call('rabi-persona-rebuild', body), /conversation changed/)
})

test('rebuild refuses pending input before creating a replacement', async () => {
  const f = fixture()
  await f.call('rabi-persona-import', { roleId: 'fixture' })
  f.rt.resolveAgent = async () => ({ inbox: { nextStep: [], nextTurn: [{ id: 'queued' }] } })
  f.rt.createSession = async () => { throw new Error('must not create') }
  await assert.rejects(f.call('rabi-persona-rebuild', { botId: 'bot-1', expectedSessionId: 'bot-1' }), /pending Bot input/)
})

function scheduleFixture() {
  const f = fixture({ state: { bots: { bot: { id: 'bot', rabiPersona: { roleId: 'fixture' } } }, rooms: {} }, bindings: new Map([['bot', 'fixture']]) })
  const rule = { id: 'daily', name: 'Daily', enabled: true, custom: 7, trigger: { type: 'schedule', schedule: { id: 'timing', type: 'daily_time', timeOfDay: '09:00', windowStartTime: '08:00' } }, action: { type: 'deliver_agent', target: { kind: 'ds_bot', agentAdapter: 'dsh', agentTargetId: 'local:dsh', dshBaseUrl: 'http://127.0.0.1:6328', botScopeId: 'scope', botId: 'bot' }, message: 'Original', template: 'retained' } }
  const data = { roleId: 'fixture', revision: 'r1', config: { custom: 9, futureConfig: { nested: ['keep', 7] }, automationRules: [rule, { id: 'message', trigger: { type: 'message' } }, null] } }
  f.responses.set('/api/roles/fixture/configuration', { data })
  const execute = f.ctx.tools.execute
  f.ctx.tools.execute = async input => {
    if (input.arguments.method !== 'PUT') return execute(input)
    f.requests.push(input.arguments)
    const payload = JSON.parse(input.arguments.bodyJson)
    assert.equal(payload.expectedRevision, 'r1')
    assert.ok(JSON.parse(input.arguments.requestHeadersJson)['Idempotency-Key'])
    assert.equal(payload.config.custom, data.config.custom)
    assert.deepEqual(payload.config.futureConfig, data.config.futureConfig)
    data.config = payload.config; data.revision = 'r2'
    return { isError: false, value: { ok: true, body: JSON.stringify({ code: 0, state: 'committed' }) } }
  }
  return { ...f, data }
}

test('schedule CRUD preserves unrelated rules, action target and extra timing fields', async () => {
  const f = scheduleFixture(), other = structuredClone(f.data.config.automationRules.slice(1))
  const view = await f.call('rabi-schedule-save', { botId: 'bot', sourceRoleId: 'fixture', expectedRoleId: 'fixture', id: 'daily', revision: 'r1', operationId: 'edit', title: 'Changed', message: 'Updated', enabled: false, schedule: { type: 'daily_time', timeOfDay: '10:00' } })
  assert.equal(view.revision, 'catalog')
  const rule = f.data.config.automationRules[0]
  assert.deepEqual(rule.action, { type: 'deliver_agent', target: { kind: 'ds_bot', agentAdapter: 'dsh', agentTargetId: 'local:dsh', dshBaseUrl: 'http://127.0.0.1:6328', botScopeId: 'scope', botId: 'bot' }, message: 'Updated', template: 'retained' })
  assert.equal(rule.trigger.schedule.windowStartTime, '08:00'); assert.equal(rule.custom, 7)
  assert.deepEqual(f.data.config.automationRules.slice(1), other); assert.equal(f.data.config.custom, 9)
  const created = scheduleFixture()
  await created.call('rabi-schedule-save', { botId: 'bot', sourceRoleId: 'fixture', expectedRoleId: 'fixture', revision: 'r1', operationId: 'create', title: 'New', message: 'Hello', enabled: true, schedule: { type: 'interval', intervalSeconds: 60 } })
  assert.deepEqual(created.data.config.automationRules.at(-1).action.target, { kind: 'ds_bot', agentAdapter: 'dsh', agentTargetId: 'local:dsh', dshBaseUrl: 'http://127.0.0.1:6328', botScopeId: 'scope', botId: 'bot', botName: 'Bot' })
  const deleted = scheduleFixture()
  await deleted.call('rabi-schedule-delete', { botId: 'bot', sourceRoleId: 'fixture', expectedRoleId: 'fixture', id: 'daily', revision: 'r1', operationId: 'delete' })
  assert.deepEqual(deleted.data.config.automationRules, other)
})

test('schedule toggle changes only the two enabled fields', async () => {
  const f = scheduleFixture(), previous = structuredClone(f.data.config.automationRules[0])
  await f.call('rabi-schedule-toggle', { botId: 'bot', sourceRoleId: 'fixture', expectedRoleId: 'fixture', id: 'daily', revision: 'r1', operationId: 'toggle', enabled: false })
  previous.enabled = false; previous.trigger.schedule.enabled = false
  assert.deepEqual(f.data.config.automationRules[0], previous)
})

test('stale revisions, wrong rule IDs and other destinations never mutate schedules', async () => {
  const f = scheduleFixture()
  for (const [id, revision] of [['daily', 'stale'], ['message', 'r1'], ['missing', 'r1']]) await assert.rejects(f.call('rabi-schedule-delete', { botId: 'bot', sourceRoleId: 'fixture', expectedRoleId: 'fixture', id, revision, operationId: id + revision }))
  f.data.config.automationRules[0].action.target.agentTargetId = 'remote:dsh'
  await assert.rejects(f.call('rabi-schedule-delete', { botId: 'bot', sourceRoleId: 'fixture', expectedRoleId: 'fixture', id: 'daily', revision: 'r1', operationId: 'binding' }), /missing or ambiguous/)
  assert.equal(f.requests.some(request => request.method === 'PUT'), false)
})

test('uncertain retries retain the exact original schedule payload', async () => {
  const f = scheduleFixture(), execute = f.ctx.tools.execute, payloads = []
  let uncertain = true
  f.ctx.tools.execute = async input => {
    if (input.arguments.method === 'PUT') {
      payloads.push(input.arguments.bodyJson)
      if (uncertain) return { isError: false, value: { ok: false, uncertain: true } }
    }
    return execute(input)
  }
  const body = { botId: 'bot', sourceRoleId: 'fixture', expectedRoleId: 'fixture', id: 'daily', revision: 'r1', operationId: 'uncertain' }
  await assert.rejects(f.call('rabi-schedule-delete', body), /outcome is uncertain/)
  await assert.rejects(f.call('rabi-schedule-delete', { ...body, id: 'message' }), /original Rabi operation/)
  f.data.revision = 'concurrent'; uncertain = false
  await f.call('rabi-schedule-delete', body)
  assert.equal(payloads[0], payloads[1])
})

test('a failed schedule readback reports accepted operation without returning success', async () => {
  const f = scheduleFixture(), execute = f.ctx.tools.execute
  let saved = false
  f.ctx.tools.execute = async input => {
    if (saved && input.arguments.path.endsWith('/configuration') && input.arguments.method === 'GET') return { isError: false, value: { ok: false, statusCode: 503 } }
    const result = await execute(input)
    if (input.arguments.method === 'PUT') saved = true
    return result
  }
  await assert.rejects(f.call('rabi-schedule-delete', { botId: 'bot', sourceRoleId: 'fixture', expectedRoleId: 'fixture', id: 'daily', revision: 'r1', operationId: 'readback' }), error => error.code === 'bot/rabi-readback-failed')
  assert.equal(saved, true)
  assert.equal(f.requests.filter(request => request.method === 'PUT').length, 1)
})

test('schedule edits update and clear windows while timing switches remove old values', async () => {
  const body = { botId: 'bot', sourceRoleId: 'fixture', expectedRoleId: 'fixture', id: 'daily', revision: 'r1', operationId: 'window', title: 'Changed', message: 'Message', enabled: true, schedule: { type: 'interval', intervalSeconds: 60, windowStartTime: '10:00', windowEndTime: '18:00' } }
  const f = scheduleFixture()
  f.data.config.automationRules[0].trigger.schedule.skipWhenAgentBusy = true
  await f.call('rabi-schedule-save', body)
  const schedule = f.data.config.automationRules[0].trigger.schedule
  assert.equal(schedule.windowStartTime, '10:00'); assert.equal(schedule.windowEndTime, '18:00')
  assert.equal(schedule.skipWhenAgentBusy, true); assert.equal(Object.hasOwn(schedule, 'timeOfDay'), false)
  const clear = scheduleFixture()
  await clear.call('rabi-schedule-save', { ...body, schedule: { type: 'once_at', onceAt: '2030-01-01T10:00:00Z', windowStartTime: '', windowEndTime: '' } })
  const cleared = clear.data.config.automationRules[0].trigger.schedule
  assert.equal(Object.hasOwn(cleared, 'windowStartTime'), false); assert.equal(Object.hasOwn(cleared, 'windowEndTime'), false)
  assert.equal(Object.hasOwn(cleared, 'timeOfDay'), false)
})

test('invalid schedule input rejects before a write with a known validation code', async () => {
  const body = { botId: 'bot', sourceRoleId: 'fixture', expectedRoleId: 'fixture', revision: 'r1', operationId: 'invalid', title: 'New', message: 'Message', enabled: true, schedule: { type: 'daily_time', timeOfDay: '10:00' } }
  for (const change of [{ title: 'x'.repeat(121) }, { message: ' ' }, { schedule: { ...body.schedule, windowStartTime: '10:00' } }, { schedule: { ...body.schedule, windowStartTime: '99:00', windowEndTime: '12:00' } }]) {
    const f = scheduleFixture()
    await assert.rejects(f.call('rabi-schedule-save', { ...body, ...change }), error => error.code === 'bot/rabi-validation')
    assert.equal(f.requests.some(request => request.method === 'PUT'), false)
  }
})

test('schedule operations fence the expected storage role independently of Bot persona binding', async () => {
  const f = scheduleFixture()
  f.rt.state.bots.bot.rabiPersona.roleId = 'another'; f.bindings.set('bot', 'another')
  for (const endpoint of ['rabi-schedule-save', 'rabi-schedule-delete', 'rabi-schedule-toggle']) await assert.rejects(f.call(endpoint, { botId: 'bot', sourceRoleId: 'fixture', expectedRoleId: 'another', id: 'daily', revision: 'r1', operationId: endpoint }), error => error.code === 'bot/rabi-binding-conflict')
  assert.equal(f.requests.some(request => request.path.endsWith('/configuration')), false)
})

test('Rabi receipt errors preserve uncertainty and known revision or validation failures', async () => {
  for (const [receipt, code] of [[{ ok: false, uncertain: true }, 'bot/rabi-uncertain'], [{ ok: false, statusCode: 400, body: JSON.stringify({ mutationOutcome: 'unknown' }) }, 'bot/rabi-uncertain'], [{ ok: false, statusCode: 412 }, 'bot/rabi-revision-conflict'], [{ ok: false, statusCode: 400 }, 'bot/rabi-validation']]) {
    const f = scheduleFixture(), execute = f.ctx.tools.execute
    f.ctx.tools.execute = input => input.arguments.method === 'PUT' ? Promise.resolve({ isError: false, value: receipt }) : execute(input)
    await assert.rejects(f.call('rabi-schedule-delete', { botId: 'bot', sourceRoleId: 'fixture', expectedRoleId: 'fixture', id: 'daily', revision: 'r1', operationId: 'error-code' }), error => error.code === code)
  }
})

test('schedule templates are returned, edited explicitly and preserved when omitted', async () => {
  const f = scheduleFixture()
  assert.equal((await f.call('rabi-bot-view', { botId: 'bot', resource: 'schedules' })).items[0].template, 'retained')
  const body = { botId: 'bot', sourceRoleId: 'fixture', expectedRoleId: 'fixture', id: 'daily', revision: 'r1', operationId: 'template', title: 'Daily', message: 'Message', enabled: true, schedule: { type: 'daily_time', timeOfDay: '10:00' } }
  const view = await f.call('rabi-schedule-save', { ...body, template: 'Updated instructions' })
  assert.equal(view.items[0].template, 'Updated instructions')
  assert.equal(f.data.config.automationRules[0].action.message, 'Message')
  const omitted = scheduleFixture()
  await omitted.call('rabi-schedule-save', body)
  assert.equal(omitted.data.config.automationRules[0].action.template, 'retained')
  const script = scheduleFixture()
  script.data.config.automationRules[0].action = { target: script.data.config.automationRules[0].action.target, type: 'run_script', scriptPath: 'fixture.js', template: 'script-owned' }
  await script.call('rabi-schedule-save', { ...body, template: 'Ignore this', message: 'Ignore this too' })
  assert.deepEqual(script.data.config.automationRules[0].action, { target: script.data.config.automationRules[0].action.target, type: 'run_script', scriptPath: 'fixture.js', template: 'script-owned' })
})

test('daily lists canonicalize one rule while preserving identity, target and metadata', async () => {
  const f = scheduleFixture(), before = structuredClone(f.data.config.automationRules[0])
  const view = await f.call('rabi-schedule-save', { botId: 'bot', sourceRoleId: 'fixture', expectedRoleId: 'fixture', id: 'daily', revision: 'r1', operationId: 'multiple', title: 'Daily', message: 'Original', enabled: true, schedule: { type: 'daily_time', timeOfDays: ['18:00', '10:00:00', '14:00:03', '10:00'], timeOfDay: 'invalid' } })
  const rule = f.data.config.automationRules[0]
  assert.equal(f.data.config.automationRules.length, 3)
  assert.equal(rule.id, before.id)
  assert.equal(rule.trigger.schedule.id, before.trigger.schedule.id)
  assert.deepEqual(rule.action, before.action)
  assert.equal(rule.custom, before.custom)
  assert.deepEqual(rule.trigger.schedule.timeOfDays, ['10:00', '14:00:03', '18:00'])
  assert.equal(Object.hasOwn(rule.trigger.schedule, 'timeOfDay'), false)
  assert.deepEqual(view.items[0].schedule.timeOfDays, ['10:00', '14:00:03', '18:00'])
})

test('invalid daily arrays reject the entire rule with a warning and reject writes', async () => {
  for (const times of [[], ['10:00', '99:00'], ['10:00', 14], null, '10:00']) {
    const f = scheduleFixture()
    f.data.config.automationRules[0].trigger.schedule.timeOfDays = times
    const view = await f.call('rabi-bot-view', { botId: 'bot', resource: 'schedules' })
    assert.equal(view.items.length, 0)
    assert.deepEqual(view.warnings, [0])
    await assert.rejects(f.call('rabi-schedule-save', { botId: 'bot', sourceRoleId: 'fixture', expectedRoleId: 'fixture', id: 'daily', revision: 'r1', operationId: 'invalid-list', title: 'Daily', message: 'Original', enabled: true, schedule: { type: 'daily_time', timeOfDay: '09:00', timeOfDays: times } }), error => error.code === 'bot/rabi-validation')
    assert.equal(f.requests.some(request => request.method === 'PUT'), false)
  }
})

test('legacy seconds stay readable and switching timing removes both daily fields', async () => {
  const legacy = scheduleFixture()
  legacy.data.config.automationRules[0].trigger.schedule.timeOfDay = '09:00:07'
  assert.equal((await legacy.call('rabi-bot-view', { botId: 'bot', resource: 'schedules' })).items[0].schedule.timeOfDay, '09:00:07')
  for (const schedule of [{ type: 'interval', intervalSeconds: 60 }, { type: 'once_at', onceAt: '2030-01-01T10:00:00Z' }]) {
    const f = scheduleFixture()
    f.data.config.automationRules[0].trigger.schedule.timeOfDays = ['10:00', '14:00', '18:00']
    await f.call('rabi-schedule-save', { botId: 'bot', sourceRoleId: 'fixture', expectedRoleId: 'fixture', id: 'daily', revision: 'r1', operationId: 'transition', title: 'Daily', message: 'Original', enabled: true, schedule })
    assert.equal(Object.hasOwn(f.data.config.automationRules[0].trigger.schedule, 'timeOfDays'), false)
    assert.equal(Object.hasOwn(f.data.config.automationRules[0].trigger.schedule, 'timeOfDay'), false)
  }
})


test('uncertain multi-time saves retry the complete original PUT configuration', async () => {
  const f = scheduleFixture(), execute = f.ctx.tools.execute, payloads = []
  let uncertain = true
  f.ctx.tools.execute = async input => {
    if (input.arguments.method === 'PUT') {
      payloads.push(input.arguments.bodyJson)
      if (uncertain) return { isError: false, value: { ok: false, uncertain: true } }
    }
    return execute(input)
  }
  const body = { botId: 'bot', sourceRoleId: 'fixture', expectedRoleId: 'fixture', id: 'daily', revision: 'r1', operationId: 'uncertain-list', title: 'Daily', message: 'Original', enabled: true, schedule: { type: 'daily_time', timeOfDays: ['10:00', '14:00', '18:00'] } }
  await assert.rejects(f.call('rabi-schedule-save', body), /outcome is uncertain/)
  f.data.config.futureConfig = { changedAfterRead: true }
  await assert.rejects(f.call('rabi-schedule-save', { ...body, schedule: { ...body.schedule, timeOfDays: ['11:00'] } }), /original Rabi operation/)
  uncertain = false
  // The remote fixture must accept the original CAS snapshot, not newer configuration.
  f.ctx.tools.execute = async input => {
    if (input.arguments.method === 'PUT') {
      payloads.push(input.arguments.bodyJson)
      const payload = JSON.parse(input.arguments.bodyJson)
      f.data.config = payload.config; f.data.revision = 'r2'
      return { isError: false, value: { ok: true, body: JSON.stringify({ code: 0, state: 'committed' }) } }
    }
    return execute(input)
  }
  await f.call('rabi-schedule-save', body)
  assert.equal(payloads[0], payloads[1])
  assert.deepEqual(f.data.config.futureConfig, { nested: ['keep', 7] })
  assert.deepEqual(f.data.config.automationRules[0].trigger.schedule.timeOfDays, ['10:00', '14:00', '18:00'])
})


test('daily DTO parsing matches Rabi legacy hours and whitespace without accepting malformed lists', async () => {
  const { rabiDailyTimes } = await import('../src/shared/rabi-daily-times.js')
  assert.deepEqual(rabiDailyTimes({ timeOfDay: ' 9:30 ' }), ['09:30'])
  const f = scheduleFixture()
  f.data.config.automationRules[0].trigger.schedule.timeOfDays = [' 9:30 ', '09:30:00', ' 8:05:07 ', '18:00']
  const view = await f.call('rabi-bot-view', { botId: 'bot', resource: 'schedules' })
  assert.deepEqual(view.items[0].schedule.timeOfDays, ['08:05:07', '09:30', '18:00'])
  assert.deepEqual(view.warnings, [])
  for (const value of ['25:00', null, 930, undefined]) assert.equal(rabiDailyTimes({ timeOfDays: ['9:30', value] }), null)
  assert.equal(rabiDailyTimes({ timeOfDay: '9:30', timeOfDays: undefined }), null)
})


test('assigned rules span source roles for ordinary Bots and exclude every other destination', async () => {
  const f = scheduleFixture()
  delete f.rt.state.bots.bot.rabiPersona
  const second = structuredClone(f.data)
  second.roleId = 'other'; second.revision = 'other-rev'
  f.responses.set('/api/roles/other/configuration', { data: second })
  for (const target of [{ kind: 'recipient', recipientId: 'primary' }, { ...f.data.config.automationRules[0].action.target, botId: 'another' }, { ...f.data.config.automationRules[0].action.target, agentTargetId: 'remote:dsh' }, { ...f.data.config.automationRules[0].action.target, botScopeId: 'copied-other' }]) {
    const rule = structuredClone(f.data.config.automationRules[0]); rule.id = JSON.stringify(target); rule.action.target = target
    f.data.config.automationRules.push(rule)
  }
  const view = await f.call('rabi-bot-view', { botId: 'bot', resource: 'schedules' })
  assert.deepEqual(view.items.map(item => item.sourceRoleId), ['fixture', 'other'])
  assert.equal(new Set(view.items.map(item => item.id)).size, 2)
  assert.ok(view.items.every(item => item.rawRuleId === 'daily'))
  const query = f.requests.find(request => request.path.startsWith('/api/automation/ds-bot-rules?'))
  assert.equal(new URL('http://fixture' + query.path).searchParams.get('agentTargetId'), 'local:dsh')
  const detail = await f.call('rabi-schedule-read', { botId: 'bot', sourceRoleId: 'other', id: 'daily' })
  assert.equal(detail.revision, 'other-rev')
  assert.equal(detail.items[0].sourceRoleId, 'other')
  assert.equal(f.requests.some(request => request.path.startsWith('/api/codex-hook/')), false)
})

test('editing uses the original source role revision and preserves Bot persona and unrelated config', async () => {
  const f = scheduleFixture()
  const other = structuredClone(f.data); other.roleId = 'other'; other.revision = 'other-rev'
  f.responses.set('/api/roles/other/configuration', { data: other })
  const initial = structuredClone(f.data)
  const execute = f.ctx.tools.execute
  f.ctx.tools.execute = async input => {
    if (input.arguments.method === 'PUT' && input.arguments.path === '/api/roles/other/configuration') {
      const payload = JSON.parse(input.arguments.bodyJson)
      assert.equal(payload.expectedRevision, 'other-rev')
      assert.equal(payload.config.custom, 9)
      other.config = payload.config; other.revision = 'other-new'
      return { isError: false, value: { ok: true, body: '{}' } }
    }
    return execute(input)
  }
  await f.call('rabi-schedule-save', { botId: 'bot', sourceRoleId: 'other', expectedRoleId: 'other', id: 'daily', revision: 'other-rev', operationId: 'cross-role', title: 'Changed', message: 'Other role task', enabled: true, schedule: { type: 'daily_time', timeOfDays: ['10:00', '14:00', '18:00'] } })
  assert.equal(other.config.automationRules[0].id, 'daily')
  assert.equal(other.config.automationRules[0].action.message, 'Other role task')
  assert.deepEqual(f.data, initial)
  assert.equal(f.rt.state.bots.bot.rabiPersona.roleId, 'fixture')
})

test('unconfirmed self destination fails visibly before listing or changing rules', async () => {
  const f = scheduleFixture(), execute = f.ctx.tools.execute
  f.ctx.tools.execute = input => input.arguments.path.startsWith('/api/agent/providers/dsh/ds-bot-destination?')
    ? Promise.resolve({ isError: false, value: { ok: true, body: JSON.stringify({ data: { target: { kind: 'ds_bot', agentAdapter: 'dsh', agentTargetId: 'remote:dsh', botScopeId: 'wrong', botId: 'bot' } } }) } }) : execute(input)
  await assert.rejects(f.call('rabi-bot-view', { botId: 'bot', resource: 'schedules' }), { code: 'bot/rabi-destination-unavailable' })
  assert.equal(f.requests.some(request => request.path.startsWith('/api/automation/ds-bot-rules')), false)
  assert.equal(f.requests.some(request => request.method === 'PUT'), false)
})


test('confirmed connection fields are preserved and distinguish other DSH origins or remote owners', async () => {
  for (const connection of [{ dshBaseUrl: 'http://127.0.0.1:6328' }, { instanceBinding: { ownerDeviceId: 'peer', instanceId: 'instance', agentId: 'configured-dsh' } }]) {
    const f = scheduleFixture()
    const target = { ...f.data.config.automationRules[0].action.target, botName: 'Bot', ...connection }
    if (connection.instanceBinding) { delete target.dshBaseUrl; target.agentTargetId = 'configured-remote-dsh' }
    f.data.config.automationRules[0].action.target = structuredClone(target)
    const other = structuredClone(f.data.config.automationRules[0]); other.id = 'other-connection'
    if (connection.dshBaseUrl) other.action.target.dshBaseUrl = 'http://127.0.0.1:7328'
    else other.action.target.instanceBinding.agentId = 'another-dsh'
    f.data.config.automationRules.push(other)
    const execute = f.ctx.tools.execute
    f.ctx.tools.execute = input => input.arguments.path.startsWith('/api/agent/providers/dsh/ds-bot-destination?')
      ? Promise.resolve({ isError: false, value: { ok: true, body: JSON.stringify({ data: { target } }) } }) : execute(input)
    const view = await f.call('rabi-bot-view', { botId: 'bot', resource: 'schedules' })
    assert.deepEqual(view.items.map(item => item.rawRuleId), ['daily'])
    const listRequest = f.requests.find(request => request.path.startsWith('/api/automation/ds-bot-rules?'))
    const params = new URL('http://fixture' + listRequest.path).searchParams
    if (connection.instanceBinding) {
      assert.deepEqual(JSON.parse(params.get('instanceBinding')), connection.instanceBinding)
      assert.equal(params.has('dshBaseUrl'), false)
    } else {
      assert.equal(params.get('dshBaseUrl'), connection.dshBaseUrl)
      assert.equal(params.has('instanceBinding'), false)
    }
    await assert.rejects(f.call('rabi-schedule-read', { botId: 'bot', sourceRoleId: 'fixture', id: 'other-connection' }), { code: 'bot/rabi-binding-conflict' })
    const saved = await f.call('rabi-schedule-save', { botId: 'bot', sourceRoleId: 'fixture', expectedRoleId: 'fixture', revision: 'r1', operationId: 'connection-create', title: 'New', message: 'Check', enabled: true, schedule: { type: 'daily_time', timeOfDays: ['10:00', '14:00'] } })
    assert.deepEqual(f.data.config.automationRules.at(-1).action.target, target)
    assert.equal(saved.items.some(item => item.rawRuleId === 'other-connection'), false)
  }
})
