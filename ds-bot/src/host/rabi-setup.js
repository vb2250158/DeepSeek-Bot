export const RABI_REPOSITORY = 'https://github.com/vb2250158/RabiRoute'

const INSTALL_PROMPT = `Help me install and configure RabiRoute on this computer from ${RABI_REPOSITORY}.
First inspect whether Rabi is already installed or running. Before downloading, installing, or changing configuration, ask me which installation directory to use, which persona or personas to initialize, and my startup and model preferences. Wait for my answers and confirm any remaining choices. Preserve existing Rabi data and credentials.
Use the repository's current installation documentation and supported release. Configure the local Rabi executable for this DSH environment, then verify Host startup, Manager readiness, and the DS Bot connection. Keep source, installation, and running-state checks distinct. Do not start another Agent or create a replacement chat for this request.`

/** Adapt local Rabi lifecycle states and queue setup instructions through an existing Bot session. */
export function install(rt) {
  const { ctx, state } = rt
  let lastInstall = null
  const status = async signal => {
    const controller = ctx.get?.('rabiHost')
    const available = Boolean(ctx.tools.get?.('rabiroute_manager_api'))
    const common = { available, connected: false, personas: [], hooksReady: Boolean(ctx.get?.('rabiAgentHooks')?.requireBinding), repositoryUrl: RABI_REPOSITORY }
    if (!controller) return { ...common, state: available ? 'adapter-update' : 'adapter-missing', installed: false, canStart: false }
    try {
      const current = await controller.inspect(signal)
      return { ...common, state: current.state, installed: current.installed, canStart: current.canStart, locationRemembered: current.locationRemembered }
    } catch (error) {
      signal?.throwIfAborted()
      rt.warn('ds-bot: Rabi setup inspection failed: %s', error)
      return { ...common, state: 'unavailable', installed: false, canStart: false }
    }
  }
  rt.rabiSetupStatus = status
  rt.rabiSetupEndpoint = async (endpoint, body = {}, signal) => {
    await rt.load()
    if (endpoint === 'rabi-install-request') {
      const botId = rt.botOf(body.botId)?.id ?? state.mainBotIds.find(id => rt.botOf(id)) ?? Object.keys(state.bots ?? {})[0]
      const bot = rt.botOf(botId)
      if (!bot) throw Object.assign(new Error('Create a Bot before requesting Rabi setup'), { code: 'bot/rabi-setup-main' })
      if (!bot.model && !bot.appliedModel) throw Object.assign(new Error('Choose a model for the Bot before requesting Rabi setup'), { code: 'bot/rabi-setup-model' })
      if (typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) throw new Error('Invalid Rabi setup request identity')
      if (lastInstall?.requestId === body.requestId) return lastInstall.promise
      const send = async () => {
        const sessionId = rt.chatOf(botId)
        await rt.ensureCapabilities(sessionId)
        const text = INSTALL_PROMPT + (body.locale === 'zh' ? '\nAsk your setup questions in Chinese.' : '')
        await ctx.sessionController.prompt({ requestId: body.requestId, sessionId, mode: 'queue', content: [{ type: 'text', text }] }, AbortSignal.timeout(30000))
        return { botId, sessionId, delivered: true }
      }
      lastInstall = { requestId: body.requestId, promise: send() }
      return lastInstall.promise
    }
    if (endpoint === 'rabi-start') {
      const controller = ctx.get?.('rabiHost')
      if (!controller) return status(signal)
      const result = await controller.start(signal)
      return { available: true, connected: false, personas: [], hooksReady: Boolean(ctx.get?.('rabiAgentHooks')?.requireBinding), repositoryUrl: RABI_REPOSITORY,
        state: result.state, installed: result.installed, canStart: result.canStart, launchAccepted: result.launchAccepted }
    }
    const current = await status(signal)
    if (endpoint === 'rabi-connection-status') return current
    if (endpoint !== 'rabi-connect') throw new Error('Unknown Rabi setup operation')
    if (current.state !== 'ready') return current
    try { return { ...current, ...await rt.rabiPersonaEndpoint('rabi-personas-list', {}, signal) } }
    catch (error) {
      signal?.throwIfAborted()
      rt.warn('ds-bot: Rabi connection failed: %s', error)
      return { ...await status(signal), connectionIssue: true }
    }
  }
}
