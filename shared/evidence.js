import { canonical } from './merge.js'

/**
 * G3 — evidence narratives (PG-06), the experience ledger (PG-07) and review
 * packs / handover (PG-09). Runtime-neutral, pure. Frameworks stay separate:
 * ITTECF areas and Teachers' Standards are two lists with no combined score;
 * Part Two is a list of conduct CONTEXTS, not a judgement. A review pack pins
 * the canonical JSON of each record at selection time, so an old pack stays
 * readable after the source changes; the export text is built by the same
 * function as the preview, so what leaves the device is exactly what was shown.
 */

export const EXAMPLE_CONTEXTS = ['course-curriculum', 'practice-cycle', 'provider-assessment']
export const ITTECF_AREAS = [
  { id: 'high-expectations', label: 'High expectations' },
  { id: 'how-pupils-learn', label: 'How pupils learn' },
  { id: 'subject-curriculum', label: 'Subject and curriculum' },
  { id: 'classroom-practice', label: 'Classroom practice' },
  { id: 'adaptive-teaching', label: 'Adaptive teaching' },
  { id: 'assessment', label: 'Assessment' },
  { id: 'managing-behaviour', label: 'Managing behaviour' },
  { id: 'professional-behaviours', label: 'Professional behaviours' },
]
export const PART_TWO_CONTEXTS = [
  { id: 'conduct-in-school', label: 'Personal and professional conduct in school' },
  { id: 'wider-responsibilities', label: 'Wider responsibilities and the school ethos' },
  { id: 'statutory-frameworks', label: 'Statutory frameworks' },
]
export const EXPERIENCE_TYPES = ['mentor-meeting', 'observation', 'teaching', 'itap', 'other']
export const EXPERIENCE_LAYERS = ['planned', 'learner-logged', 'discussed-reviewed', 'provider-outcome-reference']
export const PACK_STATES = ['selected', 'draft', 'discussed']
export const PACK_ITEM_KINDS = ['example', 'lesson', 'observation', 'meeting', 'reflection']

/** Snapshot a record for a pack: canonical JSON plus its revision (`at`). */
export function pinRecord(kind, record, caption) {
  const item = { kind, id: record.id, revision: record.at ?? 0, snapshot: canonical(record) }
  if (caption) item.caption = caption
  if (kind === 'observation') item.provenance = record.sourceType === 'reviewer-authenticated' ? 'Reviewer-authenticated' : record.sourceType === 'personal-reflection' ? 'Your reflection' : 'Entered by you'
  return item
}

/** True when the live record has moved on from the pinned revision (the pack still shows the pinned one). */
export const pinStale = (item, live) => !!live && (live.at ?? 0) > item.revision

const line = (label, value) => (value ? `${label}: ${value}` : null)

/**
 * The review pack as text — used for BOTH the on-screen preview and the file
 * that leaves the device, so they cannot differ. Attachments are listed with
 * their state; a pack never carries file bytes.
 */
