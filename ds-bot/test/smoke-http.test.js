import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { benchFetch } from '../dev/smoke-http.mjs'

async function listen(t, handle) {
  const server = createServer(handle)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  return `http://127.0.0.1:${server.address().port}`
}

test('benchmark login and API each close their connection, retaining cookies and payload', async t => {
  const requests = []
  const closed = []
  const base = await listen(t, async (request, response) => {
    const closing = once(request.socket, 'close')
    closed.push(closing)
    let body = ''
    for await (const chunk of request) body += chunk
    requests.push({ url: request.url, socket: request.socket, headers: request.headers, body })
    if (request.url === '/login') {
      response.writeHead(302, { location: '/', 'set-cookie': 'bench=synthetic; Path=/' })
    }
    response.end('accepted')
  })

  const login = await benchFetch(`${base}/login`, { redirect: 'manual' })
  assert.equal(login.status, 302)
  const cookie = login.headers.getSetCookie()[0].split(';')[0]
  await login.text()
  await closed[0]

  const headers = new Headers({ 'content-type': 'application/json', cookie })
  const body = JSON.stringify({ endpoint: 'send', payload: { sessionId: 'synthetic-group', text: '讨论' } })
  const result = await benchFetch(`${base}/api/bot`, { method: 'POST', headers, body })
  assert.equal(await result.text(), 'accepted')
  await closed[1]
  assert.equal(requests.length, 2)
  assert.deepEqual(requests.map(request => request.headers.connection), ['close', 'close'])
  assert.notEqual(requests[0].socket, requests[1].socket)
  assert.equal(requests[1].headers.cookie, 'bench=synthetic')
  assert.equal(requests[1].headers['content-type'], 'application/json')
  assert.equal(requests[1].body, body)
  assert.equal(headers.has('connection'), false, 'the caller retains its headers')
})

test('benchmark reports a failed accepted write without replaying it', async t => {
  const accepted = []
  const base = await listen(t, async request => {
    let body = ''
    for await (const chunk of request) body += chunk
    accepted.push(body)
    request.socket.destroy()
  })
  await assert.rejects(benchFetch(`${base}/api/bot`, { method: 'POST', body: 'one write' }), /fetch failed/)
  assert.deepEqual(accepted, ['one write'])
})
