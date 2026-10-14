/** Open exact host sessions after their catalog arrives; a later selection supersedes an earlier refresh. */
export function createSessionNavigator({ sessions, openSession, onError }) {
  let request = 0
  return async (id) => {
    const current = ++request
    try {
      const catalog = sessions.list.getSnapshot()
      if (catalog.phase === 'pending' || catalog.byId[id] === undefined) await sessions.refresh()
      if (current !== request) return
      await openSession(id)
    } catch (error) {
      if (current === request) onError(error)
    }
  }
}
