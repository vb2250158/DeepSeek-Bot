import { rabiClient, rabiRefuse as refuse } from './rabi-client.js'

const UI_TIMEOUT_MS = 8000
const REMOTE_DISABLED = 'Remote computer access is disabled for all Bots in Bot settings.'

/** Only the Rabi remote-computer API is controlled here; Rabi owns device authorization. */
function isRemoteComputerCall(exec) {
  if (exec.name !== 'rabiroute_manager_api' || typeof exec.arguments?.path !== 'string') return false
  try {
    const decoded = decodeURIComponent(new URL(exec.arguments.path, 'http://rabi.invalid').pathname)
    const path = new URL(decoded, 'http://rabi.invalid').pathname.toLowerCase()
    return path === '/api/lan-agent' || path.startsWith('/api/lan-agent/')
  } catch { return false } // Invalid paths are rejected by the Rabi adapter before dispatch.
}

/** Team-wide capability switch and read-only computer catalog. No remote session or credential is stored. */
export function install(rt) {
  const { ctx, state } = rt
  const { available, json: request } = rabiClient(ctx, UI_TIMEOUT_MS)
  const enabled = () => state.prefs.rabiRemoteControl !== false
  // Load saved policy before the registry's final synchronous guard checks it.
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (isRemoteComputerCall(exec)) await rt.load()
    return next()
  })
  ctx.tools.guard(exec => isRemoteComputerCall(exec) && rt.isBotSession(exec.agent?.id) && !enabled() ? REMOTE_DISABLED : undefined)
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'bot-rabi-computers', order: 645, interpolate: false,
    text: context => rt.isBotSession(context?.agent?.id)
      ? enabled()
        ? 'Remote computers: use the installed Rabi tools and GET /api/agent/help for current computer and terminal APIs. Rabi WebGUI owns pairing and computer authorization. Follow its permission decisions and operation receipts.'
        : REMOTE_DISABLED
      : '',
  }), 'ds-bot: Rabi remote computers')

  rt.rabiComputerEndpoint = async (endpoint, _body = {}, signal) => {
    await rt.load()
    if (endpoint === 'rabi-computers-status') return { available: available(), enabled: enabled() }
    if (endpoint !== 'rabi-computers-list') refuse('Unknown computer settings operation')
    if (!enabled()) refuse(REMOTE_DISABLED)
    if (!available()) refuse('Install and configure dsh-rabiroute-agent on the controller first')
    let managementUrl = ''
    try {
      const meta = await request('/meta', 'GET', undefined, signal)
      const management = new URL(meta.managerBaseUrl)
      if (!['http:', 'https:'].includes(management.protocol) || management.username || management.password || management.pathname !== '/' || management.search || management.hash) refuse('Rabi WebGUI address is unavailable')
      management.hash = '/lan-agents'
      managementUrl = management.href
      const access = await request('/api/webgui-access', 'GET', undefined, signal)
      if (typeof access.data?.token !== 'string' || !access.data.token) refuse('Rabi WebGUI access is unavailable')
      const result = await request('/api/lan-agent/instances', 'GET', undefined, signal, { 'x-rabiroute-webgui-token': access.data.token })
      if (!Array.isArray(result.instances)) refuse('Rabi returned an invalid computer list')
      const computers = result.instances.filter(item => !item.local).map(item => ({ instanceId: item.instanceId, name: item.name, platform: item.platform, connected: item.connected }))
      return { computers, managementUrl, available: available(), enabled: enabled() }
    } catch (error) {
      return { computers: [], managementUrl, error: error?.message ?? String(error), available: available(), enabled: enabled() }
    }
  }
}
