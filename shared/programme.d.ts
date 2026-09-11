export const programmeRoutes: readonly string[]
export const programmePhases: readonly string[]
export const programmeModes: readonly string[]
export const packOwners: readonly string[]
export const milestoneKinds: readonly ['academic','training','review']
export const milestoneStates: readonly ['planned','done']
export const verificationStates: readonly ['unconfirmed','confirmed']
export interface PackRequirement { key: string; section: string; title: string; applicability?: string; effectiveFrom?: string; effectiveTo?: string; plannedValue?: string }
export interface PackMilestone { key: string; kind: 'academic'|'training'|'review'; title: string; date: string }
export interface ProgrammePack { packId: string; label: string; ownerSource: string; url?: string; version: number; requirements: PackRequirement[]; milestones: PackMilestone[] }
export function validateProgrammePack(input: unknown): { ok: boolean; errors: string[]; pack: ProgrammePack | null }
export function requirementId(packId: string, key: string): string
export function packMilestoneId(packId: string, key: string): string
export function diffProgrammePack(pack: ProgrammePack, existingRequirements: any[], existingMilestones: any[]): { added: any[]; changed: any[]; unchanged: any[]; removed: any[]; milestonesAdded: any[]; milestonesMoved: any[]; milestonesKept: any[] }
export function applyProgrammePack(pack: ProgrammePack, current: { packs: any[]; requirements: any[]; milestones: any[] }, now: number): { packs: any[]; requirements: any[]; milestones: any[]; diff: ReturnType<typeof diffProgrammePack> }
export function roadmapSummary(requirements: any[], milestones: any[], todayISO: string): { academic: { next: any | null; done: number; total: number }; training: { next: any | null; done: number; total: number }; nextReview: any | null; unconfirmed: number; requirements: number }
