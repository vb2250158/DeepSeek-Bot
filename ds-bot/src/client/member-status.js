import { createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BotMark, toolState } from './mark.js'
import { Elapsed, Shimmer, workPhrase } from './cells.js'
import { elapsedLabel } from './text.js'
import { t, language } from './i18n.js'
import { SPRING_TAP, spring } from './motion.js'

// -------------------------------------------------------------------------
// What a group's members are doing: above the group's composer, a row for each member
// at work in this group and a line for those busy elsewhere or waiting for an approval;
// above a Bot's own composer, the groups it is at work in; and per member in the
// details panel, where the approvals their group turns wait on are answered.

const NO_WORK = { bots: {}, rooms: {}, approvals: [] }
const ROWS_MAX = 4

function useNow(active) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

const since = (now, at) => (typeof at === 'number' && now - at >= 60000 ? ` · ${elapsedLabel(now - at)}` : '')

// Work in this group wins over the Bot's own chat or another group.
export function memberWork(room, work = NO_WORK) {
  const here = work.rooms?.[room.id] ?? []
  return room.members.map((id) => {
    const approvals = (work.approvals ?? []).filter(entry => entry.botId === id)
    const local = here.find(entry => entry.botId === id)
    const doing = local ? { ...local, roomId: room.id } : work.bots?.[id]
    return { id, approvals, doing, here: local !== undefined, state: approvals.length > 0 ? 'ask' : doing ? 'work' : 'idle' }
  })
}

// The busy members, those waiting for an approval first.
export function busyMembers(room, work, roster) {
  const busy = memberWork(room, work).filter(entry => entry.state !== 'idle' && roster.byId[entry.id])
  return [...busy.filter(entry => entry.state === 'ask'), ...busy.filter(entry => entry.state === 'work')]
    .map(entry => ({ ...entry, bot: roster.byId[entry.id] }))
}

// Members at work in this group get a row of their own, apart from the round's current
// speaker, which its round shows; the rest go on the summary line.
export function splitBusy(busy) {
  const speaking = entry => entry.state === 'work' && entry.here && entry.doing.speaking === true
  const rows = busy.filter(entry => entry.state === 'work' && entry.here && !speaking(entry)).slice(0, ROWS_MAX)
  return { rows, rest: busy.filter(entry => !rows.includes(entry) && !speaking(entry)) }
}

// The groups a Bot is at work in.
export function botGroupWork(botId, work, roster) {
  return Object.entries(work.rooms ?? {}).flatMap(([roomId, entries]) => {
    const entry = entries.find(item => item.botId === botId)
    const room = roster.roomsById[roomId]
    return entry && room ? [{ room, doing: entry, since: entry.since }] : []
  })
}

export function summaryText(busy) {
  const asks = busy.filter(entry => entry.state === 'ask')
  const workers = busy.filter(entry => entry.state === 'work')
  const names = asks.slice(0, 2).map(entry => entry.bot.name)
  const waiting = asks.length === 0 ? ''
    : asks.length === 1 ? t('{name} is waiting for your approval', { name: names[0] })
      : asks.length === 2 ? t('{first} and {second} are waiting for your approval', { first: names[0], second: names[1] })
        : t('{first}, {second} and {count} more are waiting for your approval', { first: names[0], second: names[1], count: asks.length - 2, total: asks.length })
  const first = workers[0]
  const doing = first ? `${first.bot.name} · ${workPhrase(first.doing)}…${workers.length > 1 ? ` +${workers.length - 1}` : ''}` : ''
  return { waiting, doing }
}

function Face({ entry, size }) {
  return h('span', { className: 'bt-mw-face', 'data-ask': entry.state === 'ask' || undefined },
    h(BotMark, { bot: entry.bot, size, state: entry.state === 'ask' ? 'alert' : toolState(entry.doing?.tool ?? '') }))
}

