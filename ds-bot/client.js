// Generated thin entry by scripts/build-client.mjs. Do not edit by hand.
// Keeps the ModuleLoader combo tiny; apply still awaits all heavy UI registrations.
window.__ModuleLoader__.load({
  id: 'ds-bot',
  factory: (require) => {
    const module = { exports: {} }
    const clientAppHash = '0db5e0ea2801b5130a69583eff7ec7f8d1d44b152a84e993844adcd4f5a30830'
    // Must match src/client/index.js — fiber inject is read from this thin entry, not the deferred app.
    module.exports.inject = ['sessions', 'uiWorkspace', 'uiConversation', 'slots', 'theme', 'layout']
    module.exports.apply = async function apply(ctx) {
      const loadHeavy = async () => {
        const response = await fetch(`/api/ds-bot-client-app?v=${clientAppHash}`, { credentials: 'same-origin' })
        if (ctx.fiber.uid === null) return
        if (!response.ok) throw new Error('ds-bot client-app HTTP ' + response.status)
        const code = await response.text()
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
