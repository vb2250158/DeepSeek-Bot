import { freePriority } from './surface.js'

const navigationEntry = entries => entries.find(entry => entry.store && typeof entry.inject === 'function')

// Reuse the replaced header's public navigation face and store: activating a
// Conversation target alone does not change its persisted View selection.
export function headerNavigation(entries, face) {
  const source = navigationEntry(entries)
  return {
    ...(source ? { store: source.store } : {}),
    inject: (...args) => {
      const navigation = source?.inject(...args) ?? {}
      const own = face()
      return { ...navigation, ...own, hooks: { ...navigation.hooks, ...own.hooks } }
    },
  }
}

const HEADER_SLOT = 'conversation.session.header'

export function installHeaderNavigation(slots, face, component, priority, name = HEADER_SLOT) {
  let source
  let dispose
  const refresh = () => {
    const entries = slots.entries(HEADER_SLOT).filter(entry => entry.component !== component)
    // The workbench needs the native tab and pin sources, even while the Bot pill occupies the header.
    const next = name === HEADER_SLOT
      ? navigationEntry(entries)
      : entries.find(entry => entry.children?.['conversation.session.header.views.actions'])
    if (dispose && source === next) return
    dispose?.()
    source = next
    dispose = slots.register({
      name,
      priority: freePriority(name === HEADER_SLOT ? entries : slots.entries(name), { priority }),
      ...headerNavigation(next ? [next] : [], face),
    }, component)
  }
  // Slot declaration precedes the owner's registration. Follow that arrival,
  // and later host reloads, without treating our own registration as a source.
  const unsubscribe = slots.subscribe(HEADER_SLOT, refresh)
  try { refresh() } catch (error) { unsubscribe(); throw error }
  return () => { unsubscribe(); dispose?.() }
}
