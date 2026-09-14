import { useEffect, useRef, useState } from 'react'
import { decryptBytes, randomHex } from '../../shared/mentor.js'
import { DEFAULT_PUSH_BASE } from '../lib/config'

/**
 * Mentor portal (G4; operations reworked in Pass 78 for audit B05). A mentor
 * joins with an invitation link, sets a passphrase, and sees only the review
 * packs the learner shared with them — the exact text the learner previewed —
 * with attachments decrypted in the browser. Feedback they write goes back
 * signed; the learner's app shows it as reviewer-authenticated. No learner
 * data beyond the shared packs is reachable from here, and nothing here scores
 * anyone.
 *
 * Every operation runs through ONE status machine: `busy` names the operation
 * in flight, `failure` names what failed with a Retry that repeats exactly that
 * operation, and drafts survive failures. Requests are bounded by a timeout,
 * cleanup is in `finally`, and an epoch counter discards any late response
 * after sign-out or a route change. Feedback carries a client-generated id so
 * a retry after an uncertain outcome never duplicates.
 */

type Route = { kind: 'join'; spaceId: string; code: string; secret: string } | { kind: 'login'; spaceId: string; mentorId: string } | { kind: 'home' }
type Session = { spaceId: string; mentorId: string; name: string; session: string }
type Pack = { id: string; title: string; text: string; sharedAt: number; attachments: { id: string; name: string; size: number }[] }
type Feedback = { feedbackId: string; packId: string; text: string; at: number }
type Op = 'join' | 'login' | 'load' | 'send' | 'download'
type Failure = { op: Op; message: string; retry: () => void }

const SESSION_KEY = 'timetable.mentor.session.v1'
const REQUEST_TIMEOUT_MS = 15_000
const base = () => (typeof window !== 'undefined' && (window as unknown as { MENTOR_PUSH_BASE?: string }).MENTOR_PUSH_BASE) || DEFAULT_PUSH_BASE

function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/')
  if (parts[0] === 'join' && parts.length === 4) return { kind: 'join', spaceId: parts[1], code: parts[2].toUpperCase(), secret: parts[3] }
  if (parts[0] === 'space' && parts.length === 3) return { kind: 'login', spaceId: parts[1], mentorId: parts[2] }
  return { kind: 'home' }
}
const loadSession = (): Session | null => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}
const saveSession = (s: Session | null) => {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s))
    else sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* session-only convenience */
  }
}

