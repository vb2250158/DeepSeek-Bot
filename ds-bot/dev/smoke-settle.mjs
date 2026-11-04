// The bench keeps its original quiet window after the team's work finishes.
export async function waitForBenchIdle({ readState, readMockCount, quietMs = 2500, timeoutMs = 120_000, pollMs = 400, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const deadline = now() + timeoutMs
  let calls = readMockCount()
  let since = now()
  while (now() < deadline) {
    await wait(pollMs)
    const snapshot = await readState()
    const nextCalls = readMockCount()
    // Activity is presentation copy. Native turns and owned Bot/group work can
    // still be running while that label is empty, including after show_view.
    const busy = Object.keys(snapshot.activity ?? {}).length > 0
      || Object.keys(snapshot.work?.turns ?? {}).length > 0
      || Object.keys(snapshot.work?.bots ?? {}).length > 0
      || Object.values(snapshot.work?.rooms ?? {}).some(entries => entries.length > 0)
    if (nextCalls !== calls || busy) {
      calls = nextCalls
      since = busy ? undefined : now()
    } else {
      since ??= now()
      if (now() - since >= quietMs) return
    }
  }
  throw new Error('the team did not go quiet')
}