// One piece of work: the Bot's mark and what it is doing, like the activity row.
function WorkRow({ bot, doing, label, at, now, onOpen }) {
  const text = `${label} · ${workPhrase(doing)}…`
  const elapsed = typeof at === 'number' && now - at >= 60000 ? elapsedLabel(now - at) : ''
  return h('button', { type: 'button', className: 'bt-mw-row', 'aria-label': [text, elapsed].filter(Boolean).join(' · '), title: text, onClick: onOpen },
    h(BotMark, { bot, size: 22, state: doing?.switching ? 'thinking' : toolState(doing?.tool ?? ''), live: true }),
    h('span', { className: 'bt-mw-row-text' }, h(Shimmer, null, text)),
    elapsed ? h('span', { className: 'bt-mw-row-time' }, `· ${elapsed}`) : null)
}

function SummaryLine({ busy, onOpen }) {
  const { waiting, doing } = summaryText(busy)
  return h('div', { className: 'bt-event bt-mw-dock' },
    h('button', { type: 'button', className: 'bt-event-whole bt-mw-line', 'aria-label': [waiting, doing].filter(Boolean).join(' · '), onClick: onOpen },
      h('span', { className: 'bt-mw-stack', 'aria-hidden': true }, busy.slice(0, 4).map(entry => h(Face, { key: entry.id, entry, size: 16 }))),
      waiting ? h('span', { className: 'bt-mw-ask' }, waiting) : null,
      waiting && doing ? h('span', { 'aria-hidden': true }, '·') : null,
      doing ? h('span', { className: 'bt-event-name' }, h(Shimmer, null, doing)) : null))
}

/** Active members in this group, including its current speaker; approvals stay separate. */
export function groupWorkingText(busy) {
  const names = [...new Set(busy.filter(entry => entry.here && entry.state === 'work').map(entry => entry.bot.name))]
  if (!names.length) return ''
  const joined = new Intl.ListFormat(language(), { style: 'long', type: 'conjunction' }).format(names)
  return t('{names} working…', { names: joined })
}

// Above a group's composer: who is at work here, and a line for the rest; both open the
// details panel. Above a Bot's own composer: the groups it is at work in, while its own
// chat is idle (a running own chat has its activity row).
export function MemberDock({ sessionId, useRoster, useWork, actions }) {
  const roster = useRoster(value => value)
  const work = useWork(value => value)
  const room = roster.roomsById[sessionId]
  const bot = room ? undefined : roster.byId[sessionId]
  const ownChat = bot !== undefined && work.bots?.[bot.id] !== undefined && work.bots[bot.id].roomId === undefined
  const busy = room ? busyMembers(room, work, roster) : []
  const groups = bot !== undefined && !ownChat ? botGroupWork(bot.id, work, roster) : []
  const shown = busy.length > 0 || groups.length > 0
  const now = useNow(shown)
  const ref = useRef(null)
  useFlowColumn(ref, shown, sessionId)
  if (!shown) return null
  if (room) {
    const text = groupWorkingText(busy)
    const rest = busy.filter(entry => !entry.here || entry.state !== 'work')
    const open = () => actions.showDetails(sessionId)
    return h('div', { ref, className: 'bt-mw-dock-stack' },
      text ? h('div', { className: 'bt-mw-row', role: 'status', 'aria-label': text, 'aria-live': 'polite', 'aria-atomic': true },
        h('span', { className: 'bt-mw-stack', 'aria-hidden': true }, busy.filter(entry => entry.here && entry.state === 'work').slice(0, ROWS_MAX).map(entry => h(Face, { key: entry.id, entry, size: 20 }))),
        h('span', { className: 'bt-mw-row-text', title: text }, h(Shimmer, null, text))) : null,
      rest.length > 0 ? h(SummaryLine, { busy: rest, onOpen: open }) : null)
  }
  return h('div', { ref, className: 'bt-mw-dock-stack' }, groups.slice(0, ROWS_MAX).map(item => h(WorkRow, {
    key: item.room.id, bot, doing: item.doing, label: t('in {name}', { name: item.room.name }), at: item.since, now, onOpen: () => actions.openSession(item.room.id),
  })))
}

