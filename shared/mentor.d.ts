export const MENTOR_INVITE_TTL_MS: number
export const MENTOR_SESSION_TTL_MS: number
export const MENTOR_ATTACHMENT_MAX_BYTES: number
export const MENTOR_ATTACHMENTS_PER_PACK: number
export const MENTOR_PACK_TEXT_MAX: number
export const MENTOR_FEEDBACK_MAX: number
export const MENTOR_MIN_PASSPHRASE: number
export const MENTOR_ATTACHMENT_TTL_S: number
export function isSpaceId(v: unknown): boolean
export function isOwnerToken(v: unknown): boolean
export function isInviteCode(v: unknown): boolean
export function isHex(v: unknown, n: number): boolean
export function isRecordId(v: unknown): boolean
export function randomHex(bytes: number): string
export function randomInviteCode(): string
export function bytesToBase64(bytes: Uint8Array): string
export function base64ToBytes(b64: string): Uint8Array
export function sha256Hex(text: string): Promise<string>
export function hmacHex(keyHex: string, text: string): Promise<string>
export function constantEquals(a: unknown, b: unknown): boolean
export function hashPassphrase(passphrase: string, saltHex: string): Promise<string>
export interface EncryptedBlob { iv: string; data: string }
export function encryptBytes(bytes: Uint8Array, keyHex: string): Promise<EncryptedBlob>
export function decryptBytes(blob: EncryptedBlob, keyHex: string): Promise<Uint8Array>
export function encryptText(text: string, keyHex: string): Promise<EncryptedBlob>
export function decryptText(blob: EncryptedBlob, keyHex: string): Promise<string>
export interface Attestation { spaceId: string; mentorId: string; mentorName: string; feedbackId: string; at: number; sig: string }
export function attestationString(a: Pick<Attestation, 'spaceId' | 'mentorId' | 'feedbackId' | 'at'>, text: string): string
export function validAttestation(a: unknown): boolean
export function cleanName(n: unknown): string
export function cleanText(t: unknown, max: number): string
