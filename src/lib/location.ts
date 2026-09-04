/**
 * Location strings in the sheet are two things glued together — building and
 * room ("IOE - Bedford Way (20) - 642"). This parses every format the sheet
 * actually uses (audited 4 Sep 2026 across the full year: 40 distinct strings)
 * so the UI can show the room on its own.
 *
 * Formats found:
 *  - "IOE - Bedford Way (20) - 642"                → IOE, 20 Bedford Way · room 642
 *  - "IOE - Bedford Way (20) - 421 - Nunn Hall"    → room 421 (Nunn Hall)
 *  - "Cruciform Building B.3.04"                   → Cruciform Building · room B.3.04
 *  - "Christopher Ingold Building - XLG2 Auditorium"
 *  - "B40 Darwin LT"                               → Darwin Building · B40 (lecture theatre)
 *  - "TBC", "In School", "Self Study"              → no room split
 *  - bare 7-digit numbers (e.g. "7910321")         → booking references leaked
 *    into the sheet's Room column, not real rooms — flagged as such.
 */

export interface ParsedLocation {
  /** building line ("IOE · 20 Bedford Way"), when recognised */
  building?: string
  /** room number ("642", "B.3.04", "B40") */
  room?: string
  /** named hall/auditorium attached to the room ("Nunn Hall") */
  roomName?: string
  /** special cases that aren't a real room */
  note?: 'booking-ref' | 'tbc'
  raw: string
}

export function parseLocation(raw: string): ParsedLocation {
  const text = (raw ?? '').trim()
  if (!text) return { raw: text }

  if (/^tbc$/i.test(text)) return { raw: text, note: 'tbc' }
  // A bare long number is a room-booking reference, not a room.
  if (/^\d{6,}$/.test(text)) return { raw: text, note: 'booking-ref' }

  // "IOE - Bedford Way (20) - 642" / "… - 421 - Nunn Hall"
  let m = text.match(/^IOE\s*[-–]\s*(.+?)\s*\((\d+)\)\s*[-–]\s*(.+)$/)
  if (m) {
    const [, road, number, roomPart] = m
    const nameMatch = roomPart.match(/^([\w.]+)\s*[-–]\s*(.+)$/)
    return {
      building: `IOE · ${number} ${road}`,
      room: nameMatch ? nameMatch[1] : roomPart.trim(),
      roomName: nameMatch ? nameMatch[2].trim() : undefined,
      raw: text,
    }
  }

  // "Cruciform Building B.3.04"
  m = text.match(/^(Cruciform Building)\s+(.+)$/i)
  if (m) return { building: m[1], room: m[2].trim(), raw: text }

  // "Christopher Ingold Building - XLG2 Auditorium"
  m = text.match(/^(Christopher Ingold Building)\s*[-–]\s*(.+)$/i)
  if (m) return { building: m[1], room: m[2].trim(), raw: text }

  // "B40 Darwin LT" (room first, LT = lecture theatre)
  m = text.match(/^([A-Z]?\d+\w*)\s+Darwin(?:\s+(.*))?$/i)
  if (m) {
    return {
      building: 'Darwin Building',
      room: m[1],
      roomName: m[2]?.trim().toUpperCase() === 'LT' ? 'Lecture Theatre' : m[2]?.trim() || undefined,
      raw: text,
    }
  }

  // "In School", "Self Study" and anything unrecognised: leave whole.
  return { raw: text }
}

/** Compact building label for cards ("Bedford Way", "Cruciform", "Darwin"). */
export function shortBuildingName(p: ParsedLocation): string {
  if (!p.building) return ''
  if (p.building.startsWith('IOE')) return 'Bedford Way'
  return p.building.replace(/\s*Building$/i, '')
}

/** Room label including a hall name when present ("421 (Nunn Hall)"). */
function roomLabel(p: ParsedLocation): string {
  return p.room ? `${p.room}${p.roomName ? ` (${p.roomName})` : ''}` : p.raw || '—'
}

/**
 * A human sentence for a location change, using the building/room split:
 * "Room changed: 642 → 731", "Building changed: …", "Building & room changed: …",
 * "Room confirmed: 739 (was TBC)". Used by the in-app change log and the
 * background change-push alike.
 */
export function describeRoomChange(oldRoom: string, newRoom: string): string {
  const a = parseLocation(oldRoom)
  const b = parseLocation(newRoom)
  const full = (p: ParsedLocation) =>
    p.building ? `${shortBuildingName(p)} Rm ${roomLabel(p)}` : p.note ? 'TBC' : p.raw || '—'

  // A room was TBC / a leaked booking ref and now resolves to a real room.
  if (a.note && b.building) return `Room confirmed: ${full(b)} (was TBC)`
  // …or the reverse: a known room becomes TBC.
  if (b.note && a.building) return `Room now TBC (was ${full(a)})`

  if (a.building && b.building) {
    const sameBuilding = a.building === b.building
    const sameRoom = roomLabel(a) === roomLabel(b)
    if (sameBuilding && !sameRoom) return `Room changed: ${roomLabel(a)} → ${roomLabel(b)}`
    if (!sameBuilding && sameRoom)
      return `Building changed: ${shortBuildingName(a)} → ${shortBuildingName(b)} (Rm ${roomLabel(b)})`
    if (!sameBuilding) return `Building & room changed: ${full(a)} → ${full(b)}`
  }
  return `Location changed: ${a.raw || '—'} → ${b.raw || '—'}`
}