// The rows line up with the transcript's column, whose width and gutters are the shell's.
// Without a transcript the stylesheet's centered column stands.
function useFlowColumn(ref, active, key) {
  useLayoutEffect(() => {
    const node = ref.current
    const flow = document.querySelector('[data-chat-flow]')
    if (!active || !node || !flow) return undefined
    const place = () => {
      node.style.marginInlineStart = '0px'
      const column = flow.getBoundingClientRect()
      node.style.marginInlineStart = `${Math.round(column.left - node.getBoundingClientRect().left)}px`
      node.style.width = `${Math.round(column.width)}px`
    }
    place()
    const observer = new ResizeObserver(place)
    // The column is centered in its scroller, so it moves without resizing when the
    // scroller or the rows' own container changes width.
    for (const target of [flow, flow.parentElement, node.parentElement]) if (target) observer.observe(target)
    return () => observer.disconnect()
  }, [active, key])
}

// The clock stays whole at the end; only what comes before it is cut.
const stateLine = (className, at, ...what) => h('span', { className },
  h('span', { className: 'bt-member-what' }, ...what),
  typeof at === 'number' ? h(Elapsed, { at, className: 'bt-member-time' }) : null)

function ApprovalCard({ approval, bot, actions }) {
  const [busy, setBusy] = useState(false)
  const answer = (choice) => {
    setBusy(true)
    void Promise.resolve(actions.answerApproval(approval.id, choice))
      .catch(error => actions.reportError(error, 'approval'))
      .finally(() => setBusy(false))
  }
  return h('div', { className: 'bt-mw-card', role: 'group', 'aria-label': t('{name} is waiting for your approval', { name: bot.name }) },
    h('div', { className: 'bt-mw-tool' }, approval.tool),
    approval.detail?.text ? h('div', { className: 'bt-mw-text' }, approval.detail.text) : null,
    approval.reason ? h('div', { className: 'bt-mw-reason' }, approval.reason) : null,
    approval.detail?.code ? h('code', { className: 'bt-mw-code', title: approval.detail.code }, approval.detail.code) : null,
    approval.answerable
      ? h('div', { className: 'bt-mw-actions' },
        h('button', { type: 'button', className: 'bt-q-btn', disabled: busy, onClick: () => answer('reject') }, t('Reject')),
        h('button', { type: 'button', className: 'bt-q-submit', disabled: busy, onClick: () => answer('allow') }, t('Allow once')))
      : h('div', { className: 'bt-mw-actions' },
        h('button', { type: 'button', className: 'bt-q-btn', onClick: () => actions.openSession(bot.id) }, t("Open {name}'s chat", { name: bot.name }))))
}

// Under a member's row in the group's details: what it is doing, and where. Work in
// this group can be stopped here, since the user cannot reach its Session otherwise.
export function MemberWork({ entry, bot, room, roster, actions, now }) {
  const [stopping, setStopping] = useState(false)
  if (entry.state === 'ask') {
    return h('div', { className: 'bt-mw-member' },
      h('div', { className: 'bt-mw-state bt-mw-ask' }, `${t('Waiting for your approval')}${since(now, entry.approvals[0].at)}`),
      entry.approvals.map(approval => h(ApprovalCard, { key: approval.id, approval, bot, actions })))
  }
  if (entry.state !== 'work') return null
  const where = entry.doing.roomId === room.id ? ''
    : entry.doing.roomId ? t('in {name}', { name: roster.roomsById[entry.doing.roomId]?.name ?? t('a group chat') })
      : t('in its own chat')
  const stop = () => {
    setStopping(true)
    void Promise.resolve(actions.stopMemberWork(room.id, bot.id))
      .catch(error => actions.reportError(error, 'stop'))
      .finally(() => setStopping(false))
  }
  return h('div', { className: 'bt-mw-member' },
    h('div', { className: 'bt-mw-state bt-mw-work' },
      h('span', null, h(Shimmer, null, `${workPhrase(entry.doing)}…`), where ? ` ${where}` : '', since(now, entry.doing.since)),
      entry.here ? h('button', { type: 'button', className: 'bt-mw-stop', disabled: stopping, onClick: stop }, t('Stop')) : null))
}

