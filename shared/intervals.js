/**
 * Validated interval helpers (R1 / TT-06, TT-14; reused by group
 * availability and planning). Minutes-from-midnight on one date. Pure,
 * runtime-neutral, unit-tested.
 */

export function toMins(hhmm) {
  if (typeof hhmm !== 'string') return null
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** Half-open overlap: [aStart, aEnd) ∩ [bStart, bEnd) non-empty. */
export function overlaps(a, b) {
  return a.start < b.end && b.start < a.end
}

/**
 * Partition items into connected overlap components (transitive closure),
 * then assign lanes WITHIN each component. Items in different components
 * never share lanes, so a lone afternoon event keeps full width after a
 * three-way morning clash (TT-14). Numeric start/end, stable order.
 */
export function assignLanesByComponent(items) {
  const sorted = items
    .map((it, i) => ({ it, i, start: it.start, end: Math.max(it.end, it.start + 1) }))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.i - b.i)
  const out = []
  let component = []
  let componentEnd = -Infinity
  const flush = () => {
    if (component.length === 0) return
    const laneEnds = []
    const placed = component.map((x) => {
      let lane = laneEnds.findIndex((e) => e <= x.start)
      if (lane === -1) {
        lane = laneEnds.length
        laneEnds.push(x.end)
      } else {
        laneEnds[lane] = x.end
      }
      return { item: x.it, lane }
    })
    const lanes = Math.max(1, laneEnds.length)
    for (const p of placed) out.push({ item: p.item, lane: p.lane, lanes })
    component = []
    componentEnd = -Infinity
  }
  for (const x of sorted) {
    if (component.length > 0 && x.start >= componentEnd) flush()
    component.push(x)
    componentEnd = Math.max(componentEnd, x.end)
  }
  flush()
  return out
}

/**
 * Today classification by IDENTITY (TT-06): every timed item lands in
 * exactly one bucket relative to `nowMins`; untimed items are separate,
 * never "finished". `busy` items overlapping now form the clash count.
 */
export function classifyNow(items, nowMins) {
  const current = []
  const upcoming = []
  const finished = []
  const untimed = []
  for (const it of items) {
    if (it.start === null || it.start === undefined) {
      untimed.push(it)
      continue
    }
    const end = it.end === null || it.end === undefined ? it.start + 60 : it.end
    if (it.start <= nowMins && nowMins < end) current.push(it)
    else if (it.start > nowMins) upcoming.push(it)
    else finished.push(it)
  }
  const busyNow = current.filter((it) => it.busy !== false)
  return { current, upcoming, finished, untimed, clashCount: busyNow.length > 1 ? busyNow.length : 0 }
}
