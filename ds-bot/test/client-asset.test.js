import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClientAsset } from '../src/host/client-asset.js'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const request = (version, headers) => new Request(`http://localhost/api/ds-bot-client-app${version === undefined ? '' : `?v=${version}`}`, { headers })

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ds-bot-asset-'))
  const file = join(root, 'client-app.js')
  writeFileSync(file, 'module.exports = { version: 1 }')
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5 }))
  let reads = 0
  const io = { statSync, readFileSync: file => { reads++; return readFileSync(file) } }
  const asset = createClientAsset(file, io)
  t.after(() => asset.dispose())
  return { file, io, asset, reads: () => reads, bytes: () => readFileSync(file), replace: text => {
    writeFileSync(`${file}.next`, text)
    renameSync(`${file}.next`, file)
  } }
}

test('versioned asset has immutable bytes and a conditional reload reads the file once', async t => {
  const f = fixture(t)
  const digest = hash(f.bytes())
  const first = f.asset.fetch(request(digest))
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('cache-control'), 'private, max-age=31536000, immutable')
  assert.equal(first.headers.get('content-type'), 'application/javascript; charset=utf-8')
  assert.equal(first.headers.get('etag'), `"${digest}"`)
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), f.bytes())
  const next = f.asset.fetch(request(digest, { 'if-none-match': first.headers.get('etag') }))
  assert.equal(next.status, 304)
  assert.equal((await next.arrayBuffer()).byteLength, 0)
  assert.equal(f.reads(), 1)
})

test('legacy requests revalidate without retransmitting unchanged bytes', async t => {
  const f = fixture(t)
  const first = f.asset.fetch(request())
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('cache-control'), 'private, no-cache')
  const etag = first.headers.get('etag')
  for (const condition of [etag, `"other", W/${etag}`, '*']) {
    const next = f.asset.fetch(request(undefined, { 'if-none-match': condition }))
    assert.equal(next.status, 304)
    assert.equal((await next.arrayBuffer()).byteLength, 0)
  }
  const different = f.asset.fetch(request(undefined, { 'if-none-match': '"different"' }))
  assert.equal(different.status, 200)
  assert.deepEqual(Buffer.from(await different.arrayBuffer()), f.bytes())
  assert.equal(f.reads(), 1)
})

test('unknown or ambiguous content hashes never receive another version or a cacheable failure', async t => {
  const f = fixture(t)
  const digest = hash(f.bytes())
  for (const version of ['missing', '0'.repeat(64), `${digest}&v=${digest}`]) {
    const response = f.asset.fetch(request(version, { 'if-none-match': '*' }))
    assert.equal(response.status, 404)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.notEqual(Buffer.from(await response.arrayBuffer()).toString(), f.bytes().toString())
  }
  assert.equal(f.reads(), 1)
})

test('source rebuild replaces the cached bytes and isolates old URLs even when file size stays equal', async t => {
  const f = fixture(t)
  const before = f.bytes()
  const oldHash = hash(before)
  const initial = f.asset.fetch(request(oldHash))
  const oldEtag = initial.headers.get('etag')
  f.replace('module.exports = { version: 2 }')
  assert.equal(f.bytes().length, before.length)
  const newHash = hash(f.bytes())
  assert.notEqual(newHash, oldHash)
  assert.equal(f.asset.fetch(request(oldHash)).status, 404)
  const current = f.asset.fetch(request(newHash, { 'if-none-match': oldEtag }))
  assert.equal(current.status, 200)
  assert.deepEqual(Buffer.from(await current.arrayBuffer()), f.bytes())
  assert.equal(current.headers.get('etag'), `"${newHash}"`)
  assert.equal(f.reads(), 2)
})

test('read failure does not poison the next request or serve a stale cached version', async t => {
  const f = fixture(t)
  let failed = false
  const broken = createClientAsset(f.file, { statSync, readFileSync: file => {
    if (!failed) { failed = true; throw new Error('fixture read failed') }
    return readFileSync(file)
  } })
  t.after(() => broken.dispose())
  const failedResponse = broken.fetch(request())
  assert.equal(failedResponse.status, 404)
  assert.equal(failedResponse.headers.get('cache-control'), 'no-store')
  assert.equal(broken.fetch(request()).status, 200)
  f.asset.fetch(request())
  rmSync(f.file)
  assert.equal(f.asset.fetch(request()).status, 404)
  writeFileSync(f.file, 'module.exports = { version: 3 }')
  const restored = f.asset.fetch(request())
  assert.equal(restored.status, 200)
  assert.deepEqual(Buffer.from(await restored.arrayBuffer()), f.bytes())
})

test('unload releases the route cache and a fresh owner reads its own replacement', async t => {
  const f = fixture(t)
  const originalHash = hash(f.bytes())
  f.asset.fetch(request(originalHash))
  f.asset.dispose()
  f.replace('module.exports = { version: 4 }')
  const disposed = f.asset.fetch(request(originalHash))
  assert.equal(disposed.status, 404)
  assert.equal(disposed.headers.get('cache-control'), 'no-store')
  assert.equal(f.reads(), 1)
  const next = createClientAsset(f.file, f.io)
  t.after(() => next.dispose())
  const response = next.fetch(request(hash(f.bytes())))
  assert.equal(response.status, 200)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), f.bytes())
  assert.equal(f.reads(), 2)
})