export function useMemberWork(room, useWork) {
  const work = useWork?.(value => value) ?? NO_WORK
  const entries = room ? memberWork(room, work) : []
  const now = useNow(entries.some(entry => entry.state !== 'idle'))
  return { entries, now }
}

export const workState = doing => (doing?.switching ? 'thinking' : toolState(doing?.tool ?? ''))

export function MemberState({ entry, bot, room, roster }) {
  if (entry?.state === 'ask') return stateLine('bt-member-state bt-mw-ask', entry.approvals[0].at, t('Waiting for your approval'))
  if (entry?.state !== 'work') return bot.role ? h('span', { className: 'bt-member-state' }, bot.role) : null
  const where = entry.doing.roomId === room.id ? ''
    : entry.doing.roomId ? t('in {name}', { name: roster.roomsById[entry.doing.roomId]?.name ?? t('a group chat') })
      : t('in its own chat')
  return stateLine('bt-member-state', entry.doing.since, h(Shimmer, null, `${workPhrase(entry.doing)}…`), where ? ` ${where}` : '')
}

// Work in this group can be stopped from its details, since the user cannot reach the
// member's group Session otherwise; a turn waiting for an approval still holds its work.
export function StopMemberWork({ entry, bot, room, actions }) {
  const [stopping, setStopping] = useState(false)
  if (!entry?.here || (entry.state !== 'work' && entry.state !== 'ask')) return null
  const stop = () => {
    setStopping(true)
    void Promise.resolve(actions.stopMemberWork(room.id, bot.id))
      .catch(error => actions.reportError(error, 'stop'))
      .finally(() => setStopping(false))
  }
  return h('button', { type: 'button', className: 'bt-member-stop', disabled: stopping, 'aria-label': `${t('Stop')} · ${bot.name}`, onClick: stop }, t('Stop'))
}

export function MemberApprovals({ entry, bot, actions }) {
  if (entry?.state !== 'ask') return null
  return h('div', { className: 'bt-member-cards' }, entry.approvals.map(approval => h(ApprovalCard, { key: approval.id, approval, bot, actions })))
}

