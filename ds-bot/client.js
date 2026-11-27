// Generated thin entry by scripts/build-client.mjs. Do not edit by hand.
// Keeps the ModuleLoader combo tiny; materialization prefetches and apply owns all heavy UI registrations.
window.__ModuleLoader__.load({
  id: 'ds-bot',
  factory: (require) => {
    const module = { exports: {} }
    const clientAppHash = 'e30ff9b1656bff10490b4bb479a2f87f6b2ed794109d8f82922a20e2afc2d1ee'
    async function readClientApp() {
      const response = await fetch(`/api/ds-bot-client-app?v=${clientAppHash}`, { credentials: 'same-origin' })
      if (!response.ok) throw new Error('ds-bot client-app HTTP ' + response.status)
      return response.text()
    }
    // Overlap transport with dependency activation. Evaluation still belongs to the live fiber.
    let initialBody = readClientApp()
    initialBody.catch(() => { initialBody = undefined })
    // Must match src/client/index.js — fiber inject is read from this thin entry, not the deferred app.
    module.exports.inject = ['sessions', 'uiWorkspace', 'uiConversation', 'slots', 'theme', 'layout']
    module.exports.apply = async function apply(ctx) {
      const loadHeavy = async () => {
        const body = initialBody ?? readClientApp()
        initialBody = undefined
        const code = await body
        if (ctx.fiber.uid === null) return
        const heavyModule = { exports: {} }
        const run = new Function('require', 'module', 'exports', code + '\n;return module.exports')
        const exported = run(require, heavyModule, heavyModule.exports)
        return Object.defineProperty({ ...exported }, Symbol.toStringTag, { value: 'Module' })
      }
      try {
        const heavy = await loadHeavy()
        if (ctx.fiber.uid === null) return
        return heavy.apply(ctx)
      } catch (error) {
        console.warn('[ds-bot] deferred client', error)
      }
    }
    return Object.defineProperty({ ...module.exports }, Symbol.toStringTag, { value: 'Module' })
  },
})
