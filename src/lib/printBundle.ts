import { getPhotos } from './photos'
import { TEACHERS_STANDARDS } from './standards'

/**
 * Print view of the evidence journal: a hidden document with every entry's date,
 * note and photos grouped by Teachers' Standard, revealed only for window.print()
 * (browser print → save as PDF gives the submittable bundle).
 */

export interface BundleEntry {
  key: string
  dateISO: string
  title: string
  room?: string
  note?: string
  photos: number
  standards: string[]
}

function formatLong(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export async function printEvidenceBundle(profileId: string, entries: BundleEntry[]): Promise<void> {
  const root = document.createElement('div')
  root.id = 'print-bundle'
  const objectUrls: string[] = []

  const h1 = document.createElement('h1')
  h1.textContent = 'Evidence journal'
  root.appendChild(h1)
  const sub = document.createElement('p')
  sub.className = 'pb-sub'
  sub.textContent = `Exported ${new Date().toLocaleDateString('en-GB')} from My Timetable`
  root.appendChild(sub)

  const groups: { id: string; label: string }[] = [
    ...TEACHERS_STANDARDS,
    { id: '', label: 'Not yet tagged to a standard' },
  ]
  for (const g of groups) {
    const mine = entries.filter((e) => (g.id === '' ? e.standards.length === 0 : e.standards.includes(g.id)))
    if (mine.length === 0) continue
    const h2 = document.createElement('h2')
    h2.textContent = g.id === '' ? g.label : `${g.id} — ${g.label}`
    root.appendChild(h2)
    for (const e of mine) {
      const item = document.createElement('div')
      item.className = 'pb-entry'
      const head = document.createElement('h3')
      head.textContent = `${formatLong(e.dateISO)} · ${e.title}${e.room ? ` (${e.room})` : ''}`
      item.appendChild(head)
      if (e.note) {
        const p = document.createElement('p')
        p.textContent = e.note
        item.appendChild(p)
      }
      if (e.photos > 0) {
        const grid = document.createElement('div')
        grid.className = 'pb-photos'
        try {
          for (const photo of await getPhotos(profileId, e.key)) {
            const url = URL.createObjectURL(photo.blob)
            objectUrls.push(url)
            const img = document.createElement('img')
            img.src = url
            grid.appendChild(img)
          }
        } catch {
          /* photos unavailable — print without them */
        }
        if (grid.childElementCount > 0) item.appendChild(grid)
      }
      root.appendChild(item)
    }
  }

  document.body.appendChild(root)
  document.body.classList.add('printing-bundle')
  // Give the browser a beat to decode the images before opening the print dialog.
  await Promise.all(
    [...root.querySelectorAll('img')].map(
      (img) => img.decode?.().catch(() => {}) ?? Promise.resolve()
    )
  )
  const cleanup = () => {
    document.body.classList.remove('printing-bundle')
    root.remove()
    for (const url of objectUrls) URL.revokeObjectURL(url)
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  window.print()
  // Safari sometimes skips afterprint; clean up on a timer as a fallback.
  setTimeout(cleanup, 60_000)
}
