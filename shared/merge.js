import { collections } from './contracts.js'
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
  return JSON.stringify(value)
}
export function newer(a, b) {
  if (!a) return b
  if (!b) return a
  if ((b.at ?? 0) === (a.at ?? 0) && !!a.deleted !== !!b.deleted) return b.deleted ? b : a
  return (b.at ?? 0) > (a.at ?? 0) || ((b.at ?? 0) === (a.at ?? 0) && (b.deleted && !a.deleted || canonical(b) > canonical(a))) ? b : a
}
export function mergeRecords(a = {}, b = {}) {
  const out = { ...a }
  for (const [key, item] of Object.entries(b)) out[key] = newer(out[key], item)
  return out
}
export function mergeAdmin(a, b) {
  const deleted = { ...a.deleted }
  for (const [key, at] of Object.entries(b.deleted ?? {})) deleted[key] = Math.max(deleted[key] ?? 0, at)
  // Unknown top-level fields (a newer client's collections or settings) are
  // carried through, remote-first — an older client must never strip them (G0).
  const out = {}
  for (const source of [a, b]) for (const [key, value] of Object.entries(source ?? {})) if (!collections.includes(key) && key !== 'deleted') out[key] = value
  out.deleted = deleted
  for (const key of collections) {
    const records = mergeRecords(Object.fromEntries((a[key] ?? []).map(x => [x.id,x])), Object.fromEntries((b[key] ?? []).map(x => [x.id,x])))
    out[key] = Object.values(records).filter(x => !(deleted[key + ':' + x.id] >= x.at)).sort((a,b) => a.id.localeCompare(b.id))
  }
  return out
}
export const deviceSettings = ['pushEnabled','locationEnabled','bgLeaveAlerts','theme','activeView','reminderOffsets','attendancePrompts','quietFrom','quietTo','usagePing','groupMemberId','groupToken','cloudBackups']
export function syncSettings(settings) {
  return Object.fromEntries(Object.entries(settings).filter(([key]) => !deviceSettings.includes(key)))
}
export function mergeStores(a, b) {
  const deletedProfiles = { ...a.deletedProfiles }
  for (const [id, at] of Object.entries(b.deletedProfiles ?? {})) deletedProfiles[id] = Math.max(deletedProfiles[id] ?? 0, at)
  const records = mergeRecords(Object.fromEntries(a.profiles.map(p => [p.id,p])), Object.fromEntries(b.profiles.map(p => [p.id,p])))
  const profiles = Object.values(records).filter(p => !(deletedProfiles[p.id] >= (p.at ?? 0))).sort((a,b) => a.id.localeCompare(b.id))
  return { activeId: profiles.some(p => p.id === a.activeId) ? a.activeId : profiles[0]?.id ?? '', profiles, deletedProfiles }
}
