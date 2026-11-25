import { createElement as h, Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { TeamSidebar, BotSettingsLauncher } from './sidebar.js'
import { DetailsDrawer } from './details-drawer.js'
import { ActivityIndicator } from './activity-row.js'
import { GoalIsland, goalView } from './goal.js'
import { FishLogo } from './dsh-primitives.js'
import { t } from './i18n.js'
import { ColumnResizer, useColumnWidth } from './column-resizer.js'
import { PanelMenu } from './browser-pane.js'

export const BOT_PANEL = 'ds-bot'

export function BotPanelIcon({ size = 18 }) {
  return h(FishLogo, { size })
}

export function BotChatLauncher({ actions }) {
  return h('button', {
    type: 'button', className: 'bt-chat-tab', 'data-bot-chat-launcher': '',
    onClick: () => actions.selectPanel(BOT_PANEL),
  }, t('Bot chat'))
}

function BotChatViews({ renderSlot }) {
  return renderSlot('conversation.session', { view: 'chat' })
}

const BOT_CHAT_SLOTS = { views: BotChatViews }
const emptyViews = select => select([])
const noEntryActions = select => select(false)
const noIcon = () => null

export function BotChatTabs(props) {
  return props.selectView ? h(ConversationTabs, props) : null
}

function ConversationTabs({ actions, useStore, useConversationViews = emptyViews, useEntryPins = emptyViews, useEntryActions = noEntryActions, selectView }) {
  const views = useConversationViews(value => value)
  const unpinned = useEntryPins(value => value)
  const hasMenu = useEntryActions(value => value)
  const row = useRef(null)
  const request = useStore(value => value.viewRequest)
  const previousRequest = useRef(request)
  const [limit, setLimit] = useState(1)
  useEffect(() => {
    // In-chat inspection requests carry a focus target that the native View consumes.
    if (request && request !== previousRequest.current && request.view !== 'chat') actions.selectPanel(null)
    previousRequest.current = request
  }, [request, actions])
  useLayoutEffect(() => {
    const element = row.current
    const measure = () => setLimit(Math.max(1, Math.floor((element.clientWidth - 110) / 120)))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const preferred = [
    ...views.filter(view => view.id === 'chat'),
    ...views.filter(view => view.id !== 'chat' && !unpinned.includes(view.id)),
  ]
  const visible = hasMenu ? preferred.slice(0, limit) : preferred
  const hidden = hasMenu ? views.filter(view => !visible.includes(view)) : []
  const open = (id) => {
    selectView(id)
    actions.selectPanel(null)
  }
  return h('div', { className: 'bt-chat-tabs', ref: row },
    h('div', { className: 'bt-chat-tab-list', role: 'tablist', 'aria-label': t('Bot chat') },
      h('button', { type: 'button', role: 'tab', className: 'bt-chat-tab', 'aria-selected': true }, t('Bot chat')),
      visible.map(view => h('button', {
        key: view.id, type: 'button', role: 'tab', className: 'bt-chat-tab', 'aria-selected': false,
        onClick: () => open(view.id),
      }, view.label))),
    h(PanelMenu, {
      items: hidden.map(view => ({ key: view.id, icon: noIcon, label: view.label, onPick: () => open(view.id) })),
      className: 'bt-chat-tab bt-chat-tab-more', 'aria-label': t('More'),
    }))
}

export function BotWorkbench({ renderSlot }) {
  return h('div', { className: 'bt-workbench', 'data-dsh-private-ui': 'ds-bot' },
    renderSlot('bot.team', {}), renderSlot('bot.conversation', {}))
}

export function BotTeam(props) {
  const [width, onChange] = useColumnWidth('team')
  return h('aside', { className: 'bt-team-column', 'aria-label': t('DS Bot'), style: { '--bt-team-width': `${width}px` } },
    h(TeamSidebar, { ...props, wide: true }),
    h('div', { className: 'bt-team-footer' },
      h(BotSettingsLauncher, { ...props, seat: false })),
    h(ColumnResizer, { side: 'team', width, onChange }))
}

export function BotConversation(props) {
  const { sessionId, renderFactorySlot, renderSlot, useRoster, useUi, actions } = props
  const roster = useRoster(value => value)
  const ui = useUi(value => value)
  const [width, onChange] = useColumnWidth('details')
  // The column's own width, published as a token: a renderer inside it can then cap
  // itself against the column instead of against an ancestor it just widened.
  const chatRef = useRef(null)
  useEffect(() => {
    const element = chatRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return undefined
    const apply = () => document.documentElement.style.setProperty('--bt-chat-w', `${Math.round(element.clientWidth)}px`)
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const owner = roster.byId[sessionId] ?? Object.values(roster.byId).find(bot => bot.sessionId === sessionId)
  const room = roster.roomsById[owner?.id ?? sessionId]
  const id = owner?.id ?? room?.id ?? sessionId
  const goal = room?.goal
  const composing = room !== undefined && ui.goalCompose === id
  const showGoal = room !== undefined && (goal !== undefined || composing)
  const workKey = props.useWork?.(work => room ? JSON.stringify(work.rooms?.[id] ?? []) : '') ?? ''
  const roomWork = workKey ? JSON.parse(workKey) : []
  const view = goal ? goalView(goal, { roster, roomWork }) : null
  const known = owner !== undefined || room !== undefined
  const name = owner?.name ?? room?.name
  useEffect(() => {
    if (sessionId === undefined) return undefined
    actions.beginVisit(sessionId)
    return () => actions.endVisit(sessionId)
  }, [sessionId, actions])
  return h(Fragment, null,
    h('section', { ref: chatRef, className: 'bt-chat-column', 'aria-label': t('Message'), style: { '--bt-placeholder': JSON.stringify(name ? t('Message {name}', { name }) : t('Message')) } },
      known ? renderSlot('bot.conversation.tabs', {}) : null,
      ...(showGoal ? [h(GoalIsland, { key: `goal:${room.id}`, room, goal, view, open: ui.goalOpen === id, composing, roomWork, roster, actions })] : []),
      h(Fragment, { key: 'conversation' }, renderFactorySlot('conversation.content',
        { variant: 'embedded', phase: 'active', hero: false, ...(known ? { busyEnterOverride: 'steer' } : {}) },
        known ? { slots: BOT_CHAT_SLOTS } : undefined)),
      known ? h(ActivityIndicator, { ...props, key: `activity:${sessionId}`, sessionId }) : null),
    known ? h('aside', { className: 'bt-info-column', 'aria-label': t('View conversation details'), style: { '--bt-details-width': `${width}px` } },
      h(DetailsDrawer, { ...props, key: `${id}:${ui.details === id && ui.renaming ? 'rename' : ''}:${ui.details === id ? ui.tab ?? '' : ''}`, sessionId: id, roster, hasStrip: true, compact: true,
        startRenaming: ui.details === id && ui.renaming, startTab: ui.details === id ? ui.tab : null,
        actions: { ...actions, closeDetails: () => actions.closeDetails() } }),
      h(ColumnResizer, { side: 'details', width, onChange })) : null)
}

export const BOT_CHAT_TABS_CSS = `
.bt-chat-tab{position:relative;box-sizing:border-box;min-height:35px;margin:-10px -10px 0;padding:10px 10px 9px;border:0;background:transparent;font:500 13px/16px var(--dsw-font-family,inherit);color:var(--dsw-alias-label-tertiary);white-space:nowrap;cursor:pointer}
.bt-chat-tab:is(:hover,:focus-visible){color:var(--dsw-alias-label-primary)}
.bt-chat-tab[aria-selected=true]{color:var(--dsw-alias-state-business-primary)}
.bt-chat-tab[aria-selected=true]::after{content:'';position:absolute;inset:auto 10px -1px;height:2px;border-radius:2px;background:currentColor}
[data-conversation-header-leading] [data-bot-chat-launcher]{margin:0 8px 0 0;padding:5px 8px;min-height:30px}
header:has([data-bot-chat-launcher]):has([data-conversation-tabs]) [data-conversation-header-leading]{grid-row:2;align-self:start;margin:10px 24px 0 8px}
header:has([data-conversation-tabs]) [data-conversation-header-leading] [data-bot-chat-launcher]{margin:-10px -10px 0;padding:10px 10px 9px;min-height:35px}
header:has(> [data-conversation-header-leading] [data-bot-chat-launcher]) :has(> [data-conversation-tabs]){grid-row:2;grid-column:2}
header:has([data-bot-chat-launcher]):has([data-conversation-tabs]) :has(> [data-conversation-header-corner]){grid-row:1;grid-column:1/-1}
.bt-chat-tabs{display:flex;flex:none;align-items:flex-start;gap:20px;min-width:0;padding:12px 28px 0;border-bottom:.5px solid var(--dsw-alias-border-l3)}
.bt-chat-tab-list{display:flex;flex-wrap:wrap;gap:12px 32px;min-width:0;min-height:25px}
.bt-chat-tab-more{display:grid;place-items:center}
`

export const WORKBENCH_CSS = `
.bt-workbench{display:flex;position:relative;container-type:inline-size;height:100%;min-height:0;min-width:0;overflow:hidden;background:var(--bt-main);color:var(--bt-ink)}
.bt-team-column{display:flex;position:relative;box-sizing:border-box;flex-direction:column;flex:0 1 var(--bt-team-width,280px);min-width:200px;max-width:520px;min-height:0;border-right:.5px solid var(--bt-line);background:var(--bt-sidebar)}
.bt-team-column>.bt-side{padding:6px 10px 8px;min-width:0}
.bt-team-column .bt-side-top{padding:4px 2px 12px;min-height:36px}
.bt-team-column .bt-side-top>.bt-brand{display:none}
.bt-team-column .bt-round{width:36px;height:36px;background:var(--bt-hover)}
.bt-group-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 4px;padding:8px 0 18px;max-height:240px;overflow:auto}
.bt-group-tile{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0;border:0;border-radius:10px;background:transparent;color:inherit;padding:6px;cursor:pointer}
.bt-group-tile:hover{background:var(--bt-hover)}
.bt-group-tile>span:last-child{font-size:12px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-team-column .bt-row-role{min-width:0;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;color:var(--bt-ink-2);background:var(--bt-tag-bg);border-radius:4px;padding:0 4px}
.bt-team-column .bt-row{min-height:58px}
.bt-team-footer{display:flex;align-items:center;gap:8px;padding:8px 12px 12px}
.bt-team-footer .bt-account{width:100%}
.bt-chat-column{display:flex;flex:1;flex-direction:column;position:relative;min-width:320px;min-height:0;overflow:hidden;background:var(--bt-main)}
.bt-chat-column>.bt-island{flex:none;align-self:stretch;width:auto;margin:8px 16px 0;max-height:45%;overflow:auto;background:var(--bt-card);border-color:var(--bt-line);box-shadow:none}
.bt-chat-column [class*="_composerSeat"]{margin-top:auto}
.bt-chat-column [data-conversation-scroll]{padding-top:32px!important}
.bt-info-column{display:flex;position:relative;box-sizing:border-box;flex:0 1 var(--bt-details-width,320px);min-width:240px;max-width:520px;flex-direction:column;min-height:0;border-left:.5px solid var(--bt-line);background:var(--bt-main)}
.bt-column-resizer{position:absolute;z-index:5;top:0;bottom:0;right:0;width:6px;cursor:col-resize;touch-action:none;user-select:none;outline:none}
.bt-column-resizer[data-side=details]{left:0;right:auto}
.bt-column-resizer:hover,.bt-column-resizer:focus-visible{background:var(--bt-accent)}
.bt-info-column>.bt-drawer-top{min-height:32px;box-sizing:border-box}
.bt-workbench [data-slot="conversation.input.permission"],.bt-workbench [data-slot="conversation.input.model"]{display:none}
/* A message row follows the chat column, never its own content: a long reply used to
   widen its ancestors and slide under the detail panel on the right. Each level is
   pinned to the column so a renderer cannot grow the chain from the inside. */
.bt-chat-column [data-conversation-scroll],.bt-chat-column [data-conversation-scroll]>*{max-width:100%;min-width:0}
.bt-chat-column [data-chat-flow],.bt-chat-column [data-chat-flow]>*{width:100%;max-width:100%;min-width:0;box-sizing:border-box}
[data-rabi-message]{width:100%;max-width:var(--bt-chat-w,100%)}
/* Absolute caps against the column, for bubbles whose ancestors grew first. */
.bt-bubble{max-width:min(calc(var(--bt-msg-w) * 100%),calc(var(--bt-chat-w,100vw) - 46px))}

@container(max-width:760px){.bt-info-column{display:none}}
@container(max-width:600px){.bt-team-column{flex:0 0 72px;min-width:72px}.bt-chat-column{min-width:0}.bt-team-column .bt-row-body,.bt-team-column .bt-tile-name,.bt-team-column .bt-side-top,.bt-team-footer,.bt-column-resizer{display:none}.bt-team-column .bt-row{justify-content:center;padding:8px 0}.bt-team-column .bt-tile{width:48px;padding:6px 0}.bt-team-column>.bt-side{padding:8px 4px}}
`
