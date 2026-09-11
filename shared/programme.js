/**
 * PG-01 programme roadmap (G1a): a course profile, imported requirement packs
 * and dated milestones. Runtime-neutral (app + node tests). Nothing here
 * derives an outcome: a requirement's verification is set only by the learner
 * ("Confirmed by you from <source>") and a milestone is done only when they
 * say so. There is no built-in day target — an unconfirmed rule reads
 * "Requirements not yet confirmed", never a shortfall.
 */

export const programmeRoutes = ['pgce-qts', 'pgce', 'qts-only', 'other']
export const programmePhases = ['primary', 'secondary', 'other']
export const programmeModes = ['full-time', 'part-time']
export const packOwners = ['provider', 'dfe', 'school', 'self', 'other']
export const milestoneKinds = ['academic', 'training', 'review']
export const milestoneStates = ['planned', 'done']
export const verificationStates = ['unconfirmed', 'confirmed']

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'))
const str = (v, max = 400) => typeof v === 'string' && v.length <= max
const key = (v) => typeof v === 'string' && /^[\w.-]{1,60}$/.test(v)

/**
 * Validate a pack JSON document. Returns { ok, errors, pack } where `pack` is a
 * whitelist rebuild (unknown fields dropped, nothing else invented).
 */
export function validateProgrammePack(input) {
  const errors = []
  const p = input && typeof input === 'object' && !Array.isArray(input) ? input : null
  if (!p) return { ok: false, errors: ['A pack is a JSON object.'], pack: null }
  if (!key(p.packId)) errors.push('packId: letters, digits, dot, dash or underscore (max 60).')
  if (!str(p.label, 120) || !p.label) errors.push('label: required, max 120 characters.')
  if (!packOwners.includes(p.ownerSource)) errors.push(`ownerSource: one of ${packOwners.join(', ')}.`)
  if (p.url !== undefined && !(str(p.url, 500) && /^https?:\/\//.test(p.url))) errors.push('url: must start with http(s)://.')
  if (!Number.isInteger(p.version) || p.version < 1 || p.version > 100000) errors.push('version: a whole number from 1.')
  if (!Array.isArray(p.requirements) || p.requirements.length > 500) errors.push('requirements: an array (max 500).')
  const requirements = []
  const seen = new Set()
  for (const [i, r] of (Array.isArray(p.requirements) ? p.requirements : []).entries()) {
    const at = `requirements[${i}]`
    if (!r || typeof r !== 'object') { errors.push(`${at}: an object.`); continue }
    if (!key(r.key)) errors.push(`${at}.key: letters, digits, dot, dash or underscore.`)
    else if (seen.has(r.key)) errors.push(`${at}.key: duplicate "${r.key}".`)
    seen.add(r.key)
    if (!str(r.section, 120) || !r.section) errors.push(`${at}.section: required.`)
    if (!str(r.title, 300) || !r.title) errors.push(`${at}.title: required.`)
    if (r.applicability !== undefined && !str(r.applicability, 80)) errors.push(`${at}.applicability: text, max 80.`)
    if (r.effectiveFrom !== undefined && !isDate(r.effectiveFrom)) errors.push(`${at}.effectiveFrom: yyyy-mm-dd.`)
    if (r.effectiveTo !== undefined && !isDate(r.effectiveTo)) errors.push(`${at}.effectiveTo: yyyy-mm-dd.`)
    if (r.plannedValue !== undefined && !str(r.plannedValue, 120)) errors.push(`${at}.plannedValue: text, max 120.`)
    const out = { key: r.key, section: r.section, title: r.title }
    for (const f of ['applicability', 'effectiveFrom', 'effectiveTo', 'plannedValue']) if (r[f] !== undefined) out[f] = r[f]
    requirements.push(out)
  }
  const milestones = []
  const mseen = new Set()
  if (p.milestones !== undefined && (!Array.isArray(p.milestones) || p.milestones.length > 200)) errors.push('milestones: an array (max 200).')
  for (const [i, m] of (Array.isArray(p.milestones) ? p.milestones : []).entries()) {
    const at = `milestones[${i}]`
    if (!m || typeof m !== 'object') { errors.push(`${at}: an object.`); continue }
    if (!key(m.key)) errors.push(`${at}.key: letters, digits, dot, dash or underscore.`)
    else if (mseen.has(m.key)) errors.push(`${at}.key: duplicate "${m.key}".`)
    mseen.add(m.key)
    if (!milestoneKinds.includes(m.kind)) errors.push(`${at}.kind: one of ${milestoneKinds.join(', ')}.`)
    if (!str(m.title, 200) || !m.title) errors.push(`${at}.title: required.`)
    if (!isDate(m.date)) errors.push(`${at}.date: yyyy-mm-dd.`)
    milestones.push({ key: m.key, kind: m.kind, title: m.title, date: m.date })
  }
  if (errors.length) return { ok: false, errors, pack: null }
  const pack = { packId: p.packId, label: p.label, ownerSource: p.ownerSource, version: p.version, requirements, milestones }
  if (p.url !== undefined) pack.url = p.url
  return { ok: true, errors: [], pack }
}

export const requirementId = (packId, k) => `${packId}:${k}`
export const packMilestoneId = (packId, k) => `${packId}:m:${k}`

/**
 * Preview what applying `pack` changes against the requirements/milestones
 * already stored for that packId. Pure; the sheet shows it before anything
 * is written. A changed requirement loses its confirmation (the learner
 * confirmed the OLD wording), an unchanged one keeps it.
 */
export function diffProgrammePack(pack, existingRequirements, existingMilestones) {
  const mine = existingRequirements.filter((r) => r.packId === pack.packId)
  const byId = new Map(mine.map((r) => [r.id, r]))
  const added = [], changed = [], unchanged = []
  const incomingIds = new Set()
  for (const r of pack.requirements) {
    const id = requirementId(pack.packId, r.key)
    incomingIds.add(id)
    const old = byId.get(id)
    if (!old) { added.push({ id, ...r }); continue }
    const same = old.section === r.section && old.title === r.title && (old.plannedValue ?? undefined) === r.plannedValue && (old.applicability ?? undefined) === r.applicability && (old.effectiveFromISO ?? undefined) === r.effectiveFrom && (old.effectiveToISO ?? undefined) === r.effectiveTo
    ;(same ? unchanged : changed).push({ id, ...r, previous: old })
  }
  const removed = mine.filter((r) => !incomingIds.has(r.id))
  const mineMs = new Map(existingMilestones.filter((m) => m.packId === pack.packId).map((m) => [m.id, m]))
  const milestonesAdded = [], milestonesMoved = [], milestonesKept = []
  for (const m of pack.milestones) {
    const id = packMilestoneId(pack.packId, m.key)
    const old = mineMs.get(id)
    if (!old) milestonesAdded.push({ id, ...m })
    else if (old.state === 'done') milestonesKept.push({ id, ...m, previous: old })
    else if (old.dateISO !== m.date || old.title !== m.title) milestonesMoved.push({ id, ...m, previous: old })
    else milestonesKept.push({ id, ...m, previous: old })
  }
  return { added, changed, unchanged, removed, milestonesAdded, milestonesMoved, milestonesKept }
}

/**
 * Apply a validated pack: returns new `packs`, `requirements` and `milestones`
 * arrays (records for OTHER packs untouched by reference). Done milestones are
 * never moved; a review already held keeps the pack version it was held under.
 */
export function applyProgrammePack(pack, current, now) {
  const diff = diffProgrammePack(pack, current.requirements, current.milestones)
  const packRec = current.packs.find((p) => p.id === pack.packId)
  const nextPack = { ...(packRec ?? { id: pack.packId, at: 0 }), label: pack.label, ownerSource: pack.ownerSource, version: pack.version, importedAt: now, at: now }
  if (pack.url !== undefined) nextPack.url = pack.url
  const packs = packRec ? current.packs.map((p) => (p.id === pack.packId ? nextPack : p)) : [...current.packs, nextPack]
  const removedIds = new Set(diff.removed.map((r) => r.id))
  const toRec = (r, prev) => {
    const rec = { id: r.id, packId: pack.packId, packVersion: pack.version, section: r.section, title: r.title, verification: 'unconfirmed', at: now }
    if (r.applicability !== undefined) rec.applicability = r.applicability
    if (r.effectiveFrom !== undefined) rec.effectiveFromISO = r.effectiveFrom
    if (r.effectiveTo !== undefined) rec.effectiveToISO = r.effectiveTo
    if (r.plannedValue !== undefined) rec.plannedValue = r.plannedValue
    if (prev && prev.verification === 'confirmed') { rec.verification = 'confirmed'; if (prev.confirmedSource) rec.confirmedSource = prev.confirmedSource; if (prev.confirmedAt) rec.confirmedAt = prev.confirmedAt }
    return rec
  }
  const kept = current.requirements.filter((r) => r.packId !== pack.packId || (!removedIds.has(r.id) && diff.unchanged.some((u) => u.id === r.id)))
  const keptForPack = kept.filter((r) => r.packId === pack.packId).map((r) => ({ ...r, packVersion: pack.version }))
  const requirements = [
    ...kept.filter((r) => r.packId !== pack.packId),
    ...keptForPack,
    ...diff.changed.map((r) => toRec(r, null)),
    ...diff.added.map((r) => toRec(r, null)),
  ]
  const movedIds = new Set(diff.milestonesMoved.map((m) => m.id))
  const keptPlanned = new Set(diff.milestonesKept.filter((m) => m.previous.state !== 'done').map((m) => m.id))
  const milestones = [
    ...current.milestones.map((m) =>
      movedIds.has(m.id)
        ? { ...m, dateISO: diff.milestonesMoved.find((x) => x.id === m.id).date, title: diff.milestonesMoved.find((x) => x.id === m.id).title, packVersion: pack.version, at: now }
        : keptPlanned.has(m.id) && m.packVersion !== pack.version
          ? { ...m, packVersion: pack.version, at: now }
          : m
    ),
    ...diff.milestonesAdded.map((m) => ({ id: m.id, packId: pack.packId, packVersion: pack.version, kind: m.kind, title: m.title, dateISO: m.date, state: 'planned', at: now })),
  ]
  return { packs, requirements, milestones, diff }
}

/** The roadmap summary shown on the PGCE file: two pathways, one next review, unconfirmed count. */
export function roadmapSummary(requirements, milestones, todayISO) {
  const upcoming = (kind) => milestones.filter((m) => m.kind === kind && m.state !== 'done' && m.dateISO >= todayISO).sort((a, b) => a.dateISO.localeCompare(b.dateISO))[0] ?? null
  const done = (kind) => milestones.filter((m) => m.kind === kind && m.state === 'done').length
  const total = (kind) => milestones.filter((m) => m.kind === kind).length
  return {
    academic: { next: upcoming('academic'), done: done('academic'), total: total('academic') },
    training: { next: upcoming('training'), done: done('training'), total: total('training') },
    nextReview: upcoming('review'),
    unconfirmed: requirements.filter((r) => r.verification !== 'confirmed').length,
    requirements: requirements.length,
  }
}
