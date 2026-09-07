import { addAttachment, removeAttachment, readAttachments, attachmentUid, blobDataURL, withDataLock, replaceAttachments, decodeBase64 } from './attachments'
import type { Attachment } from './attachments'
export interface StoredPhoto extends Attachment {}
export interface PhotoExport { uid?: string; owner: string; at: number; data: string }

/** Downscale to ≤1600px JPEG so photos stay a few hundred KB each. */
export async function compressImage(file: File | Blob, maxDim = 1600, quality = 0.8): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    return blob ?? file
  } catch {
    return file
  }
}

export async function addPhoto(pid: string, sessionKey: string, blob: Blob): Promise<void> {
  await addAttachment('photos', { owner: `${pid}|${sessionKey}`, blob, at: Date.now() })
}
export async function getPhotos(pid: string, sessionKey: string): Promise<StoredPhoto[]> {
  return (await readAttachments('photos')).filter(p => p.owner === `${pid}|${sessionKey}`)
}
export const deletePhoto = (id: number) => removeAttachment('photos', id)
export async function exportPhotos(): Promise<PhotoExport[]> {
  return Promise.all((await readAttachments('photos')).map(async p => ({ uid: await attachmentUid(p), owner: p.owner, at: p.at, data: await blobDataURL(p.blob) })))
}
export async function preparePhotos(existing: Attachment[], items: PhotoExport[]): Promise<Attachment[]> {
  const out = [...existing]
  const ids = new Map(await Promise.all(existing.map(async p => [await attachmentUid(p), p] as const)))
  let next = Math.max(0, ...out.map(p => p.id)) + 1
  for (const item of items) {
    const match = item.data.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s)
    if (!match) throw new Error('Backup contains an invalid photo.')
    const blob = decodeBase64(match[2], match[1])
    const candidate = { owner: item.owner, at: item.at, blob }
    const uid = item.uid ?? await attachmentUid(candidate)
    const prior = ids.get(uid)
    if (prior) {
      if (prior.owner !== item.owner || await attachmentUid({ ...prior, uid: undefined }) !== await attachmentUid(candidate)) throw new Error('Conflicting photo identity in backup.')
      continue
    }
    const added = { ...candidate, uid, id: next++ }
    out.push(added); ids.set(uid, added)
  }
  return out
}
export async function importPhotos(items: PhotoExport[]): Promise<void> {
  await withDataLock(async () => replaceAttachments('photos', await preparePhotos(await readAttachments('photos'), items)))
}
