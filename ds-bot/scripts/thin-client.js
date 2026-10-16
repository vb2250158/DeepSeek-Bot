// Generated thin entry by scripts/build-client.mjs. Do not edit by hand.
// Keeps the ModuleLoader combo tiny so markdown/unity can activate; heavy UI loads async inside apply.
window.__ModuleLoader__.load({
  id: 'ds-bot',
  factory: (require) => {
    const module = { exports: {} }
    // Must match src/client/index.js — fiber inject is read from this thin entry, not the deferred app.
    module.exports.inject = ['sessions', 'uiWorkspace', 'uiConversation', 'slots', 'theme', 'layout']
    module.exports.apply = async function apply(ctx) {
      const loadHeavy = async () => {
        if (globalThis.__dsBotHeavy && typeof globalThis.__dsBotHeavy.apply === 'function') return globalThis.__dsBotHeavy
        const response = await fetch('/api/ds-bot-client-app', { credentials: 'same-origin' })
        if (!response.ok) throw new Error('ds-bot client-app HTTP ' + response.status)
        const code = await response.text()
        const heavyModule = { exports: {} }
        const run = new Function('require', 'module', 'exports', code + '\n;return module.exports')
        const exported = run(require, heavyModule, heavyModule.exports)
        globalThis.__dsBotHeavy = Object.defineProperty({ ...exported }, Symbol.toStringTag, { value: 'Module' })
        return globalThis.__dsBotHeavy
      }
      try {
        const heavy = await loadHeavy()
        return heavy.apply(ctx)
      } catch (error) {
        console.warn('[ds-bot] deferred client', error)
      }
    }
    return Object.defineProperty({ ...module.exports }, Symbol.toStringTag, { value: 'Module' })
  },
})
