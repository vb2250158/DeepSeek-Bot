import assert from 'node:assert/strict'
import { test } from 'node:test'
import { userIdentityOf } from '../src/client/user-name.js'

const signedIn = (details, avatar) => ({
  view: { status: 'credential-stored', links: { usageUrl: '/', topUpUrl: '/' }, attempt: null },
  details,
  avatar,
  failed: false,
})

test('a signed-in account lends its name and picture to the user rows', () => {
  const identity = userIdentityOf(signedIn(
    { profile: { status: 'ready', value: { id: 'user', name: '  秋雨  ', contact: null, avatarUrl: 'https://example.test/a.png' } } },
    { url: 'https://example.test/a.png', status: 'ready' },
  ))
  assert.deepEqual(identity, { name: '秋雨', picture: 'https://example.test/a.png' })
})

test('a profile that has not arrived yet keeps the plain name, and an unloaded picture is dropped', () => {
  assert.deepEqual(userIdentityOf(signedIn({ profile: { status: 'loading' } }, undefined)), { name: 'User', picture: undefined })
  assert.deepEqual(userIdentityOf(signedIn({}, { url: 'https://example.test/a.png', status: 'loading' })), { name: 'User', picture: undefined })
  // A failed browser load leaves no picture to draw; the row falls back to the DSH mark.
  assert.deepEqual(userIdentityOf(signedIn({}, { url: 'https://example.test/a.png', status: 'failed' })), { name: 'User', picture: undefined })
})

test('signed out, or without an account plugin at all, the row is the DSH mark under "User"', () => {
  assert.deepEqual(userIdentityOf(null), { name: 'User', picture: undefined })
  assert.deepEqual(userIdentityOf({ view: { status: 'signed-out' }, details: undefined, avatar: undefined, failed: false }), { name: 'User', picture: undefined })
  // A stored profile from a signed-out frame is not this reader's identity.
  const stale = { ...signedIn({ profile: { status: 'ready', value: { id: 'u', name: 'Someone', contact: null } } }, { url: 'https://example.test/a.png', status: 'ready' }), view: { status: 'signed-out' } }
  assert.deepEqual(userIdentityOf(stale), { name: 'User', picture: undefined })
})

test('an empty or blank name is not shown as a name', () => {
  assert.deepEqual(userIdentityOf(signedIn({ profile: { status: 'ready', value: { id: 'u', name: '   ', contact: null } } }, undefined)), { name: 'User', picture: undefined })
  assert.deepEqual(userIdentityOf(signedIn({ profile: { status: 'ready', value: { id: 'u', name: null, contact: null } } }, undefined)), { name: 'User', picture: undefined })
})
