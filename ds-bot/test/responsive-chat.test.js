import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveResponsiveChat } from '../src/host/responsive-chat.js'

test('responsive chat is opt-in and validates its configuration', () => {
  assert.equal(resolveResponsiveChat({}), undefined)
  assert.equal(resolveResponsiveChat({ responsiveChat: false }), undefined)
  for (const responsiveChat of ['true', 1, null]) assert.throws(() => resolveResponsiveChat({ responsiveChat }), /boolean/)
  for (const responsiveChatDelegationTools of [[], null, 'subagent', [null], [''], ['run_code'], ['two words']]) {
    assert.throws(() => resolveResponsiveChat({ responsiveChat: true, responsiveChatDelegationTools }), /delegation tool names/)
  }
  const policy = resolveResponsiveChat({ responsiveChat: true, responsiveChatDelegationTools: ['dispatch', 'dispatch'] })
  assert.deepEqual(policy.delegates, ['dispatch'])
  assert.deepEqual([...policy.allowed], ['dispatch', 'job_list'])
})
