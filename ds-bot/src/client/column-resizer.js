import { createElement as h, useEffect, useRef, useState } from 'react'
import { t } from './i18n.js'

const COLUMNS = {
  team: { initial: 280, min: 200, max: 520, direction: 1, label: 'Resize conversation list' },
  details: { initial: 320, min: 240, max: 520, direction: -1, label: 'Resize conversation details' },
}
const storageKey = side => `ds-bot.column-width.${side}`
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

export function useColumnWidth(side) {
  const spec = COLUMNS[side]
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey(side)))
      if (Number.isFinite(saved) && saved >= spec.min && saved <= spec.max) return saved
    } catch { /* A blocked store keeps the default width for this view. */ }
    return spec.initial
  })
  return [width, (next, commit = false) => {
    const value = clamp(next, spec.min, spec.max)
    setWidth(value)
    if (commit) {
      try { localStorage.setItem(storageKey(side), String(value)) } catch { /* Resizing remains available without persistent storage. */ }
    }
  }]
}

export function ColumnResizer({ side, width, onChange }) {
  const spec = COLUMNS[side]
  const drag = useRef(null)
  const maximum = element => {
    const root = element.closest('.bt-workbench')
    const other = root.querySelector(side === 'team' ? '.bt-info-column' : '.bt-team-column')
    return Math.max(spec.min, Math.min(spec.max, root.clientWidth - (other?.getBoundingClientRect().width ?? 0) - 320))
  }
  const release = () => {
    const active = drag.current
    drag.current = null
    if (active?.element.hasPointerCapture(active.id)) active.element.releasePointerCapture(active.id)
  }
  useEffect(() => release, [])
  const move = (event, commit) => {
    const active = drag.current
    if (active?.id !== event.pointerId) return
    onChange(clamp(active.width + spec.direction * (event.clientX - active.x), spec.min, active.max), commit)
    if (commit) release()
  }
  return h('div', {
    className: 'bt-column-resizer', 'data-side': side, role: 'separator', tabIndex: 0,
    'aria-label': t(spec.label), 'aria-orientation': 'vertical',
    'aria-valuemin': spec.min, 'aria-valuemax': spec.max, 'aria-valuenow': Math.round(width),
    onPointerDown: event => {
      if (event.button !== 0 || drag.current) return
      event.preventDefault()
      const element = event.currentTarget
      const actual = element.parentElement.getBoundingClientRect().width
      element.setPointerCapture(event.pointerId)
      drag.current = { element, id: event.pointerId, x: event.clientX, width: actual, max: maximum(element) }
    },
    onPointerMove: event => move(event, false),
    onPointerUp: event => move(event, true),
    onPointerCancel: release, onLostPointerCapture: release,
    onDoubleClick: () => onChange(spec.initial, true),
    onKeyDown: event => {
      const limit = maximum(event.currentTarget)
      const next = event.key === 'Home' ? spec.min : event.key === 'End' ? limit
        : event.key === 'ArrowLeft' ? width - spec.direction * 16
          : event.key === 'ArrowRight' ? width + spec.direction * 16 : undefined
      if (next === undefined) return
      event.preventDefault()
      onChange(clamp(next, spec.min, limit), true)
    },
  })
}
