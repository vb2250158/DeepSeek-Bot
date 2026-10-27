// One pending readiness wait belongs to the client plugin, never to a roster module.
export function rosterReadiness(roster, ready) {
  let pending
  let disposed = false
  const cancel = () => { pending?.(); pending = undefined }
  return {
    ensure() {
      if (disposed) return
      if (roster.getSnapshot().ready) { cancel(); ready(); return }
      if (pending) return
      pending = roster.subscribe(() => {
        if (!roster.getSnapshot().ready) return
        cancel()
        ready()
      })
    },
    cancel,
    dispose() { disposed = true; cancel() },
  }
}
