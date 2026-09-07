import { addAttachment, removeAttachment, readAttachments, attachmentUid, blobDataURL, withDataLock, replaceAttachments, decodeBase64 } from './attachments'
import type { Attachment } from './attachments'
export interface WalletFile extends Attachment { name: string; type: string; size: number }
export const WALLET_FILE_CAP = 10 * 1024 * 1024
export async function addWalletFile(owner: string, file: File): Promise<void> {
  if (file.size > WALLET_FILE_CAP) throw new Error('That file is over the 10MB wallet limit.')
  await addAttachment('wallet', { owner, name: file.name, type: file.type, size: file.size, blob: file, at: Date.now() })
}
export async function getWalletFiles(owner: string): Promise<WalletFile[]> {
  return (await readAttachments('wallet')).filter(f => f.owner === owner).sort((a,b) => b.at-a.at) as WalletFile[]
}
export const deleteWalletFile = (id: number) => removeAttachment('wallet', id)
export interface WalletExport { uid?: string; owner: string; name: string; type: string; at: number; data: string }
export async function exportWallet(): Promise<WalletExport[]> {
  return Promise.all((await readAttachments('wallet')).map(async f => ({ uid: await attachmentUid(f), owner: f.owner, name: f.name ?? 'Document', type: f.type ?? f.blob.type, at: f.at, data: (await blobDataURL(f.blob)).split(',')[1] })))
}
export async function prepareWallet(existing: Attachment[], items: WalletExport[]): Promise<Attachment[]> {
  const out = [...existing]
  const ids = new Map(await Promise.all(existing.map(async p => [await attachmentUid(p), p] as const)))
  let next = Math.max(0, ...out.map(p => p.id)) + 1
  for (const item of items) {
    const blob = decodeBase64(item.data, item.type)
    if (blob.size > WALLET_FILE_CAP) throw new Error('Backup contains a document over 10MB.')
    const candidate = { owner: item.owner, name: item.name, type: item.type, at: item.at, size: blob.size, blob }
    const uid = item.uid ?? await attachmentUid(candidate)
    const prior = ids.get(uid)
    if (prior) {
      if (prior.owner !== item.owner || await attachmentUid({ ...prior, uid: undefined }) !== await attachmentUid(candidate)) throw new Error('Conflicting document identity in backup.')
      continue
    }
    const added = { ...candidate, uid, id: next++ }
    out.push(added); ids.set(uid, added)
  }
  return out
}
export async function importWallet(items: WalletExport[]): Promise<void> {
  await withDataLock(async () => replaceAttachments('wallet', await prepareWallet(await readAttachments('wallet'), items)))
}
