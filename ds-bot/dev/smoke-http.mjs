// The benchmark can block its event loop while reading state and transcripts. Close
// each connection so the next request cannot reuse a socket closed during that work.
export function benchFetch(url, options = {}) {
  const headers = new Headers(options.headers)
  headers.set('connection', 'close')
  return fetch(url, { ...options, headers })
}
