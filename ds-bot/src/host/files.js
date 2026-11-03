import { rename } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

// On Windows a file cannot be replaced while another program has it open: another DSH
// reading the team's state, the search indexer, a virus scanner, a sync client. Those
// readers let go within moments.
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY'])
const TRIES = 6
const WAIT_MS = 40

/**
 * Moves `temp` over `path`, trying again for a moment while Windows reports `path` busy.
 * `check` runs before each new try and throws to stop, as when the lock that allows the
 * write was lost in the meantime. An explicit retryMs preserves a caller-owned
 * monotonic budget; zero refuses a busy file without waiting.
 */
export async function replaceFile(temp, path, check = () => {}, retryMs) {
  const started = performance.now()
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await rename(temp, path)
    } catch (error) {
      const remaining = retryMs === undefined ? undefined : retryMs - (performance.now() - started)
      if (process.platform !== 'win32' || !BUSY.has(error?.code)
        || (remaining === undefined ? attempt >= TRIES : remaining <= 0)) throw error
      // Real filesystem contention must clear even while tests freeze application timers.
      await delay(remaining === undefined ? WAIT_MS * attempt : Math.min(WAIT_MS * attempt, remaining))
      check()
    }
  }
}
