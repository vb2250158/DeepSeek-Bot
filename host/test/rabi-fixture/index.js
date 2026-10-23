import { defineTool } from '@deepseek-ai/dsh-tools'
export const name = 'ds-bot-test-rabi-fixture'
export const inject = ['tools']
// Synthetic contract fixture: no remote computer, credentials or command execution.
export function apply(ctx) {
  const sessions = new Map()
  const events = new Map()
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'rabiroute_manager_api', description: 'Synthetic Rabi receipt fixture for isolated UI tests.',
    parameters: { method: { type: 'string', required: true }, path: { type: 'string', required: true }, bodyJson: { type: 'string' }, requestHeadersJson: { type: 'string' } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args) {
      const reply = value => ({ statusCode: 200, ok: true, body: JSON.stringify(value) })
      if (args.path === '/api/webgui-access') return reply({ code: 0, data: { token: 'mock-fixture-access' } })
      if (JSON.parse(args.requestHeadersJson ?? '{}')['x-rabiroute-webgui-token'] !== 'mock-fixture-access') return { statusCode: 403, ok: false, body: '{}' }
      if (args.path === '/api/lan-agent/instances') return reply({ code: 0, instances: [
        { instanceId: 'fixture-online', name: 'Build computer', connected: true, local: false, agents: [] },
        { instanceId: 'fixture-offline', name: 'Offline computer', connected: false, local: false, agents: [] },
      ] })
      if (!args.path.startsWith('/api/lan-agent/instances/fixture-online/terminals')) return { statusCode: 404, ok: false, body: '{}' }
      if (args.method === 'GET' && !args.path.includes('?')) return reply({ code: 0, data: { shells: ['cmd', 'powershell'], sessions: [...sessions.values()] } })
      if (args.method === 'GET') {
        const url = new URL(args.path, 'http://fixture.test')
        const id = url.pathname.split('/').at(-1)
        const after = Number(url.searchParams.get('after'))
        const log = events.get(id) ?? []
        return reply({ code: 0, data: { terminal: sessions.get(id), outputEvents: log.filter(item => item.sequence > after), nextOutputSequence: log.at(-1)?.sequence ?? 0, truncated: false } })
      }
      const body = JSON.parse(args.bodyJson)
      if (body.action === 'open') {
        sessions.set(body.terminalId, { terminalId: body.terminalId, shell: body.shell, cwd: body.cwd || 'C:\\Fixture', state: 'running', nextInputSequence: 1 })
        events.set(body.terminalId, [{ sequence: 1, type: 'output', data: 'Synthetic terminal ready\r\n' }])
      } else if (body.action === 'input') {
        const session = sessions.get(body.terminalId)
        if (body.sequence !== session.nextInputSequence) return { statusCode: 409, ok: false, body: '{}' }
        session.nextInputSequence++
        const log = events.get(body.terminalId)
        log.push({ sequence: log.length + 1, type: 'output', data: `Received: ${body.data}\r\n` })
        if (body.data.includes('TEST_UNCERTAIN')) return { statusCode: 0, ok: false, uncertain: true, body: '{}' }
      } else if (body.action === 'close') {
        sessions.get(body.terminalId).state = 'exited'
        const log = events.get(body.terminalId)
        log.push({ sequence: log.length + 1, type: 'exit', exitCode: 0 })
      }
      return reply({ code: 0, data: sessions.get(body.terminalId) })
    },
  })))
}
