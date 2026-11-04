import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/schedules.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
let view
const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  Fragment: 'fragment', useState: initial => [initial === null ? view : initial, () => {}],
  useEffect() {}, useLayoutEffect() {}, useRef: current => ({ current }),
  useMemo: make => make(), useCallback: fn => fn, useId: () => 'id',
  useSyncExternalStore: (subscribe, read) => read(),
  createContext: value => ({ value, Provider: () => null }), useContext: context => context.value,
}
const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports,
  require: name => (name === 'react' ? react : name === 'react-dom' ? { createPortal: node => node } : {}),
})
const { timingText, BotSchedules } = module.exports
const text = node => node == null ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node)
const expand = node => node == null ? node : Array.isArray(node) ? node.map(expand) : typeof node !== 'object' ? node : typeof node.type === 'function' ? expand(node.type(node.props)) : { ...node, props: { ...node.props, children: expand(node.props.children) } }
function all(node, className) {
  if (node == null || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(entry => all(entry, className))
  return [...((node.props?.className ?? '').split(' ').includes(className) ? [node] : []), ...all(node.props?.children, className)]
}

test('canonical recurrence rules remain visible in task descriptions', () => {
  const rrule = 'DTSTART;TZID=Asia/Shanghai:20300101T090000\nRRULE:FREQ=DAILY'
  assert.equal(timingText({ kind: 'rrule', rrule }), `On the schedule ${rrule}`)
})

test('paused Host tasks show Paused while ended and overdue tasks retain their states', () => {
  const bot = { id: 'chief', name: 'Chief' }
  const base = { botId: bot.id, sessionId: bot.id, kind: 'rrule', rrule: 'DTSTART:20300101T090000Z\nRRULE:FREQ=DAILY', title: 'Briefing', prompt: 'Check', scheduledAt: '2030-01-01T09:00:00.000Z' }
  view = { available: true, tasks: [
    { ...base, id: 'paused', status: 'paused', state: 'paused' },
    { ...base, id: 'ended', status: 'ended', state: 'finished' },
    { ...base, id: 'late', status: 'active', state: 'overdue', scheduledAt: '2020-01-01T09:00:00.000Z' },
  ] }
  const tree = expand(BotSchedules({ bot, roster: { roomsById: {} }, actions: {} }))
  const labels = all(tree, 'bt-task-next').map(text)
  assert.equal(labels[0], 'Paused')
  assert.equal(labels[1], 'Finished')
  assert.match(labels[2], /^Overdue:/)
  assert.equal(all(tree, 'bt-set-hint').filter(node => text(node).includes(base.rrule)).length, 3)
})

test('legacy recurrence descriptions remain readable', () => {
  assert.equal(timingText({ kind: 'every', everySeconds: 3600 }), 'Every hour')
  assert.match(timingText({ kind: 'daily', time: '09:00:00' }), /Every day at 09:00/)
  assert.match(timingText({ kind: 'weekly', time: '10:15:00', weekdays: [1, 2, 3, 4, 5] }), /Every weekday at 10:15/)
  assert.equal(timingText({ kind: 'cron', expression: '0 9 * * *' }), 'On the schedule 0 9 * * *')
})
