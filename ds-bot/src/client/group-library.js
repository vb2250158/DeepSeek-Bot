import { createElement as h, useEffect, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { PlusIcon } from './icons.js'
import { hostText, t } from './i18n.js'

/** Documents are read back from the host; a failed addition retains the draft. */
export function GroupLibrary({ room, roster, actions }) {
  const [view, setView] = useState(null)
  const [document, setDocument] = useState(null)
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const file = useRef(null)
  const generation = useRef(0)
  useEffect(() => {
    let stopped = false
    actions.groupLibraryList(room.id).then(value => { if (!stopped) setView(value) })
      .catch(failure => { if (!stopped) setError(failure.message) })
    return () => { stopped = true; generation.current++ }
  }, [room.id, actions])
  const run = async task => {
    if (busy) return
    setBusy(true); setError('')
    try { await task() } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  const refresh = async () => setView(await actions.groupLibraryList(room.id))
  const read = name => void run(async () => {
    const token = ++generation.current
    const result = await actions.groupLibraryRead(room.id, name)
    if (token === generation.current) setDocument(result)
  })
  const importFile = async event => {
    const selected = event.target.files?.[0]
    event.target.value = ''
    if (!selected) return
    await run(async () => {
      if (selected.size > view.maxBytes) throw new Error(t('This document exceeds the group library file limit'))
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await selected.arrayBuffer())
      await actions.groupLibraryAdd(room.id, selected.name, text)
      await refresh()
    })
  }
  const save = event => {
    event.preventDefault()
    void run(async () => {
      await actions.groupLibraryAdd(room.id, draft.name.trim(), draft.text)
      setDraft(null)
      await refresh()
    })
  }
  return h('div', { className: 'bt-group-library', 'aria-busy': busy },
    error ? h('div', { className: 'bt-error', role: 'alert' }, hostText(error)) : null,
    !view ? error ? h(Button, { onClick: () => void run(refresh) }, t('Retry')) : h('div', { className: 'bt-mem-skel', 'aria-label': t('Loading…') }, h('span'), h('span')) : null,
    view ? h('div', null,
      h('div', { className: 'bt-section-title' }, t('Group folder')),
      h('div', { className: 'bt-group-folder' }, view.folder),
      document ? h('div', { className: 'bt-group-document' },
        h(Button, { onClick: () => setDocument(null) }, t('Back to library')),
        h('h3', null, document.name), h('pre', null, document.text))
        : draft ? h('form', { className: 'bt-group-add', onSubmit: save },
          h(Input, { autoFocus: true, value: draft.name, 'aria-label': t('File name'), placeholder: 'notes.md', maxLength: 120, disabled: busy, onChange: event => setDraft({ ...draft, name: event.target.value }) }),
          h('textarea', { className: 'bt-bs-textarea', 'aria-label': t('Document content'), value: draft.text, disabled: busy, rows: 10, onChange: event => setDraft({ ...draft, text: event.target.value }) }),
          h('div', { className: 'bt-group-actions' }, h(Button, { type: 'button', disabled: busy, onClick: () => setDraft(null) }, t('Cancel')), h(Button, { type: 'submit', disabled: busy || !draft.name.trim() }, t('Save'))))
          : h('div', null,
            h('div', { className: 'bt-group-actions' },
              h(Button, { disabled: busy || Boolean(roster.readOnly), onClick: () => setDraft({ name: '', text: '' }) }, h(PlusIcon), t('New document')),
              h(Button, { disabled: busy || Boolean(roster.readOnly), onClick: () => file.current?.click() }, t('Upload file')),
              h(Button, { disabled: busy, onClick: () => void run(refresh) }, t('Refresh'))),
            h('input', { type: 'file', hidden: true, ref: file, accept: '.md,.txt,.csv,.json,.yaml,.yml', onChange: event => void importFile(event) }),
            h('p', { className: 'bt-set-hint' }, t('UTF-8 text files · up to {size} KB', { size: Math.floor(view.maxBytes / 1024) })),
            view.files.length ? h('div', { role: 'list', className: 'bt-members' }, view.files.map(item => h('button', { key: item.name, type: 'button', className: 'bt-member-name bt-group-pick', disabled: busy, onClick: () => read(item.name) }, item.name)))
              : h('p', { className: 'bt-muted' }, t('No group documents yet')),
            view.nextCursor ? h(Button, { disabled: busy, onClick: () => void run(async () => {
              const next = await actions.groupLibraryList(room.id, view.nextCursor)
              setView({ ...next, files: [...view.files, ...next.files] })
            }) }, t('Load more')) : null)) : null)
}
