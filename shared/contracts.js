/** Runtime-neutral input contracts, shared by browser and workers. */
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024
export const MAX_SYNC_BYTES = 2 * 1024 * 1024
export const collections = ['reflections', 'targets', 'meetings', 'observations', 'lessons', 'audits', 'tasks', 'exceptions', 'plans', 'commitments']
/** Collections added in Phase 5 — absent in older payloads/backups, so their
 *  arrays are optional on read and treated as empty. */
export const optionalCollections = ['tasks', 'exceptions', 'plans', 'commitments']
export function assert(condition, message) { if (!condition) throw new Error(message) }
export function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
export function safeURL(value) {
  if (value === '' || value === undefined) return true
  try { return ['https:', 'http:'].includes(new URL(value).protocol) } catch { return false }
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(value + 'T00:00:00Z')
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value
}
export function validTime(value) { return value === '' || (typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)) }
export function validateTree(value, depth = 0) {
  assert(depth < 25, 'Data is nested too deeply.')
  if (typeof value === 'string') assert(value.length <= 16 * 1024 * 1024, 'A field is too large.')
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    assert(!['__proto__', 'constructor', 'prototype'].includes(key), 'Unsafe field name.')
    validateTree(child, depth + 1)
  }
}
export function validateSettings(s) {
  assert(object(s) && typeof s.sheetId === 'string' && (s.demo || /^[\w-]{20,200}$/.test(s.sheetId)), 'Invalid timetable source.')
  for (const [key, value] of Object.entries(s)) {
    if (/Url$|Base$/.test(key)) assert(typeof value === 'string' && safeURL(value), 'Invalid URL in ' + key)
  }
  assert(s.gid === null || s.gid === undefined || /^\d{1,20}$/.test(s.gid), 'Invalid tab ID.')
  for (const key of ['mySpecialisms', 'myGroups', 'reminderOffsets', 'leaveAlertOffsets', 'keyDateReminderDays']) {
    if (s[key] !== undefined) assert(Array.isArray(s[key]) && s[key].length <= 100 && s[key].every(v => typeof v === (key === 'mySpecialisms' || key === 'myGroups' ? 'string' : 'number')), 'Invalid ' + key)
  }
  if (s.filters !== undefined) {
    const f = s.filters
    assert(object(f) && ['today','week','all'].includes(f.dateRange), 'Invalid date filter.')
    for (const key of ['subjects','tutors','rooms']) assert(Array.isArray(f[key]) && f[key].every(v => typeof v === 'string'), 'Invalid filters.')
    for (const key of ['showSelfStudy','showOptional','showKeyDates']) assert(typeof f[key] === 'boolean', 'Invalid filter switch.')
  }
  if (s.extraTabs !== undefined) assert(Array.isArray(s.extraTabs) && s.extraTabs.length <= 30 && s.extraTabs.every(t => object(t) && /^[\w-]{20,200}$/.test(t.sheetId) && safeURL(t.url) && (t.gid === null || /^\d{1,20}$/.test(t.gid))), 'Invalid extra tabs.')
  if (s.customKeyDates !== undefined) assert(Array.isArray(s.customKeyDates) && s.customKeyDates.every(e => object(e) && typeof e.id === 'string' && typeof e.title === 'string' && validDate(e.dateISO) && validTime(e.start ?? '')), 'Invalid personal deadline.')
}
export function validatePayload(data) {
  validateTree(data)
  assert(object(data) && object(data.store) && Array.isArray(data.store.profiles) && data.store.profiles.length <= 100, 'Invalid profile store.')
  const ids = new Set()
  for (const p of data.store.profiles) {
    assert(object(p) && typeof p.id === 'string' && /^[\w-]{1,100}$/.test(p.id) && !ids.has(p.id) && typeof p.name === 'string', 'Invalid or duplicate profile.')
    ids.add(p.id); validateSettings(p.settings)
  }
  if (data.store.deletedProfiles !== undefined) assert(object(data.store.deletedProfiles) && Object.values(data.store.deletedProfiles).every(Number.isFinite), 'Invalid deleted profiles.')
  assert(typeof data.store.activeId === 'string' && (!ids.size || ids.has(data.store.activeId)), 'Invalid active profile.')
  for (const group of ['meta','admin','cache','changes','identities']) {
    if (data[group] === undefined) continue
    assert(object(data[group]), 'Invalid ' + group)
    for (const [pid, value] of Object.entries(data[group])) {
      assert(ids.has(pid), 'Records belong to an unknown profile.')
      if (group === 'meta') {
        assert(object(value), 'Invalid session records.')
        for (const entry of Object.values(value)) {
          assert(object(entry), 'Invalid session record.')
          if (entry.note !== undefined) assert(typeof entry.note === 'string', 'Invalid note.')
          for (const key of ['attended','absent','deleted']) if (entry[key] !== undefined) assert(typeof entry[key] === 'boolean', 'Invalid attendance.')
          if (entry.at !== undefined) assert(Number.isFinite(entry.at), 'Invalid record revision.')
          if (entry.photos !== undefined) assert(Number.isInteger(entry.photos) && entry.photos >= 0, 'Invalid photo count.')
          if (entry.standards !== undefined) assert(Array.isArray(entry.standards) && entry.standards.every(x => typeof x === 'string'), 'Invalid standards.')
        }
      }
      if (group === 'admin') {
        assert(object(value), 'Invalid admin records.')
        if (value.deleted !== undefined) assert(object(value.deleted) && Object.values(value.deleted).every(Number.isFinite), 'Invalid deleted records.')
        for (const key of collections) {
          if (value[key] === undefined && optionalCollections.includes(key)) continue
          assert(Array.isArray(value[key]), 'Invalid admin collection.')
          const seen = new Set()
          for (const item of value[key]) {
            assert(object(item) && typeof item.id === 'string' && !seen.has(item.id) && Number.isFinite(item.at), 'Invalid admin record.')
            seen.add(item.id)
            const strings = {reflections:['weekISO','wentWell','challenges','focus'],targets:['text','setISO','status'],meetings:['dateISO','discussed'],observations:['dateISO','observer','subject','focus','strengths','development'],lessons:['dateISO','classGroup','subject','evaluation'],audits:['subject','stage','note','dateISO'],tasks:['title','dueISO','status'],exceptions:['tag','dateISO','kind'],plans:['parentId','kind','title'],commitments:['title','dateISO','startTime','endTime','kind']}
            for (const field of strings[key]) assert(typeof item[field] === 'string', 'Invalid admin field: ' + field)
            for (const field of ['dateISO','weekISO','setISO','metISO','dueISO','completedISO']) if (item[field]) assert(validDate(item[field]), 'Invalid admin date.')
            for (const field of ['dueTime','startTime','endTime']) if (item[field] !== undefined) assert(validTime(item[field]), 'Invalid admin time.')
            if (key === 'meetings') assert(Array.isArray(item.actions) && item.actions.every(a => object(a) && typeof a.id === 'string' && typeof a.text === 'string' && typeof a.done === 'boolean'), 'Invalid meeting actions.')
            if (key === 'tasks') assert(['todo','doing','done'].includes(item.status), 'Invalid task status.')
            if (key === 'exceptions') assert(['holiday','inset','part-day','cancelled','hours'].includes(item.kind), 'Invalid placement exception.')
            if (key === 'exceptions' && item.loggedMins !== undefined) assert(Number.isInteger(item.loggedMins) && item.loggedMins >= 0 && item.loggedMins <= 1440, 'Invalid logged minutes.')
            if (key === 'plans') assert(['subtask','milestone','block'].includes(item.kind), 'Invalid plan item.')
            if (key === 'plans' && item.effortMins !== undefined) assert(Number.isInteger(item.effortMins) && item.effortMins >= 0 && item.effortMins <= 100000, 'Invalid effort.')
            if (key === 'commitments') assert(['appointment','work','study'].includes(item.kind), 'Invalid commitment kind.')
            if (item.done !== undefined) assert(typeof item.done === 'boolean', 'Invalid completion flag.')
            if (item.busy !== undefined) assert(typeof item.busy === 'boolean', 'Invalid busy flag.')
            if (item.standards !== undefined) assert(Array.isArray(item.standards) && item.standards.every(x => typeof x === 'string'), 'Invalid admin standards.')
          }
        }
      }
      if (group === 'cache') {
        assert(object(value) && Number.isFinite(value.fetchedAt) && Array.isArray(value.sessions), 'Invalid history snapshot.')
        for (const e of [...value.sessions, ...(value.keyDates ?? [])]) assert(object(e) && typeof e.id === 'string' && typeof e.title === 'string' && validDate(e.dateISO) && validTime(e.start) && validTime(e.end), 'Invalid event snapshot.')
      }
      if (group === 'identities') {
        assert(Array.isArray(value), 'Invalid identity history.')
        for (const e of value) assert(object(e) && typeof e.id === 'string' && typeof e.title === 'string' && validDate(e.dateISO) && validTime(e.start) && validTime(e.end), 'Invalid event identity.')
      }
      if (group === 'changes') assert(Array.isArray(value), 'Invalid change history.')
    }
  }
  return data
}
export function validWorkerConfig(config) {
  try {
    validateTree(config)
    assert(object(config) && /^[\w-]{20,200}$/.test(config.sheetId), 'Invalid sheet ID.')
    if (config.profileId !== undefined) assert(typeof config.profileId === 'string' && /^[\w-]{1,100}$/.test(config.profileId), 'Invalid profile.')
    for (const key of ['gid','kdGid','noticesGid']) if (config[key] != null) assert(typeof config[key] === 'string' && /^\d{1,20}$/.test(config[key]), 'Invalid tab.')
    for (const key of ['kdSheetId','noticesSheetId']) if (config[key]) assert(typeof config[key] === 'string' && /^[\w-]{20,200}$/.test(config[key]), 'Invalid source.')
    for (const key of ['reminderOffsets','leaveAlertOffsets','keyDateReminderDays']) if (config[key] !== undefined) assert(Array.isArray(config[key]) && config[key].length <= 20 && config[key].every(n => Number.isInteger(n) && n >= 0 && n <= 10080), 'Invalid reminder offsets.')
    for (const key of ['myGroups','mySpecialisms','groups','specialisms']) if (config[key] !== undefined) assert(Array.isArray(config[key]) && config[key].length <= 100 && config[key].every(s => typeof s === 'string' && s.length <= 200), 'Invalid membership.')
    for (const key of ['quietFrom','quietTo']) if (config[key] !== undefined) assert(Number.isInteger(config[key]) && config[key]>=0 && config[key]<24, 'Invalid quiet hours.')
    if (config.travelMode !== undefined) assert(['walking','transit','driving'].includes(config.travelMode), 'Invalid travel mode.')
    if (config.placements !== undefined) {
      assert(object(config.placements) && Object.keys(config.placements).length <= 30, 'Invalid placements.')
      for (const p of Object.values(config.placements)) {
        assert(object(p), 'Invalid placement.')
        for (const key of ['lat','lng']) if (p[key] !== undefined) assert(Number.isFinite(p[key]) && Math.abs(p[key]) <= (key === 'lat' ? 90 : 180), 'Invalid coordinates.')
      }
    }
    return true
  } catch { return false }
}
