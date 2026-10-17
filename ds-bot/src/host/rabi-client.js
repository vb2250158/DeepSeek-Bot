import { randomUUID } from 'node:crypto'

const TOOL = 'rabiroute_manager_api'
export const rabiRefuse = (message, code = 'bot/refused') => { throw Object.assign(new Error(message), { code }) }
export const rabiSegment = value => {
  if (typeof value !== 'string' || !value || value.length > 200 || [...value].some(char => char.charCodeAt(0) < 32)) rabiRefuse('Invalid Rabi identity')
  return encodeURIComponent(value)
}

/** Uses the installed Rabi adapter's discovery, identity fencing and write receipts. */
export function rabiClient(ctx, timeoutMs = 8000) {
  const available = () => Boolean(ctx.tools.get?.(TOOL))
  const request = async (path, method = 'GET', body, signal, headers) => {
    if (!available()) rabiRefuse('Install and configure dsh-rabiroute-agent on the controller first')
    const timeout = AbortSignal.timeout(timeoutMs)
    const result = await ctx.tools.execute({
      name: TOOL, callId: `ds-bot-ui-${randomUUID()}`, signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      arguments: { method, path, ...(body ? { bodyJson: JSON.stringify(body) } : {}), ...(headers ? { requestHeadersJson: JSON.stringify(headers) } : {}) },
    })
    if (result.isError) rabiRefuse(result.error?.message ?? 'Rabi request failed')
    const receipt = result.value
    if (receipt?.uncertain) rabiRefuse('Rabi operation outcome is uncertain. Read back the original operation before retrying; it was not replayed.')
    if (method === 'GET' && !receipt?.ok && receipt?.statusCode >= 500) {
      let failure
      try { failure = JSON.parse(receipt.body) } catch { /* Invalid remote bodies use the adapter's existing error below. */ }
      if (/^Manager read exceeded \d+ ms\.$/.test(failure?.message ?? '')) {
        rabiRefuse('Rabi could not finish reading this persona folder. Check its storage in Rabi, then refresh.', 'bot/rabi-read-timeout')
      }
    }
    if (!receipt?.ok) rabiRefuse(receipt?.error?.message ?? `Rabi HTTP ${receipt?.statusCode ?? 0}`)
    return receipt
  }
  const json = async (...args) => {
    const receipt = await request(...args)
    let parsed
    try { parsed = JSON.parse(receipt.body) } catch { rabiRefuse('Rabi returned invalid JSON') }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) rabiRefuse('Rabi returned invalid JSON')
    if (parsed.code !== undefined && parsed.code !== 0) rabiRefuse(parsed.message ?? 'Rabi refused the operation')
    return parsed
  }
  return { available, request, json }
}
