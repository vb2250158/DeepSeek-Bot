import { rabiClient, rabiRefuse as refuse, rabiSegment as segment } from './rabi-client.js'

const UI_TIMEOUT_MS = 8000

/** GUI adapter over the existing Rabi tool pipeline; Rabi owns connections and terminals.
 *  Manager / WebGUI traffic is request-local and never runs during install() / plugin activation. */
export function install(rt) {
  const { ctx, state } = rt
  const { available, json: request } = rabiClient(ctx, UI_TIMEOUT_MS)
  // Access credentials are request-local and never returned to the DS Bot browser or state.
  const auth = async signal => {
    const access = await request('/api/webgui-access', 'GET', undefined, signal)
    if (typeof access.data?.token !== 'string' || !access.data.token) refuse('Rabi WebGUI access is unavailable')
    return { 'x-rabiroute-webgui-token': access.data.token }
  }
  /** Soft Manager call: connection / auth failures become { error } instead of throwing, so the panel never blocks plugin activation. */
  const softManager = async (fn) => {
    try { return { ok: true, value: await fn() } }
    catch (error) { return { ok: false, error: error?.message ?? String(error) } }
  }
  rt.rabiComputerEndpoint = async (endpoint, body = {}, signal) => {
    await rt.load()
    const enabled = state.prefs.rabiComputers === true
    // Status is local tool presence only — never touches Manager.
    if (endpoint === 'rabi-computers-status') return { available: available(), enabled }
    if (!enabled) refuse('Enable the Rabi computer panel first')
    if (!available()) refuse('Install and configure dsh-rabiroute-agent on the controller first')
    if (endpoint === 'rabi-computers-list') {
      const outcome = await softManager(async () => {
        const headers = await auth(signal)
        const result = await request('/api/lan-agent/instances', 'GET', undefined, signal, headers)
        if (!Array.isArray(result.instances)) refuse('Rabi returned an invalid computer list')
        return result.instances.map(item => ({ instanceId: item.instanceId, name: item.name, platform: item.platform, connected: item.connected, local: item.local }))
      })
      if (!outcome.ok) return { computers: [], error: outcome.error, available: available(), enabled }
      return { computers: outcome.value, available: available(), enabled }
    }
    const headers = await auth(signal)
    const base = `/api/lan-agent/instances/${segment(body.instanceId)}`
    if (endpoint === 'rabi-computer-terminals') {
      const result = await request(`${base}/terminals`, 'GET', undefined, signal, headers)
      return result.data
    }
    if (endpoint === 'rabi-computer-output') {
      const after = body.after ?? 0
      if (!Number.isInteger(after) || after < 0) refuse('Invalid terminal output sequence')
      const result = await request(`${base}/terminals/${segment(body.terminalId)}?after=${after}&waitMs=1000`, 'GET', undefined, signal, headers)
      return result.data
    }
    if (endpoint === 'rabi-computer-terminal') {
      const terminalId = body.terminalId
      segment(terminalId)
      let operation
      switch (body.action) {
        case 'open':
          if (!['cmd', 'powershell'].includes(body.shell)) refuse('Choose a shell offered by the remote client')
          operation = { action: 'open', terminalId, shell: body.shell, ...(body.cwd ? { cwd: body.cwd } : {}) }
          break
        case 'input':
          if (!Number.isInteger(body.sequence) || body.sequence < 1 || typeof body.data !== 'string' || Buffer.byteLength(body.data) > 16384) refuse('Invalid terminal input')
          operation = { action: 'input', terminalId, sequence: body.sequence, data: body.data }
          break
        case 'get': case 'close': operation = { action: body.action, terminalId }; break
        default: refuse('Unknown terminal operation')
      }
      const result = await request(`${base}/terminals`, 'POST', operation, signal, headers)
      return result.data
    }
    refuse('Unknown computer panel operation')
  }
}