export function buildReviewPackText(pack, examples) {
  const out = []
  out.push(`REVIEW PACK — ${pack.title}`)
  out.push(`State: ${pack.state}${pack.discussedISO ? ` (discussed ${pack.discussedISO})` : ''} · created ${pack.createdISO} · prepared by the learner`)
  if (pack.notes) out.push(`Notes: ${pack.notes}`)
  out.push('')
  for (const item of pack.items ?? []) {
    let rec
    try { rec = JSON.parse(item.snapshot) } catch { rec = null }
    if (!rec) { out.push(`[${item.kind}] unreadable snapshot`); continue }
    const head = item.kind === 'example' ? `EXAMPLE — ${rec.title}` : item.kind === 'lesson' ? `LESSON — ${rec.dateISO} ${rec.subject || ''}` : item.kind === 'observation' ? `FEEDBACK — ${rec.dateISO} ${rec.observer || ''}` : item.kind === 'meeting' ? `MENTOR MEETING — ${rec.dateISO}` : `REFLECTION — week of ${rec.weekISO}`
    out.push(`${head} (pinned revision ${item.revision})`)
    if (item.provenance) out.push(`Provenance: ${item.provenance}`)
    if (item.caption) out.push(`Caption: ${item.caption}`)
    if (item.kind === 'example') {
      out.push(`Context: ${rec.context}`)
      for (const [k, label] of [['context', 'Situation'], ['decision', 'Decision'], ['noticed', 'What I noticed'], ['changedNext', 'What I changed next']]) { const l = line(label, rec.narrative?.[k]); if (l) out.push(l) }
      if (rec.ittecf?.length) out.push(`ITTECF areas: ${rec.ittecf.join(', ')}`)
      if (rec.standards?.length) out.push(`Teachers' Standards: ${rec.standards.join(', ')}`)
      if (rec.partTwo?.length) out.push(`Part Two contexts: ${rec.partTwo.join(', ')}`)
      if (rec.refs?.length) out.push(`Source records: ${rec.refs.map((r) => `${r.entityType}:${r.entityId}`).join(', ')}`)
      const missing = (rec.refs ?? []).filter((r) => !(examples?.resolve?.(r) ?? true))
      if (missing.length) out.push(`(${missing.length} source record${missing.length === 1 ? '' : 's'} no longer present)`)
    } else {
      for (const [k, label] of [['intention', 'Intention'], ['evaluation', 'Evaluation'], ['strengths', 'Strengths'], ['development', 'Development'], ['discussed', 'Discussed'], ['wentWell', 'Went well'], ['challenges', 'Challenges'], ['focus', 'Focus']]) { const l = line(label, rec[k]); if (l) out.push(l) }
      if (rec.standards?.length) out.push(`Teachers' Standards: ${rec.standards.join(', ')}`)
    }
    out.push('')
  }
  if ((pack.attachments ?? []).length) {
    out.push('ATTACHMENTS (files stay on the device; listed by name only)')
    for (const a of pack.attachments) out.push(`- ${a.name} — ${a.state === 'missing' ? 'missing on this device' : 'on this device only'}`)
    out.push('')
  }
  out.push('Nothing in this pack is an assessment or an award. Judgements quoted carry their source.')
  return out.join('\n')
}

/** Same date + type + source is a double count, unless the learner is logging a different layer. */
export function isDuplicateExperience(entries, candidate) {
  return entries.some((e) => e.id !== candidate.id && e.dateISO === candidate.dateISO && e.type === candidate.type && e.layer === candidate.layer && (e.sourceRef ?? '') === (candidate.sourceRef ?? '') && (e.placementId ?? '') === (candidate.placementId ?? ''))
}

/**
 * Totals per layer and type for one placement (or all). Durations are only
 * what was entered — nothing is inferred; entries without a duration count as
 * occurrences only. Layers are never summed together.
 */
export function experienceSummary(entries, placementId) {
  const mine = entries.filter((e) => !placementId || e.placementId === placementId)
  const layers = {}
  for (const layer of EXPERIENCE_LAYERS) {
    const rows = mine.filter((e) => e.layer === layer)
    const byType = {}
    for (const t of EXPERIENCE_TYPES) {
      const of = rows.filter((e) => e.type === t)
      byType[t] = { count: of.length, mins: of.reduce((n, e) => n + (Number.isFinite(e.durationMins) ? e.durationMins : 0), 0), untimed: of.filter((e) => !Number.isFinite(e.durationMins)).length, days: new Set(of.map((e) => e.dateISO)).size }
    }
    layers[layer] = { count: rows.length, byType, days: new Set(rows.map((e) => e.dateISO)).size }
  }
  return { placementId: placementId ?? null, layers }
}

/** Parse "120 days" / "6" / "24 h" from a confirmed requirement's planned value; null when not a number. */
export function plannedNumber(value) {
  const m = /(\d+(?:\.\d+)?)/.exec(value ?? '')
  return m ? Number(m[1]) : null
}

/**
 * Compare a total against a CONFIRMED requirement only. Without one there is
 * a total and no deficit, never a shortfall.
 */
