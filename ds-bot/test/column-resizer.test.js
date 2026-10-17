import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/column-resizer.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent', external: ['react'],
})
function setup(saved = new Map()) {
  const module = { exports: {} }
  const cleanups = []
  runInNewContext(outputFiles[0].text, {
    module, exports: module.exports, localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
    require: () => ({ createElement: (type, props) => ({ type, props }), useRef: current => ({ current }),
      useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useEffect: effect => cleanups.push(effect()) }),
  })
  return { ...module.exports, cleanups }
}
function separator(side, available = 1200) {
  const api = setup()
  const changes = []
  const width = side === 'team' ? 280 : 320
  const root = { clientWidth: available, querySelector: () => ({ getBoundingClientRect: () => ({ width: side === 'team' ? 320 : 280 }) }) }
  let captured = false
  const element = { closest: () => root, parentElement: { getBoundingClientRect: () => ({ width }) },
    setPointerCapture: () => { captured = true }, hasPointerCapture: () => captured, releasePointerCapture: () => { captured = false } }
  const { props } = api.ColumnResizer({ side, width, onChange: (...args) => changes.push(args) })
  const event = (clientX, extra = {}) => ({ button: 0, pointerId: 1, clientX, currentTarget: element, preventDefault() {}, ...extra })
  return { props, changes, event, cleanups: api.cleanups, captured: () => captured }
}

test('dragging the list divider grows the list and commits only on release', () => {
  const { props, event, changes, captured } = separator('team')
  props.onPointerDown(event(100))
  props.onPointerMove(event(180))
  props.onPointerUp(event(200))
  assert.deepEqual(changes, [[360, false], [380, true]])
  assert.equal(captured(), false)
})

test('the details divider moves in the opposite direction and reserves room for chat', () => {
  const { props, event, changes } = separator('details', 1000)
  props.onPointerDown(event(800))
  props.onPointerMove(event(0))
  props.onPointerUp(event(0))
  assert.deepEqual(changes, [[400, false], [400, true]])
})

test('cancellation and unmount release pointer capture without continued changes', () => {
  for (const cancel of ['onPointerCancel', 'onLostPointerCapture', 'unmount']) {
    const { props, event, changes, cleanups, captured } = separator('team')
    props.onPointerDown(event(100))
    if (cancel === 'unmount') cleanups.forEach(cleanup => cleanup())
    else props[cancel](event(100))
    props.onPointerMove(event(500))
    assert.equal(captured(), false)
    assert.deepEqual(changes, [])
  }
})

test('keyboard resizing, limits and reset work on both separators', () => {
  for (const side of ['team', 'details']) {
    const { props, event, changes } = separator(side)
    props.onKeyDown(event(0, { key: 'ArrowRight' }))
    props.onKeyDown(event(0, { key: 'Home' }))
    props.onDoubleClick()
    assert.deepEqual(changes, side === 'team' ? [[296, true], [200, true], [280, true]] : [[304, true], [240, true], [320, true]])
    assert.equal(props.role, 'separator')
    assert.equal(props['aria-orientation'], 'vertical')
  }
})

test('column sizes survive remount and reject invalid stored values', () => {
  const saved = new Map()
  const api = setup(saved)
  const [initial, update] = api.useColumnWidth('team')
  assert.equal(initial, 280)
  update(400, false)
  assert.equal(saved.size, 0)
  update(400, true)
  assert.equal(setup(saved).useColumnWidth('team')[0], 400)
  for (const value of ['NaN', '-1', '9999']) {
    saved.set('ds-bot.column-width.team', value)
    assert.equal(setup(saved).useColumnWidth('team')[0], 280)
  }
})
