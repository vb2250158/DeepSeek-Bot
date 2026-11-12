// Display-only Rabi avatars survive Host restarts and remote outages.
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { replaceFile } from './files.js'
import { rabiRefuse } from './rabi-client.js'

const MAX_BYTES = 5 * 1024 * 1024
const REFRESH_MS = 60_000
const MAX_ENTRIES = 64

/** Validates the remote receipt and the same fields read back from disk. */
export function rabiAvatarImage(image) {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(image?.contentType) || typeof image?.contentBase64 !== 'string' || image.contentBase64.length === 0 || image.contentBase64.length % 4 !== 0 || image.contentBase64.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.contentBase64)) rabiRefuse('Rabi returned an invalid avatar')
  const bytes = Buffer.from(image.contentBase64, 'base64')
  if (bytes.length > MAX_BYTES) rabiRefuse('Rabi avatar exceeds the image size limit')
  return { bytes, contentType: image.contentType }
}

/** Reads saved images first and refreshes stale entries without delaying display. */
export function createRabiAvatarCache({ home, fetchImage, signal, warn = () => {} }) {
  const root = typeof home === 'string' ? join(home, 'rabi-avatars') : undefined
  const entries = new Map()
  const prune = () => {
    for (const [key, entry] of entries) {
      if (entries.size <= MAX_ENTRIES) break
      if (!entry.users && !entry.pending) entries.delete(key)
    }
  }
  const fileOf = roleId => join(root, `${createHash('sha256').update(roleId).digest('hex')}.json`)
  const read = async roleId => {
    if (!root) return undefined
    try {
      const path = fileOf(roleId)
      if ((await stat(path)).size > Math.ceil(MAX_BYTES / 3) * 4 + 4096) throw new Error('Saved Rabi avatar exceeds the image size limit')
      const saved = JSON.parse(await readFile(path, 'utf8'))
      if (saved.version !== 1 || saved.roleId !== roleId || !Number.isFinite(saved.updatedAt)) throw new Error('Invalid saved Rabi avatar')
      return { image: rabiAvatarImage(saved), updatedAt: saved.updatedAt }
    } catch (error) {
      if (error.code !== 'ENOENT') warn('ds-bot: cannot read cached Rabi avatar for %s: %s', roleId, error.message)
      return undefined
    }
  }
  const save = async (roleId, image, updatedAt) => {
    if (!root) return
    const path = fileOf(roleId), temp = `${path}.${randomUUID()}.tmp`
    try {
      await mkdir(root, { recursive: true })
      await writeFile(temp, JSON.stringify({ version: 1, roleId, contentType: image.contentType, contentBase64: image.bytes.toString('base64'), updatedAt }), { flag: 'wx' })
      signal.throwIfAborted()
      await replaceFile(temp, path, () => signal.throwIfAborted())
    } finally {
      await rm(temp, { force: true })
    }
  }
  const refresh = (roleId, entry) => {
    if (entry.pending) return entry.pending
    entry.checkedAt = Date.now()
    entry.pending = (async () => {
      const image = await fetchImage(roleId, signal)
      signal.throwIfAborted()
      const updatedAt = Date.now()
      entry.image = image
      try { await save(roleId, image, updatedAt) }
      catch (error) {
        signal.throwIfAborted()
        warn('ds-bot: cannot save cached Rabi avatar for %s: %s', roleId, error.message)
      }
      return image
    })().finally(() => { entry.pending = null; prune() })
    return entry.pending
  }
  return {
    async get(roleId, callerSignal) {
      signal.throwIfAborted()
      callerSignal?.throwIfAborted()
      if (!root) return fetchImage(roleId, callerSignal ?? signal)
      let entry = entries.get(roleId)
      if (!entry) {
        entry = { ready: read(roleId) }
        entries.set(roleId, entry)
        entry.ready = entry.ready.then(saved => {
          entry.image = saved?.image
          entry.checkedAt = Math.min(saved?.updatedAt ?? 0, Date.now())
        })
      }
      entries.delete(roleId); entries.set(roleId, entry)
      entry.users = (entry.users ?? 0) + 1
      try {
        await entry.ready
        signal.throwIfAborted()
        callerSignal?.throwIfAborted()
        if (!entry.image) {
          const image = await refresh(roleId, entry)
          callerSignal?.throwIfAborted()
          return image
        }
        if (Date.now() - entry.checkedAt >= REFRESH_MS) {
          void refresh(roleId, entry).catch(error => {
            if (!signal.aborted) warn('ds-bot: cannot refresh cached Rabi avatar for %s: %s', roleId, error.message)
          })
        }
        return entry.image
      } finally {
        entry.users--
        prune()
      }
    },
    async dispose() {
      await Promise.allSettled([...entries.values()].flatMap(entry => [entry.ready, entry.pending]))
      entries.clear()
    },
  }
}
