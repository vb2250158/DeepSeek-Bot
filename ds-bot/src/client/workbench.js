import { createElement as h, Fragment, useEffect } from 'react'
import { TeamSidebar, AccountLauncher, ConnectPlugins } from './sidebar.js'
import { DetailsDrawer } from './details-drawer.js'
import { BotMark } from './mark.js'
import { MAIN_LOOK } from './characters.js'
import { t } from './i18n.js'

export const BOT_PANEL = 'ds-bot'

export function BotPanelIcon({ size = 18 }) {
  return h(BotMark, { look: MAIN_LOOK, size })
}

export function BotWorkbench({ renderSlot }) {
  return h('div', { className: 'bt-workbench', 'data-dsh-private-ui': 'ds-bot' },
    renderSlot('bot.team', {}), renderSlot('bot.conversation', {}))
}

export function BotTeam(props) {
  return h('aside', { className: 'bt-team-column', 'aria-label': t('DS Bot') },
    h(TeamSidebar, { ...props, wide: true, compactMain: true, groupTiles: true }),
    h('div', { className: 'bt-team-footer' },
      h(AccountLauncher, { ...props, seat: false }), h(ConnectPlugins, { ...props, wide: true })))
}

export function BotConversation(props) {
  const { sessionId, renderFactorySlot, useRoster, useUi, actions } = props
  const roster = useRoster(value => value)
  const ui = useUi(value => value)
  const owner = roster.byId[sessionId] ?? Object.values(roster.byId).find(bot => bot.sessionId === sessionId)
  const id = owner?.id ?? sessionId
  const room = roster.roomsById[id]
  const known = owner !== undefined || room !== undefined
  const name = owner?.name ?? room?.name
  useEffect(() => {
    if (sessionId === undefined) return undefined
    actions.beginVisit(sessionId)
    return () => actions.endVisit(sessionId)
  }, [sessionId, actions])
  return h(Fragment, null,
    h('section', { className: 'bt-chat-column', 'aria-label': t('Message'), style: { '--bt-placeholder': JSON.stringify(name ? t('Message {name}', { name }) : t('Message')) } },
      renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false })),
    known ? h('aside', { className: 'bt-info-column', 'aria-label': t('View conversation details') },
      h(DetailsDrawer, { ...props, sessionId: id, roster, hasStrip: true, compact: true,
        startRenaming: ui.details === id && ui.renaming, startTab: ui.details === id ? ui.tab : null,
        actions: { ...actions, closeDetails: () => actions.closeDetails() } })) : null)
}

export const WORKBENCH_CSS = `
.bt-workbench{display:flex;position:relative;height:100%;min-height:0;min-width:0;overflow:hidden;background:var(--bt-main);color:var(--bt-ink)}
.bt-team-column{display:flex;flex-direction:column;flex:0 0 280px;min-height:0;border-right:.5px solid var(--bt-line);background:var(--bt-sidebar)}
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
.bt-team-footer>.bt-connect-wrap{flex:1;min-width:0}
.bt-chat-column{display:flex;flex:1;flex-direction:column;position:relative;min-width:0;min-height:0;background:var(--bt-main)}
.bt-chat-column [class*="_composerSeat"]{margin-top:auto}
.bt-chat-column [data-conversation-scroll]{padding-top:32px!important}
.bt-info-column{display:flex;flex:0 0 320px;flex-direction:column;min-height:0;overflow:auto;border-left:.5px solid var(--bt-line);background:var(--bt-main)}
.bt-info-column>.bt-drawer-top{min-height:44px;box-sizing:border-box}
.bt-workbench [data-slot="conversation.input.permission"],.bt-workbench [data-slot="conversation.input.model"]{display:none}
@media(max-width:1200px){.bt-team-column{flex-basis:250px}.bt-info-column{flex-basis:280px}}
@media(max-width:900px){.bt-info-column{display:none}.bt-team-column{flex-basis:240px}}
@media(max-width:600px){.bt-team-column{flex-basis:72px}.bt-team-column .bt-row-body,.bt-team-column .bt-tile-name,.bt-team-column .bt-side-top,.bt-team-footer{display:none}.bt-team-column .bt-row{justify-content:center;padding:8px 0}.bt-team-column .bt-tile{width:48px;padding:6px 0}.bt-team-column>.bt-side{padding:8px 4px}}
`
