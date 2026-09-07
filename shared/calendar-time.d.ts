export const COURSE_TIMEZONE: string
export function zonedTodayISO(zone?: string, now?: Date): string
export function addDaysISO(dateISO: string, days: number): string
export function mondayOfISO(dateISO: string): string
export function shiftMonthISO(dateISO: string, deltaMonths: number): string
export function zoneOffsetMs(utcMs: number, zone?: string): number
export function wallToUTC(
  dateISO: string,
  hhmm: string,
  zone?: string
): { utcMs: number; warning?: 'ambiguous' | 'nonexistent' }
export function escapeICSText(value: string): string
export function foldICSLine(line: string): string
export function buildICSCalendar(
  sessions: {
    id: string
    calendarUid?: string
    title: string
    dateISO: string
    start?: string
    end?: string
    room?: string
    groups?: string
    tutor?: string
    subject?: string
    link?: string
    isKeyDate?: boolean
    isSelfStudy?: boolean
  }[],
  calendarName: string,
  opts?: { zone?: string; now?: Date }
): string
