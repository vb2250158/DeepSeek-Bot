import { createElement as h, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { BotAvatar } from './mark.js'
import { PlusIcon } from './icons.js'
import { MemberApprovals, MemberState, StopMemberWork, useMemberWork } from './member-status.js'
import { t } from './i18n.js'

/** Member changes use the same group command as Settings. */
export function GroupMembers({ room, roster, actions, useWork, run }) {
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const { entries, now } = useMemberWork(room, useWork)
  const members = room.members.map(id => roster.byId[id]).filter(Boolean)
  const outside = roster.bots.filter(bot => !room.members.includes(bot.id))
  const matches = outside.filter(bot => bot.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const add = async id => {
    if (busy) return
    setBusy(true)
    try {
      if (await run(actions.updateRoom(room.id, { add: [id] }))) { setAdding(false); setQuery('') }
    } finally { setBusy(false) }
  }
  return h('div', { className: 'bt-group-members' },
    h('div', { className: 'bt-section-title' }, t('Members · {count}', { count: members.length })),
    h('div', { className: 'bt-members', role: 'list' }, members.map(member => {
      const entry = entries.find(item => item.id === member.id)
      return h('div', { key: member.id, role: 'listitem' },
        h('div', { className: 'bt-member' },
          h('button', { type: 'button', className: 'bt-member-name', title: t("Open {name}'s chat", { name: member.name }), onClick: () => actions.openSession(member.id) },
            h(BotAvatar, { bot: member, size: 26, admin: room.admin === member.id, live: false }), h('span', null, member.name)),
          room.admin === member.id ? h('span', { className: 'bt-chip bt-chip-admin' }, t('Admin')) : null),
        entry ? h('div', null,
          h(MemberState, { entry, bot: member, room, roster, now }),
          h(StopMemberWork, { entry, bot: member, room, actions }),
          h(MemberApprovals, { entry, bot: member, actions })) : null)
    })),
    adding ? h('div', { className: 'bt-group-add', onKeyDown: event => { if (event.key === 'Escape') { event.stopPropagation(); if (!busy) setAdding(false) } } },
      h(Input, { autoFocus: true, value: query, disabled: busy, placeholder: t('Search Bots'), 'aria-label': t('Search Bots'), onChange: event => setQuery(event.target.value) }),
      matches.length ? matches.map(bot => h('button', { key: bot.id, type: 'button', className: 'bt-member-name bt-group-pick', disabled: busy, onClick: () => void add(bot.id) },
        h(BotAvatar, { bot, size: 26, live: false }), h('span', null, bot.name), h(PlusIcon)))
        : h('p', { className: 'bt-muted' }, t(outside.length ? 'No matching Bots' : 'All Bots are already members')),
      h(Button, { disabled: busy, onClick: () => setAdding(false) }, t('Cancel')))
      : h(Button, { disabled: Boolean(roster.readOnly), onClick: () => setAdding(true) }, h(PlusIcon), t('Add member')))
}
