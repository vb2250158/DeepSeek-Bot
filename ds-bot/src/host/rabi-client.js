import { randomUUID } from 'node:crypto'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

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
    const callId = ToolCallId(`ds-bot-ui-${randomUUID()}`)
    const callSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    const args = { method, path, ...(body ? { bodyJson: JSON.stringify(body) } : {}), ...(headers ? { requestHeadersJson: JSON.stringify(headers) } : {}) }
    // DSH's public scoped-executor API dispatches raw batches; earlier runtimes accept one call.
    const result = typeof ctx.tools.setExecutor === 'function'
      ? (await ctx.tools.execute({ calls: [{ type: 'tool-call', id: callId, name: TOOL, arguments: JSON.stringify(args) }], signal: callSignal })).results[0].result
      : await ctx.tools.execute({ name: TOOL, callId, signal: callSignal, arguments: args })
    if (result.isError) rabiRefuse(result.error?.kind === 'host_stopped' ? 'Rabi is not running. Start Rabi, then send your message again.' : result.error?.message ?? 'Rabi request failed')
    const receipt = result.value
    if (receipt?.error?.kind === 'host_stopped') rabiRefuse('Rabi is not running. Start Rabi, then send your message again.')
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