/** What went wrong, in the mentor's terms. */
class PortalError extends Error {
  constructor(public readonly kind: 'connection' | 'expired' | 'ended' | 'refused' | 'service' | 'decrypt' | 'gone', message: string) {
    super(message)
  }
}
async function post<T>(path: string, body: unknown, signal: AbortSignal): Promise<{ ok: boolean; status: number; body: T }> {
  let res: Response
  try {
    res = await fetch(`${base().replace(/\/+$/, '')}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
  } catch {
    throw new PortalError('connection', 'Could not reach the mentor service — check your connection and retry.')
  }
  let parsed: unknown = {}
  try {
    parsed = await res.json()
  } catch {
    if (res.ok) throw new PortalError('service', 'The mentor service sent an unexpected reply — retry in a moment.')
  }
  return { ok: res.ok, status: res.status, body: (parsed && typeof parsed === 'object' ? parsed : {}) as T }
}
const refused = (res: { status: number; body: { error?: string } }, fallback: string): PortalError => {
  if (res.status === 401) return new PortalError('expired', 'Your session has expired — sign in again.')
  if (res.status === 403) return new PortalError('ended', res.body.error === 'wrong passphrase' ? 'That passphrase is not right.' : res.body.error === 'invitation not valid' ? 'That invitation is not valid — it may have been used or expired.' : 'Your access to this learner has been ended.')
  if (res.status === 410) return new PortalError('gone', 'That attachment has expired on the server — ask the learner to share it again.')
  if (res.status >= 500) return new PortalError('service', `The mentor service had a problem (status ${res.status}) — retry in a moment.`)
  return new PortalError('refused', res.body.error ?? fallback)
}
const fmt = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function MentorApp() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  const [session, setSession] = useState<Session | null>(() => loadSession())
  const [name, setName] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState<Op | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [packs, setPacks] = useState<Pack[] | null>(null)
  const [feedback, setFeedback] = useState<Feedback[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [clientIds, setClientIds] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<string | null>(null)
  // Anything started before the epoch moved (sign-out, or a route change away from this
  // session's own space) is discarded when it lands.
  const epoch = useRef(0)
  const sessionRef = useRef<Session | null>(session)
  sessionRef.current = session
  const invalidate = () => {
    epoch.current += 1
    setBusy(null)
  }
  useEffect(() => {
    const onHash = () => {
      const next = parseRoute(window.location.hash)
      const s = sessionRef.current
      const ownRoute = s && next.kind === 'login' && next.spaceId === s.spaceId && next.mentorId === s.mentorId
      if (!ownRoute) {
        invalidate()
        setFailure(null)
      }
      setRoute(next)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  /** Run one operation under the status machine. `work` receives the abort signal and an `alive` check for late results. */
  const run = (op: Op, work: (signal: AbortSignal, alive: () => boolean) => Promise<void>, retry: () => void) => {
    const token = ++epoch.current
    const alive = () => token === epoch.current
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
    setBusy(op)
    setFailure(null)
    setNotice(null)
    void (async () => {
      try {
        await work(ctrl.signal, alive)
      } catch (e) {
        if (!alive()) return
        const err = e instanceof PortalError ? e : new PortalError('service', e instanceof Error && e.message ? e.message : 'Something went wrong — retry.')
        if (err.kind === 'expired') {
          setSession(null)
          saveSession(null)
          setPacks(null)
        }
        setFailure({ op, message: err.message, retry })
      } finally {
        clearTimeout(timer)
        if (alive()) setBusy(null)
      }
    })()
  }

  const load = (s: Session) =>
    run('load', async (signal, alive) => {
      const res = await post<{ packs: Pack[]; feedback: Feedback[]; error?: string }>('/mentor/packs', { spaceId: s.spaceId, session: s.session }, signal)
      if (!res.ok) throw refused(res, 'Could not load the packs shared with you.')
      if (!Array.isArray(res.body.packs)) throw new PortalError('service', 'The mentor service sent an unexpected reply — retry in a moment.')
      if (!alive()) return
      setPacks(res.body.packs)
      setFeedback(Array.isArray(res.body.feedback) ? res.body.feedback : [])
    }, () => load(s))
  useEffect(() => {
    if (session) load(session)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.session])

  const join = () => {
    if (route.kind !== 'join') return
    const r = route
    run('join', async (signal, alive) => {
      const res = await post<{ mentorId: string; name: string; session: string; error?: string }>('/mentor/join', { spaceId: r.spaceId, code: r.code, secret: r.secret, name, passphrase }, signal)
      if (!res.ok) throw refused(res, 'That invitation is not valid.')
      if (!alive()) return
      const s = { spaceId: r.spaceId, mentorId: res.body.mentorId, name: res.body.name, session: res.body.session }
      setSession(s)
      saveSession(s)
      window.location.hash = `#/space/${r.spaceId}/${res.body.mentorId}`
    }, join)
  }
  const login = () => {
    if (route.kind !== 'login') return
    const r = route
    run('login', async (signal, alive) => {
      const res = await post<{ mentorId: string; name: string; session: string; error?: string }>('/mentor/login', { spaceId: r.spaceId, mentorId: r.mentorId, passphrase }, signal)
      if (!res.ok) throw refused(res, 'Could not sign in.')
      if (!alive()) return
      const s = { spaceId: r.spaceId, mentorId: res.body.mentorId, name: res.body.name, session: res.body.session }
      setSession(s)
      saveSession(s)
    }, login)
  }
  const send = (pack: Pack) => {
    if (!session) return
    const s = session
    const text = (draft[pack.id] ?? '').trim()
    if (!text) return
    // One client id per pack draft: a retry of the same text after an uncertain outcome is a replay, never a duplicate.
    const clientId = clientIds[pack.id] ?? `cl${randomHex(6)}`
    if (!clientIds[pack.id]) setClientIds({ ...clientIds, [pack.id]: clientId })
    run('send', async (signal, alive) => {
      const res = await post<{ feedbackId: string; at: number; error?: string }>('/mentor/feedback', { spaceId: s.spaceId, session: s.session, packId: pack.id, text, clientId }, signal)
      if (!res.ok) throw refused(res, 'Could not save your feedback.')
      if (!alive()) return
      setDraft((d) => ({ ...d, [pack.id]: '' }))
      setClientIds((c) => { const next = { ...c }; delete next[pack.id]; return next })
      setFeedback((f) => [...f, { feedbackId: res.body.feedbackId, packId: pack.id, text, at: res.body.at }])
      setNotice('Feedback saved. The learner can collect it in their app.')
    }, () => send(pack))
  }
  const download = (pack: Pack, att: { id: string; name: string }) => {
    if (!session) return
    const s = session
    run('download', async (signal, alive) => {
      const res = await post<{ name: string; key: string; iv: string; data: string; error?: string }>('/mentor/attachment', { spaceId: s.spaceId, session: s.session, packId: pack.id, attachmentId: att.id }, signal)
      if (!res.ok) throw refused(res, 'Could not fetch the attachment.')
      let bytes: Uint8Array
      try {
        bytes = await decryptBytes({ iv: res.body.iv, data: res.body.data }, res.body.key)
      } catch {
        throw new PortalError('decrypt', `${att.name} could not be decrypted — the copy on the server may be damaged. Ask the learner to share it again.`)
      }
      if (!alive()) return
      const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer]))
      const a = document.createElement('a')
      a.href = url
      a.download = res.body.name || att.name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setNotice(`${att.name} downloaded.`)
    }, () => download(pack, att))
  }
  const signOut = () => {
    invalidate()
    setSession(null)
    saveSession(null)
    setPacks(null)
    setFailure(null)
    setNotice(null)
  }

  const alert = failure && (
    <p className="mentor-error" role="alert">
      {failure.message}{' '}
      {failure.op !== 'join' && failure.op !== 'login' && <button type="button" className="mentor-link" onClick={failure.retry}>Retry</button>}
    </p>
  )

  if (!session) {
    return (
      <main className="mentor-page">
        <h1>Mentor portal</h1>
        {route.kind === 'join' ? (
          <section className="mentor-card" aria-label="Join">
            <p>You have been invited to see a trainee teacher's review packs and leave feedback. Choose a display name and a passphrase for this portal.</p>
            <label>Your name<input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
            <label>Passphrase (at least 8 characters)<input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="new-password" /></label>
            <button type="button" className="mentor-primary" disabled={busy !== null || !name.trim() || passphrase.length < 8} onClick={join}>{busy === 'join' ? 'Joining…' : failure?.op === 'join' ? 'Retry join' : 'Join'}</button>
          </section>
        ) : route.kind === 'login' ? (
          <section className="mentor-card" aria-label="Sign in">
            <p>Sign in with the passphrase you chose when you joined.</p>
            <label>Passphrase<input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="current-password" /></label>
            <button type="button" className="mentor-primary" disabled={busy !== null || !passphrase} onClick={login}>{busy === 'login' ? 'Signing in…' : failure?.op === 'login' ? 'Retry sign in' : 'Sign in'}</button>
          </section>
        ) : (
          <section className="mentor-card"><p>Open the invitation link the trainee sent you. There is nothing to see here without one.</p></section>
        )}
        {alert}
        <p className="mentor-foot">Only the packs shared with you are reachable here. This portal records feedback as text with your name and the time; it never scores or grades anyone.</p>
      </main>
    )
  }

  return (
    <main className="mentor-page">
      <header className="mentor-head">
        <h1>Mentor portal</h1>
        <p>Signed in as <strong>{session.name}</strong> · <button type="button" className="mentor-link" onClick={signOut}>Sign out</button></p>
      </header>
      <p className="mentor-notice" role="status" aria-live="polite">{notice ?? (busy === 'load' ? 'Loading your packs…' : busy === 'send' ? 'Saving your feedback…' : busy === 'download' ? 'Fetching and decrypting the attachment…' : '')}</p>
      {alert}
      {packs === null ? (
        busy === 'load' ? <p className="mentor-card">Loading…</p> : failure ? null : <p className="mentor-card">Nothing loaded yet. <button type="button" className="mentor-link" onClick={() => load(session)}>Load packs</button></p>
      ) : packs.length === 0 ? <p className="mentor-card">Nothing has been shared with you yet.</p> : (
        <ul className="mentor-packs" aria-label="Shared packs">
          {packs.map((p) => {
            const mine = feedback.filter((f) => f.packId === p.id)
            return (
              <li key={p.id} className="mentor-card">
                <button type="button" className="mentor-pack-head" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
                  <strong>{p.title}</strong>
                  <span>shared {fmt(p.sharedAt)} · {p.attachments.length} attachment{p.attachments.length === 1 ? '' : 's'} · {mine.length} feedback</span>
                </button>
                {open === p.id && (
                  <div className="mentor-pack-body">
                    <pre className="mentor-pack-text" aria-label={`Pack text: ${p.title}`}>{p.text}</pre>
                    {p.attachments.length > 0 && (
                      <ul className="mentor-attachments" aria-label="Attachments">
                        {p.attachments.map((a) => (
                          <li key={a.id}><button type="button" className="mentor-link" disabled={busy !== null} onClick={() => download(p, a)}>{a.name}</button> <span>({Math.max(1, Math.round(a.size / 1024))} KB, decrypted in your browser)</span></li>
                        ))}
                      </ul>
                    )}
                    {mine.length > 0 && (
                      <ul className="mentor-feedback" aria-label="Your feedback">
                        {mine.map((f) => (
                          <li key={f.feedbackId}><span>{fmt(f.at)}</span><p>{f.text}</p></li>
                        ))}
                      </ul>
                    )}
                    <label>Your feedback on this pack<textarea rows={5} aria-label={`Feedback: ${p.title}`} value={draft[p.id] ?? ''} onChange={(e) => setDraft({ ...draft, [p.id]: e.target.value })} /></label>
                    <button type="button" className="mentor-primary" disabled={busy !== null || !(draft[p.id] ?? '').trim()} onClick={() => send(p)}>{busy === 'send' ? 'Saving…' : failure?.op === 'send' ? 'Retry send' : 'Send feedback'}</button>
                    <p className="mentor-foot">Saved as you, with the time. The learner sees it as reviewer-authenticated feedback and cannot edit its text. Your draft stays here if saving fails.</p>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
