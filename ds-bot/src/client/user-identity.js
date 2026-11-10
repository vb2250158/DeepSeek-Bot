// Who writes on the right. The shell's account plugin already knows the signed-in
// DeepSeek account, and DS Bot reads it the way its model menu does: through the
// sign-in slot entry's `account` hook. No new coupling, and nothing renders while the
// account plugin is absent.
import { createElement as h, useMemo, useSyncExternalStore } from 'react'
import { userIdentityOf } from './user-name.js'
import { DshMark } from './dsh-mark.js'

const NO_SUBSCRIBE = () => () => {}
const NO_SNAPSHOT = () => null

/** @param actions - DS Bot actions, whose `signInEntry` names the shell's sign-in entry. */
function useAccountSnapshot(actions) {
  const entry = actions?.signInEntry?.() ?? null
  const ops = useMemo(() => entry?.inject?.() ?? {}, [entry])
  const source = ops.hooks?.account
  const read = source === undefined ? NO_SNAPSHOT : () => source.getSnapshot() ?? null
  return useSyncExternalStore(source?.subscribe ?? NO_SUBSCRIBE, read, read)
}

/** The head over the user's own bubbles: the name, and the account picture or DSH's mark. */
export function UserHead({ actions }) {
  const identity = userIdentityOf(useAccountSnapshot(actions))
  return h('div', { className: 'bt-uhead' },
    h('span', { className: 'bt-uname', title: identity.name }, identity.name),
    h('span', { className: 'bt-uavatar', 'aria-hidden': true },
      identity.picture === undefined ? h(DshMark, { size: 22 }) : h('img', { src: identity.picture, alt: '' })))
}

/**
 * The row that draws the user's own message is not always DS Bot's: where another
 * plugin takes the user node, this publishes the head for it to place. Identity,
 * markup and the bubble inset stay here; a plain DSH Session answers null, so that
 * row keeps exactly what the shell draws.
 * @param options - DS Bot's actions and roster source.
 * @returns disposer that withdraws the contract.
 */
export function publishUserHead({ actions, roster }) {
  const head = (sessionId) => {
    const snapshot = roster.getSnapshot()
    if (snapshot.roomsById?.[sessionId] === undefined && snapshot.byId?.[sessionId] === undefined) return null
    return h(UserHead, { actions })
  }
  globalThis.__dshBotUserHead = head
  return () => { if (globalThis.__dshBotUserHead === head) delete globalThis.__dshBotUserHead }
}