export const MEMBER_CSS = `
.bt-mw-dock-stack{box-sizing:border-box;display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:var(--dsh-chat-content-width,min(960px,100%));margin:0 auto 6px;pointer-events:none}
.bt-mw-dock-stack>.bt-event.bt-mw-dock{align-self:stretch;margin:0}
.bt-mw-row{pointer-events:auto;display:flex;align-items:center;gap:10px;min-width:0;max-width:calc(100% + 6px);height:32px;margin-inline-start:-6px;padding:0 12px 0 6px;border:0;border-radius:16px;background:none;color:var(--bt-ink-2);font:inherit;font-size:14px;cursor:pointer;animation:bt-mw-in .32s cubic-bezier(.23,1,.32,1) backwards;transition:background-color .16s ease-out}
.bt-mw-row:hover{background:var(--bt-hover)}
.bt-mw-row>.bt-mark{flex:none}
.bt-mw-row-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-mw-row-time{flex:none;font-size:12px;color:var(--bt-ink-3);white-space:nowrap}
.bt-mw-work{display:flex;align-items:center;justify-content:space-between;gap:8px}
.bt-mw-stop{flex:none;height:22px;padding:0 10px;border:1px solid var(--bt-line,rgba(0,0,0,.12));border-radius:12px;background:none;color:var(--bt-ink-2);font:inherit;font-size:12px;cursor:pointer}
.bt-mw-stop:hover{background:var(--bt-hover)}
.bt-mw-stop:disabled{opacity:.5;cursor:default}
.bt-event.bt-mw-dock{margin:0 0 6px;pointer-events:none}
.bt-mw-dock>button{pointer-events:auto;animation:bt-mw-in .32s cubic-bezier(.23,1,.32,1) backwards}
.bt-mw-line{gap:6px!important}
.bt-mw-stack{display:inline-flex;align-items:center;flex:none;line-height:0}
.bt-mw-stack>*+*{margin-left:-4px}
.bt-mw-face{position:relative;display:inline-flex;flex:none;border-radius:50%}
.bt-mw-stack .bt-mw-face{box-shadow:0 0 0 1.5px var(--bt-main)}
.bt-mw-face[data-ask]::after{content:"";position:absolute;right:-2px;bottom:-2px;width:7px;height:7px;border-radius:50%;background:#e3a008;box-shadow:0 0 0 1.5px var(--bt-main)}
.bt-mw-ask{color:#b7791f;flex:none;white-space:nowrap}
body[data-ds-dark-theme] .bt-mw-ask{color:#f0b84a}
.bt-mw-member{padding:0 6px 8px 42px;display:flex;flex-direction:column;gap:6px}
.bt-mw-state{font-size:12px;line-height:16px;color:var(--bt-ink-2);margin-top:-4px}
.bt-mw-card{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:12px;background:var(--bt-hover);font-size:12px;line-height:17px;color:var(--bt-ink-2)}
@keyframes bt-mw-in{from{transform:translateY(8px) scale(.94)}}
@keyframes bt-mw-out{to{opacity:0;transform:translateY(6px) scale(.96);filter:blur(3px)}}
@keyframes bt-mw-seat{from{opacity:0;scale:.6}}
@keyframes bt-mw-swap{from{opacity:0;filter:blur(4px)}}
.bt-members{display:flex;flex-direction:column;gap:2px;margin:0 -8px}
.bt-member{display:flex;flex-direction:column;border-radius:12px;animation:bt-rise .18s ease-out backwards}
.bt-member-row{display:flex;align-items:center;gap:8px;min-height:48px;padding:0 8px;border-radius:12px;transition:background-color .12s ease}
.bt-member-row:hover{background:var(--bt-hover)}
.bt-member-open{flex:1;min-width:0;display:flex;align-items:center;gap:10px;padding:8px 0;border:0;background:none;color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer}
.bt-member-open>.bt-mark{flex:none}
.bt-member-text{display:flex;flex-direction:column;min-width:0;gap:1px}
.bt-member-line{display:flex;align-items:center;gap:6px;min-width:0}
.bt-member-name{min-width:0;font-size:14px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-member-line>.bt-tag{font-size:11px;line-height:15px;padding:0 5px}
.bt-member-state{display:flex;min-width:0;font-size:12px;line-height:16px;color:var(--bt-ink-3);white-space:nowrap}
.bt-member-what{min-width:0;overflow:hidden;text-overflow:ellipsis}
.bt-member-time{flex:none;margin-left:.3em;font-variant-numeric:tabular-nums}
.bt-member-state.bt-mw-ask{color:#b7791f}
body[data-ds-dark-theme] .bt-member-state.bt-mw-ask{color:#f0b84a}
.bt-member-stop{flex:none;height:26px;padding:0 11px;border:0;border-radius:13px;background:var(--bt-main);box-shadow:inset 0 0 0 .5px var(--bt-line-2);color:var(--bt-ink-2);font:inherit;font-size:12px;cursor:pointer;transition:background-color .12s ease,color .12s ease,${spring(SPRING_TAP, 'scale')}}
.bt-member-stop:hover{background:var(--bt-active);color:var(--bt-ink)}
.bt-member-stop:active:not(:disabled){scale:.94}
.bt-member-stop:disabled{opacity:.5;cursor:default}
.bt-member-cards{display:flex;flex-direction:column;gap:6px;padding:2px 8px 8px 50px}
.bt-mw-card{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:12px;background:var(--bt-hover);font-size:12px;line-height:17px;color:var(--bt-ink-2);animation:bt-rise .2s ease-out backwards}
.bt-mw-tool{font-weight:600;color:var(--bt-ink)}
.bt-mw-text{color:var(--bt-ink);overflow-wrap:anywhere}
.bt-mw-reason{overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.bt-mw-code{display:block;font:11px/16px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--bt-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-mw-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:4px}
.bt-mw-actions>button{height:28px;padding:0 12px;font-size:12px}
.bt-mw-actions>button:disabled{opacity:.5;cursor:default}
@keyframes bt-mw-in{from{opacity:0;transform:translateY(4px)}}
@media (prefers-reduced-motion:reduce){.bt-mw-dock>button,.bt-mw-row{animation:none}}
`
