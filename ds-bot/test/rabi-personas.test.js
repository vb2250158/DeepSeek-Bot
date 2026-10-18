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
