export const EXAMPLE_CONTEXTS: readonly ['course-curriculum','practice-cycle','provider-assessment']
export const ITTECF_AREAS: readonly { id: string; label: string }[]
export const PART_TWO_CONTEXTS: readonly { id: string; label: string }[]
export const EXPERIENCE_TYPES: readonly ['mentor-meeting','observation','teaching','itap','other']
export const EXPERIENCE_LAYERS: readonly ['planned','learner-logged','discussed-reviewed','provider-outcome-reference']
export const PACK_STATES: readonly ['selected','draft','discussed']
export const PACK_ITEM_KINDS: readonly ['example','lesson','observation','meeting','reflection']
export interface PackItem { kind: string; id: string; revision: number; snapshot: string; caption?: string; provenance?: string }
export function pinRecord(kind: string, record: any, caption?: string): PackItem
export function pinStale(item: PackItem, live: any): boolean
export function buildReviewPackText(pack: any, examples?: { resolve?: (ref: any) => boolean }): string
export function isDuplicateExperience(entries: any[], candidate: any): boolean
export interface ExperienceSummary { placementId: string | null; layers: Record<string, { count: number; days: number; byType: Record<string, { count: number; mins: number; untimed: number; days: number }> }> }
export function experienceSummary(entries: any[], placementId?: string | null): ExperienceSummary
export function plannedNumber(value?: string): number | null
export function compareToRequirement(total: number, requirement: any): { total: number; target: number | null; sentence: string }
export function buildExperienceText(summary: ExperienceSummary, placementLabel: string, comparisons?: { sentence: string }[]): string
export function buildHandoverText(input: { examples: any[]; experience: any[]; reviews: any[]; placements: any[]; schools: any[] }): string
