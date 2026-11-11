/** Validates Rabi daily timing DTOs; an explicit list takes precedence over the legacy time. */
export function rabiDailyTimes(schedule) {
  const values = Object.hasOwn(schedule, 'timeOfDays') ? schedule.timeOfDays : [schedule.timeOfDay]
  if (!Array.isArray(values) || !values.length) return null
  const times = []
  for (const value of values) {
    if (typeof value !== 'string') return null
    const match = /^(\d|[01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value.trim())
    if (!match) return null
    times.push(`${match[1].padStart(2, '0')}:${match[2]}${match[3] && match[3] !== '00' ? `:${match[3]}` : ''}`)
  }
  return [...new Set(times)].sort()
}
