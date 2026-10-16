import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const { outputFiles } = await build({
  stdin: { contents: "export { BotWorkbench, BotConversation } from './src/client/workbench.js'", resolveDir: fileURLToPath(new URL('..', import.meta.url)) },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const effects = []
const h = (type, props, ...children) => ({ type, props: { ...props, children } })
const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports,
  require: name => name === 'react' ? { createElement: h, Fragment: 'fragment', useEffect: effect => effects.push(effect) }
    : name === 'react-dom' ? { createPortal: node => node } : {},
})
const { BotWorkbench, BotConversation } = module.exports

test('the team list precedes the conversation inside the plugin panel', () => {
  const rendered = []
  const tree = BotWorkbench({ renderSlot: name => { rendered.push(name); return name } })
  assert.equal(tree.props['data-dsh-private-ui'], 'ds-bot')
  assert.deepEqual(rendered, ['bot.team', 'bot.conversation'])
})

test('the selected Bot uses the shared conversation factory and its existing details', () => {
  const calls = []
  const bot = { id: 'bot-one', sessionId: 'part-two', name: 'Chief' }
  const tree = BotConversation({
    sessionId: 'part-two',
    useRoster: select => select({ byId: { 'bot-one': bot }, roomsById: {} }),
    useUi: select => select({ details: 'bot-one', renaming: true }),
    actions: {},
    renderFactorySlot: (name, props) => { calls.push({ name, ...props }); return 'shared conversation' },
  })
  assert.deepEqual(calls, [{ name: 'conversation.content', variant: 'embedded', phase: 'active', hero: false }])
  const [chat, details] = tree.props.children
  assert.equal(chat.props.className, 'bt-chat-column')
  assert.equal(details.props.className, 'bt-info-column')
  assert.equal(details.props.children[0].props.sessionId, 'bot-one')
  assert.equal(details.props.children[0].props.startRenaming, true)
})

test('an unowned session has no misleading Bot details', () => {
  const tree = BotConversation({ sessionId: 'outside', useRoster: select => select({ byId: {}, roomsById: {} }), useUi: select => select({}), actions: {}, renderFactorySlot: () => 'chat' })
  assert.equal(tree.props.children[1], null)
})


test('the panel keeps visit readback and the selected Bot input hint without a floating header', () => {
  effects.length = 0
  const log = []
  const tree = BotConversation({
    sessionId: 'chief', useRoster: select => select({ byId: { chief: { id: 'chief', name: 'Chief' } }, roomsById: {} }),
    useUi: select => select({}), renderFactorySlot: () => 'chat',
    actions: { beginVisit: id => log.push(['begin', id]), endVisit: id => log.push(['end', id]) },
  })
  const cleanups = effects.map(effect => effect()).filter(Boolean)
  assert.deepEqual(log, [['begin', 'chief']])
  assert.match(tree.props.children[0].props.style['--bt-placeholder'], /Chief/)
  for (const dispose of cleanups) dispose()
  assert.deepEqual(log, [['begin', 'chief'], ['end', 'chief']])
})
