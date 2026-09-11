import { useEffect, useState } from 'react'
import { decryptBytes } from '../../shared/mentor.js'
import { DEFAULT_PUSH_BASE } from '../lib/config'

/**
 * Mentor portal (G4). A mentor joins with an invitation link, sets a
 * passphrase, and sees only the review packs the learner shared with them —
 * the exact text the learner previewed — with attachments decrypted in the
 * browser. Feedback they write goes back signed; the learner's app shows it
 * as reviewer-authenticated. No learner data beyond the shared packs is
 * reachable from here, and nothing here scores anyone.
 */

type Route = { kind: 'join'; spaceId: string; code: string; secret: string } | { kind: 'login'; spaceId: string; mentorId: string } | { kind: 'home' }
type Session = { spaceId: string; mentorId: string; name: string; session: string }
type Pack = { id: string; title: string; text: string; sharedAt: number; attachments: { id: string; name: string; size: number }[] }
type Feedback = { feedbackId: string; packId: string; text: string; at: number }

const SESSION_KEY = 'timetable.mentor.session.v1'
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
async function post<T>(path: string, body: unknown): Promise<{ ok: boolean; status: number; body: T }> {
  const res = await fetch(`${base().replace(/\/+$/, '')}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as T }
}
const fmt = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function MentorApp() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  const [session, setSession] = useState<Session | null>(() => loadSession())
  const [name, setName] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [packs, setPacks] = useState<Pack[] | null>(null)
  const [feedback, setFeedback] = useState<Feedback[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const load = async (s: Session) => {
    const res = await post<{ packs: Pack[]; feedback: Feedback[]; error?: string }>('/mentor/packs', { spaceId: s.spaceId, session: s.session })
    if (res.status === 401) {
      setSession(null)
      saveSession(null)
      setError('Your session has ended — sign in again.')
      return
    }
    if (!res.ok) {
      setError('Could not load the packs shared with you.')
      return
    }
    setPacks(res.body.packs)
    setFeedback(res.body.feedback)
  }
  useEffect(() => {
    if (session) void load(session)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.session])

  const join = async () => {
    if (route.kind !== 'join') return
    setBusy(true)
    setError(null)
    const res = await post<{ mentorId: string; name: string; session: string; error?: string }>('/mentor/join', { spaceId: route.spaceId, code: route.code, secret: route.secret, name, passphrase })
    setBusy(false)
    if (!res.ok) {
      setError(res.body.error ?? 'That invitation is not valid.')
      return
    }
    const s = { spaceId: route.spaceId, mentorId: res.body.mentorId, name: res.body.name, session: res.body.session }
    setSession(s)
    saveSession(s)
    window.location.hash = `#/space/${route.spaceId}/${res.body.mentorId}`
  }
  const login = async () => {
    if (route.kind !== 'login') return
    setBusy(true)
    setError(null)
    const res = await post<{ mentorId: string; name: string; session: string; error?: string }>('/mentor/login', { spaceId: route.spaceId, mentorId: route.mentorId, passphrase })
    setBusy(false)
    if (!res.ok) {
      setError(res.body.error === 'access is not active' ? 'Your access to this learner has been ended.' : res.body.error ?? 'Could not sign in.')
      return
    }
    const s = { spaceId: route.spaceId, mentorId: res.body.mentorId, name: res.body.name, session: res.body.session }
    setSession(s)
    saveSession(s)
  }
  const send = async (pack: Pack) => {
    if (!session) return
    const text = (draft[pack.id] ?? '').trim()
    if (!text) return
    setBusy(true)
    const res = await post<{ feedbackId: string; at: number; error?: string }>('/mentor/feedback', { spaceId: session.spaceId, session: session.session, packId: pack.id, text })
    setBusy(false)
    if (!res.ok) {
      setError(res.body.error ?? 'Could not send feedback.')
      return
    }
    setDraft({ ...draft, [pack.id]: '' })
    setNotice('Feedback sent — signed and delivered to the learner’s app.')
    void load(session)
  }
  const download = async (pack: Pack, att: { id: string; name: string }) => {
    if (!session) return
    const res = await post<{ name: string; key: string; iv: string; data: string; error?: string }>('/mentor/attachment', { spaceId: session.spaceId, session: session.session, packId: pack.id, attachmentId: att.id })
    if (!res.ok) {
      setError(res.status === 410 ? 'That attachment has expired on the server.' : 'Could not fetch the attachment.')
      return
    }
    const bytes = await decryptBytes({ iv: res.body.iv, data: res.body.data }, res.body.key)
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer]))
    const a = document.createElement('a')
    a.href = url
    a.download = res.body.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  if (!session) {
    return (
      <main className="mentor-page">
        <h1>Mentor portal</h1>
        {route.kind === 'join' ? (
          <section className="mentor-card" aria-label="Join">
            <p>You have been invited to see a trainee teacher's review packs and leave feedback. Choose a display name and a passphrase for this portal.</p>
            <label>Your name<input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
            <label>Passphrase (at least 8 characters)<input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="new-password" /></label>
            <button type="button" className="mentor-primary" disabled={busy || !name.trim() || passphrase.length < 8} onClick={() => void join()}>Join</button>
          </section>
        ) : route.kind === 'login' ? (
          <section className="mentor-card" aria-label="Sign in">
            <p>Sign in with the passphrase you chose when you joined.</p>
            <label>Passphrase<input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="current-password" /></label>
            <button type="button" className="mentor-primary" disabled={busy || !passphrase} onClick={() => void login()}>Sign in</button>
          </section>
        ) : (
          <section className="mentor-card"><p>Open the invitation link the trainee sent you. There is nothing to see here without one.</p></section>
        )}
        {error && <p className="mentor-error" role="alert">{error}</p>}
        <p className="mentor-foot">Only the packs shared with you are reachable here. This portal records feedback as text with your name and the time; it never scores or grades anyone.</p>
      </main>
    )
  }

  return (
    <main className="mentor-page">
      <header className="mentor-head">
        <h1>Mentor portal</h1>
        <p>Signed in as <strong>{session.name}</strong> · <button type="button" className="mentor-link" onClick={() => { setSession(null); saveSession(null); setPacks(null) }}>Sign out</button></p>
      </header>
      {notice && <p className="mentor-notice" role="status">{notice}</p>}
      {error && <p className="mentor-error" role="alert">{error}</p>}
      {packs === null ? <p>Loading…</p> : packs.length === 0 ? <p className="mentor-card">Nothing has been shared with you yet.</p> : (
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
                          <li key={a.id}><button type="button" className="mentor-link" onClick={() => void download(p, a)}>{a.name}</button> <span>({Math.max(1, Math.round(a.size / 1024))} KB, decrypted in your browser)</span></li>
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
                    <button type="button" className="mentor-primary" disabled={busy || !(draft[p.id] ?? '').trim()} onClick={() => void send(p)}>Send feedback</button>
                    <p className="mentor-foot">Sent as you, with the time. The learner sees it as reviewer-authenticated feedback and cannot edit its text.</p>
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
