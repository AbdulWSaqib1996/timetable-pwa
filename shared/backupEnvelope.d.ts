export const ENVELOPE_FORMAT: string
export const ENVELOPE_VERSION: number
export const KDF_ITERATIONS: number
export const MIN_PASSPHRASE_LENGTH: number

export function bytesToBase64(bytes: Uint8Array): string
export function base64ToBytes(b64: string): Uint8Array
export function isEnvelope(text: string): boolean
export function sealBackup(
  plaintext: string,
  passphrase: string,
  opts?: { salt?: Uint8Array; iv?: Uint8Array; iterations?: number; compression?: 'gzip' | 'none'; createdAt?: string }
): Promise<string>
export type OpenBackupResult =
  | { ok: true; plaintext: string; createdAt: string | null }
  | { ok: false; reason: 'not-an-envelope' | 'unsupported-version' | 'malformed' | 'wrong-passphrase-or-corrupt' }
export function openBackup(text: string, passphrase: string): Promise<OpenBackupResult>
