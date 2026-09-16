import { useEffect, useState } from 'react'
import { getWalletFiles } from '../lib/wallet'
import { attachmentUid } from '../lib/attachments'
import { newAdminId } from '../lib/admin'

export interface ResourceRef { id: string; kind: 'wallet' | 'link'; uid?: string; url?: string; label: string; at: number }

interface Props {
  resources: ResourceRef[]
  profileId: string
  onChange: (next: ResourceRef[]) => void
  /** the list's accessible name */
  label: string
  hint?: string
}

type WalletEntry = { uid: string; name: string }

/**
 * NF-05 (Pass 89): resources attached by stable wallet identity or by link —
 * never a copy of the bytes. Each wallet resource says On this device /
 * Missing on this device from the wallet's current contents; a missing one is
 * relinked in the data & sharing centre by uid. The same document can be
 * linked from several records without duplicating it.
 */
export function ResourceLinks({ resources, profileId, onChange, label, hint }: Props) {
  const [wallet, setWallet] = useState<WalletEntry[] | null>(null)
  const [draft, setDraft] = useState({ kind: 'wallet' as 'wallet' | 'link', uid: '', url: '', label: '' })
  useEffect(() => {
    let live = true
    void getWalletFiles(profileId)
      .then(async (files) => Promise.all(files.map(async (f) => ({ uid: await attachmentUid(f), name: f.name }))))
      .then((list) => { if (live) setWallet(list) })
      .catch(() => { if (live) setWallet([]) })
    return () => { live = false }
  }, [profileId])
  const nameOf = (uid?: string) => (uid ? wallet?.find((w) => w.uid === uid)?.name ?? null : null)
  const state = (uid?: string) => (!uid ? null : wallet === null ? 'checking' : nameOf(uid) ? 'present' : 'missing')
  const valid = draft.label.trim() && (draft.kind === 'wallet' ? !!draft.uid : /^https?:\/\//.test(draft.url))
  return (
    <div className="resource-links">
      {resources.length ? (
        <ul className="workspace-list" aria-label={label}>
          {resources.map((r) => (
            <li key={r.id} className="workspace-row requirement-row">
              <span>
                {r.kind === 'link' ? <a href={r.url} target="_blank" rel="noreferrer">{r.label}</a> : <>{r.label}<span className="filter-hint"> · {nameOf(r.uid) ?? 'document'}</span></>}
                {r.kind === 'wallet' ? <span className={`tag${state(r.uid) === 'missing' ? ' tag--amber' : ''}`}> {state(r.uid) === 'missing' ? 'Missing on this device' : state(r.uid) === 'present' ? 'On this device' : 'Checking…'}</span> : <span className="tag"> link</span>}
              </span>
              <button type="button" className="travel-link" aria-label={`Remove resource: ${r.label}`} onClick={() => onChange(resources.filter((x) => x.id !== r.id))}>Remove</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="filter-hint">{hint ?? 'No resources yet — link a wallet document or a web page.'}</p>
      )}
      <div className="task-edit-row">
        <select className="date-input" aria-label={`${label}: kind`} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as 'wallet' | 'link' })}>
          <option value="wallet">Wallet document</option>
          <option value="link">Link</option>
        </select>
        {draft.kind === 'wallet' ? (
          <select className="date-input" aria-label={`${label}: document`} value={draft.uid} onChange={(e) => setDraft({ ...draft, uid: e.target.value })}>
            <option value="">{wallet === null ? 'Loading wallet…' : wallet.length ? 'Choose a document' : 'No documents in your wallet yet'}</option>
            {(wallet ?? []).map((w) => (
              <option key={w.uid} value={w.uid}>{w.name}</option>
            ))}
          </select>
        ) : (
          <input type="url" className="placement-input" aria-label={`${label}: link`} placeholder="https://…" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
        )}
        <input type="text" className="placement-input" aria-label={`${label}: label`} placeholder="Label" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        <button type="button" className="btn-today-reset" disabled={!valid} onClick={() => { onChange([...resources, { id: newAdminId(), kind: draft.kind, label: draft.label.trim(), at: Date.now(), ...(draft.kind === 'wallet' ? { uid: draft.uid } : { url: draft.url.trim() }) }]); setDraft({ kind: draft.kind, uid: '', url: '', label: '' }) }}>Add resource</button>
      </div>
    </div>
  )
}
