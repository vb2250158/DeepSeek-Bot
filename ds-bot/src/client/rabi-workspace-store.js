/** Window-local read cache. Rabi remains authoritative; documents never enter browser storage. */
export function createRabiWorkspaceStore(request, { capacity = 64, maxBytes = 4 * 1024 * 1024, concurrency = 2 } = {}) {
  const entries = new Map(), selections = new Map(), queue = [], lifetime = new AbortController()
  let active = 0
  const keyOf = scope => JSON.stringify([scope.botId, scope.roleId, scope.resource, scope.kind ?? '', scope.itemId ?? ''])
  const notify = entry => { for (const listener of entry.listeners) listener() }
  const prune = () => {
    let bytes = [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0)
    for (const [key, entry] of entries) {
      if (entries.size <= capacity && bytes <= maxBytes) break
      if (entry.promise || entry.listeners.size) continue
      bytes -= entry.bytes; entries.delete(key)
    }
  }
  const entryOf = scope => {
    const key = keyOf(scope)
    let entry = entries.get(key)
    if (!entry) entry = { scope, listeners: new Set(), snapshot: { value: null, pending: false, error: null, updatedAt: null }, pages: [], bytes: 0 }
    entries.delete(key); entries.set(key, entry)
    return entry
  }
  const drain = () => {
    while (active < concurrency && queue.length) {
      const job = queue.shift(); active++
      void job().finally(() => { active--; drain() })
    }
  }
  const load = (scope, more = false) => {
    const entry = entryOf(scope)
    if (entry.promise) return entry.promise
    if (lifetime.signal.aborted) return Promise.resolve()
    const cursor = more ? entry.snapshot.value?.nextCursor : undefined
    if (more && !cursor) return Promise.resolve()
    entry.snapshot = { ...entry.snapshot, pending: true, error: null }
    let resolve
    const promise = entry.promise = new Promise(done => { resolve = done })
    const epoch = entry.epoch
    queue.push(async () => {
      try {
        lifetime.signal.throwIfAborted()
        if (entry.epoch !== epoch) return
        const value = await request({ ...scope, ...(cursor ? { cursor } : {}) }, lifetime.signal)
        if (lifetime.signal.aborted || entries.get(keyOf(scope)) !== entry || entry.epoch !== epoch) return
        if (value.roleId !== scope.roleId) throw new Error('Rabi persona binding changed. Check the Bot in Rabi connection before continuing.')
        if (cursor) entry.pages.push(value)
        else {
          // A changed first-page cursor invalidates the old continuation.
          const tail = entry.pages[0]?.nextCursor === value.nextCursor ? entry.pages.slice(1) : []
          entry.pages = [value, ...tail]
        }
        const items = new Map()
        for (const page of entry.pages) for (const item of page.items ?? []) items.set(item.id, item)
        const merged = { ...value, ...(Array.isArray(value.items) ? { items: [...items.values()], nextCursor: entry.pages.at(-1).nextCursor } : {}) }
        entry.bytes = JSON.stringify(merged).length * 2
        entry.snapshot = { value: merged, pending: false, error: null, updatedAt: Date.now() }
      } catch (error) {
        if (!lifetime.signal.aborted && entries.get(keyOf(scope)) === entry && entry.epoch === epoch) entry.snapshot = { ...entry.snapshot, pending: false, error }
      } finally {
        if (entry.epoch !== epoch) entry.snapshot = { ...entry.snapshot, pending: false }
        entry.promise = null; notify(entry); resolve(); prune()
      }
    })
    notify(entry); drain()
    return promise
  }
  return {
    selection(botId, roleId) { return selections.get(JSON.stringify([botId, roleId])) ?? { resource: 'memory', query: {} } },
    select(botId, roleId, value) {
      const key = JSON.stringify([botId, roleId]); selections.delete(key); selections.set(key, value)
      if (selections.size > capacity) selections.delete(selections.keys().next().value)
    },
    snapshot: scope => entryOf(scope).snapshot,
    subscribe(scope, listener) {
      const entry = entryOf(scope); entry.listeners.add(listener)
      return () => { entry.listeners.delete(listener); prune() }
    },
    visit: scope => load(scope), more: scope => load(scope, true),
    invalidateBot(botId) {
      for (const entry of entries.values()) if (entry.scope.botId === botId) {
        entry.epoch = (entry.epoch ?? 0) + 1
        entry.pages = []; entry.bytes = 0
        entry.snapshot = { value: null, pending: Boolean(entry.promise), error: null, updatedAt: null }
        notify(entry)
      }
    },
    dispose() { lifetime.abort(); entries.clear(); selections.clear() },
  }
}
