import { shortenRoom, subjectColor } from './format'
import type { Session } from '../types'

export interface WeekImageDay {
  label: string
  sessions: Session[]
}

/** Render the week to a shareable PNG (canvas), then use the native share sheet or download. */
export async function shareWeekImage(days: WeekImageDay[], title: string): Promise<void> {
  const colW = 232
  const pad = 24
  const width = pad * 2 + colW * days.length + 8 * (days.length - 1)
  const maxSessions = Math.max(1, ...days.map((d) => d.sessions.length))
  const rowH = 74
  const height = 110 + maxSessions * (rowH + 8) + pad

  const canvas = document.createElement('canvas')
  canvas.width = width * 2
  canvas.height = height * 2
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(2, 2)

  ctx.fillStyle = '#101322'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#ffffff'
  ctx.font = '700 22px -apple-system, "Segoe UI", Roboto, sans-serif'
  ctx.fillText('My Timetable', pad, 42)
  ctx.fillStyle = '#9aa1b5'
  ctx.font = '500 15px -apple-system, "Segoe UI", Roboto, sans-serif'
  ctx.fillText(title, pad, 66)

  const truncate = (text: string, max: number) => {
    let t = text
    while (t.length > 3 && ctx.measureText(t).width > max) t = t.slice(0, -1)
    return t === text ? t : t.trimEnd() + '…'
  }

  days.forEach((day, di) => {
    const x = pad + di * (colW + 8)
    ctx.fillStyle = '#8da2f0'
    ctx.font = '700 14px -apple-system, "Segoe UI", Roboto, sans-serif'
    ctx.fillText(day.label.toUpperCase(), x, 96)
    day.sessions.forEach((s, si) => {
      const y = 110 + si * (rowH + 8)
      const color = s.isKeyDate ? '#e64980' : subjectColor(s) ?? '#3b5bdb'
      ctx.fillStyle = '#1a1f36'
      ctx.beginPath()
      ctx.roundRect(x, y, colW, rowH, 10)
      ctx.fill()
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.roundRect(x, y, 5, rowH, [10, 0, 0, 10])
      ctx.fill()
      ctx.fillStyle = '#eef0f7'
      ctx.font = '600 13px -apple-system, "Segoe UI", Roboto, sans-serif'
      ctx.fillText(s.start ? `${s.start}${s.end && s.end !== s.start ? `–${s.end}` : ''}` : 'All day', x + 14, y + 21)
      ctx.font = '500 13px -apple-system, "Segoe UI", Roboto, sans-serif'
      ctx.fillText(truncate(s.title, colW - 26), x + 14, y + 41)
      ctx.fillStyle = '#9aa1b5'
      ctx.font = '400 12px -apple-system, "Segoe UI", Roboto, sans-serif'
      ctx.fillText(truncate(s.isSelfStudy ? 'Self study' : shortenRoom(s.room), colW - 26), x + 14, y + 60)
    })
    if (day.sessions.length === 0) {
      ctx.fillStyle = '#5b6178'
      ctx.font = 'italic 400 13px -apple-system, "Segoe UI", Roboto, sans-serif'
      ctx.fillText('Free', x, 130)
    }
  })

  ctx.fillStyle = '#5b6178'
  ctx.font = '400 11px -apple-system, "Segoe UI", Roboto, sans-serif'
  ctx.fillText('made with My Timetable', pad, height - 10)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return
  const file = new File([blob], 'my-week.png', { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'My week' })
      return
    } catch {
      /* user cancelled — fall through to download */
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'my-week.png'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
