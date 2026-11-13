// -------------------------------------------------------------------------
// Small observable sources for the inject `hooks` compartment.

export function createSource(initial) {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(next) {
      const resolved = typeof next === 'function' ? next(value) : next
      if (resolved === value) return
      value = resolved
      for (const listener of [...listeners]) listener()
    },
  }
}

export const EMPTY_ROSTER = { revision: -1, mainBotId: null, mainBotIds: [], bots: [], rooms: [], agents: [], sections: [], exchangeTurns: {}, questions: {}, btwCards: {}, sideChats: {}, learning: {}, secrets: [], capabilities: [], capabilityStatuses: {}, phone: null, secretRequests: {}, models: [], defaultModel: null, modelsKey: null, prefs: {}, byId: {}, roomsById: {}, agentsById: {}, agentOf: {}, ready: false }
// Any Main Bot holds the Main Bot powers; `mainBotId`, the first one, is the sidebar tile.
export const isMainOf = (roster, id) => id !== undefined && (roster.mainBotIds ?? []).includes(id)

// What the Bot surface shows when it takes the main view: a Bot or group chat already
// there stays, and anything else — an archived Session, a DSH Agent Session, or nothing —
// gives way to the Bot this browser showed last, then to the Main Bot. Without this the
// panel opens on whatever the shell restored, which for an archived Session is a blank
// page with no Bot selected anywhere.
export function botSurfaceTarget(roster, mainSessionId, remembered) {
  if (mainSessionId !== undefined && (roster.byId[mainSessionId] !== undefined || roster.roomsById[mainSessionId] !== undefined)) return {}
  const rememberedBot = remembered === undefined ? undefined : roster.byId[remembered]
  const target = rememberedBot?.id ?? roster.mainBotId
  return typeof target === 'string' && target !== '' ? { open: target } : {}
}

// A Bot's chat is a chain of Sessions ("parts"): the Bot id is its first part's id
// and `sessionId` its current one. Every part id finds the Bot; Session state
// (running, unread, turns) is read from the current part, team state from the Bot id.
export function indexRoster(value) {
  const byId = {}
  for (const bot of value.bots) {
    for (const id of [...(bot.parts ?? []), bot.sessionId ?? bot.id, bot.id]) byId[id] = bot
  }
  const roomsById = {}
  // A group's own Session is a chain of parts like a Bot's chat: `room.id` is its
  // first part's id and `sessionId` its current one; every part id finds the room.
  for (const room of value.rooms) {
    for (const id of [room.id, room.sessionId, ...(room.ownParts ?? [])]) roomsById[id] = room
  }
  // The DSH Agent is not a Bot: it indexes by its own id and by each Session it owns.
  const agentsById = {}
  const agentOf = {}
  for (const agent of value.agents ?? []) {
    agentsById[agent.id] = agent
    for (const sessionId of agent.sessions ?? []) agentOf[sessionId] = agent.id
  }
  return { ...value, agents: value.agents ?? [], sections: value.sections ?? [], byId, roomsById, agentsById, agentOf, ready: true }
}

// Whether a main-view Session id belongs to the team's DSH Agent: the conversation
// group then stays withdrawn while the shell keeps the sidebar. Before the roster
// arrives, the ids cached from the last pull answer.
export function isAgentSession(roster, cache, sessionId) {
  if (sessionId === undefined || sessionId === null || sessionId === '') return false
  if (roster.ready) return roster.agentOf[sessionId] !== undefined
  return cache.has(sessionId)
}

// A request can reuse a call id; question and secret ids belong to separate kinds.
export const heldCardKey = (kind, requestId) => JSON.stringify([kind, requestId])

// Per Session, how many mounted cells draw or hold each card; 0 drops the entry.
export function countCards(state, sessionId, callIds, delta) {
  const own = { ...state[sessionId] }
  for (const callId of callIds) {
    const count = (own[callId] ?? 0) + delta
    if (count > 0) own[callId] = count
    else delete own[callId]
  }
  return { ...state, [sessionId]: own }
}