export function compareToRequirement(total, requirement) {
  if (!requirement || requirement.verification !== 'confirmed') return { total, target: null, sentence: `${total} recorded — no confirmed requirement to compare against` }
  const target = plannedNumber(requirement.plannedValue)
  if (target === null) return { total, target: null, sentence: `${total} recorded — the confirmed requirement "${requirement.title}" has no numeric value` }
  return { total, target, sentence: `${total} of ${target} (${requirement.title}, confirmed by you${requirement.confirmedSource ? ` from ${requirement.confirmedSource}` : ''})` }
}

/** Provider-conversation export: every value with its source, layers apart. */
export function buildExperienceText(summary, placementLabel, comparisons) {
  const out = [`EXPERIENCE SUMMARY — ${placementLabel}`, 'Each figure names its source. Layers are reported separately and never added together.', '']
  for (const layer of EXPERIENCE_LAYERS) {
    const l = summary.layers[layer]
    out.push(`${layer.toUpperCase()} (source: ${layer === 'planned' ? 'timetable / plan' : layer === 'learner-logged' ? 'entered by the learner' : layer === 'discussed-reviewed' ? 'discussed with the mentor, recorded by the learner' : 'a provider outcome the learner referenced'}): ${l.count} entr${l.count === 1 ? 'y' : 'ies'} on ${l.days} day${l.days === 1 ? '' : 's'}`)
    for (const t of EXPERIENCE_TYPES) {
      const b = l.byType[t]
      if (!b.count) continue
      out.push(`  ${t}: ${b.count} on ${b.days} day${b.days === 1 ? '' : 's'}${b.mins ? `, ${b.mins} min entered` : ''}${b.untimed ? `, ${b.untimed} without a duration (not inferred)` : ''}`)
    }
  }
  if (comparisons?.length) { out.push(''); for (const c of comparisons) out.push(c.sentence) }
  return out.join('\n')
}

/**
 * First-post handover: examples, frameworks referenced, experience by layer,
 * review next steps — with private notes, contacts and identifiers left out.
 * The text says who prepared it and that nobody has received it.
 */
export function buildHandoverText({ examples, experience, reviews, placements, schools }) {
  const out = ['HANDOVER PACK — prepared by the learner for their own use', 'Private notes, contacts, addresses and identifiers are not included. This pack has not been sent to, or received by, any induction body.', '']
  out.push(`EVIDENCE EXAMPLES (${examples.length})`)
  for (const e of examples) {
    out.push(`- ${e.title} [${e.context}]`)
    if (e.ittecf?.length) out.push(`  ITTECF: ${e.ittecf.join(', ')}`)
    if (e.standards?.length) out.push(`  Teachers' Standards: ${e.standards.join(', ')}`)
    if (e.partTwo?.length) out.push(`  Part Two contexts: ${e.partTwo.join(', ')}`)
    if (e.narrative?.changedNext) out.push(`  Changed next: ${e.narrative.changedNext}`)
  }
  out.push('')
  for (const p of placements) {
    const school = schools.find((s) => s.id === p.schoolLocationId)
    const s = experienceSummary(experience, p.id)
    out.push(`PLACEMENT ${p.code}${school?.name ? ` — ${school.name}` : ''}${p.startISO ? ` (${p.startISO} to ${p.endISO ?? '?'})` : ''}`)
    for (const layer of EXPERIENCE_LAYERS) out.push(`  ${layer}: ${s.layers[layer].count} entries on ${s.layers[layer].days} days`)
  }
  out.push('')
  out.push(`REVIEWS (${reviews.length})`)
  for (const r of reviews) {
    out.push(`- ${r.dateISO}${r.focus ? ` — ${r.focus}` : ''}`)
    if (r.providerJudgement?.text) out.push(`  Provider view (source: ${r.providerJudgement.source || 'not given'}): ${r.providerJudgement.text}`)
    if (r.nextSteps) out.push(`  Next steps: ${r.nextSteps}`)
  }
  return out.join('\n')
}
