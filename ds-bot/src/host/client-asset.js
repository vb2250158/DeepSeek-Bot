import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'

const immutable = 'private, max-age=31536000, immutable'
const revalidate = 'private, no-cache'

/** Reuse one compiled asset until its file changes or this route is disposed. */
export function createClientAsset(file, io = { readFileSync, statSync }) {
  let cached
  let disposed = false
  const missing = message => new Response(message, { status: 404, headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' } })
  return {
    fetch(request) {
      if (disposed) return missing('DS Bot client asset is no longer registered')
      try {
        const stat = io.statSync(file, { bigint: true })
        const identity = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
        if (cached?.identity !== identity) {
          const bytes = io.readFileSync(file)
          cached = { identity, bytes, hash: createHash('sha256').update(bytes).digest('hex') }
        }
        const versions = new URL(request.url).searchParams.getAll('v')
        if (versions.length > 1 || (versions.length === 1 && versions[0] !== cached.hash)) return missing('DS Bot client asset version is unavailable; reload the page')
        const etag = `"${cached.hash}"`
        const headers = { 'content-type': 'application/javascript; charset=utf-8', etag,
          'cache-control': versions.length === 1 ? immutable : revalidate }
        const matches = request.headers.get('if-none-match')?.split(',')
          .some(value => value.trim() === '*' || value.trim().replace(/^W\//u, '') === etag)
        return new Response(matches ? null : cached.bytes, { status: matches ? 304 : 200, headers })
      } catch (error) {
        return missing(String(error?.message ?? error))
      }
    },
    dispose() {
      disposed = true
      cached = undefined
    },
  }
}
