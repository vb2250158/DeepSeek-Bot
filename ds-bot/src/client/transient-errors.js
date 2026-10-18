import { createElement as h } from 'react'

// Navigation time survives conversation switches and asynchronous plugin loading.
export const errorPageStartedAt = typeof performance === 'undefined' ? Date.now() : performance.timeOrigin

/** Undated failures remain visible rather than losing an unknown outcome. */
export function isCurrentPageFailure(time, since = errorPageStartedAt) {
  return typeof time !== 'number' || time >= since
}

/** Hide manual continuation actions and replayed failures through public slots. */
export function installTransientErrors(slots, since = errorPageStartedAt) {
  const cells = [
    { name: 'conversation.chat.node', key: 'turn-error', visible: props => isCurrentPageFailure(props.node.data.time, since) },
    { name: 'conversation.chat.turnTail', id: 'turn-continuation', visible: () => false },
  ]
  const cleanups = cells.map(cell => {
    let original, wrapper, remove = () => {}
    const sync = () => {
      const next = slots.entries(cell.name).find(entry => entry.component !== wrapper && (cell.key ? entry.options.key === cell.key : entry.options.id === cell.id))
      if (next === original) return
      remove()
      original = next
      if (!next) { wrapper = undefined; remove = () => {}; return }
      wrapper = function PageFailure(props) { return cell.visible(props) ? h(next.component, props) : null }
      remove = slots.register({ name: cell.name, ...next.options, priority: (next.options.priority ?? 0) - 1,
        ...(next.locale ? { locale: next.locale } : {}), ...(next.inject ? { inject: next.inject } : {}),
      }, wrapper)
    }
    const unsubscribe = slots.subscribe(cell.name, sync)
    sync()
    return () => { unsubscribe(); remove() }
  })
  return () => { for (const cleanup of cleanups) cleanup() }
}
