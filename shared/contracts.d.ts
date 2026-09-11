export const MAX_BACKUP_BYTES: number
export const MAX_SYNC_BYTES: number
export const collections: readonly ['reflections','targets','meetings','observations','lessons','audits','tasks','exceptions','plans','commitments','placements','schools','programmes','packs','requirements','milestones','cycles','preps','goals','resources','projects','readings','contacts','questions','protected','supportNotes']
export const optionalCollections: readonly string[]
export const clientSourceTypes: readonly ['personal-reflection','learner-entered']
export const ADMIN_SCHEMA_VERSION: number
export function assert(condition: unknown, message: string): asserts condition
export function object(value: unknown): value is Record<string, any>
export function safeURL(value: unknown): boolean
export function validDate(value: unknown): boolean
export function validTime(value: unknown): boolean
export function validateTree(value: unknown, depth?: number): void
export function validateSettings(value: unknown): void
export function validatePayload(value: unknown): any
