import type { Session } from '../types'
import { toISODate } from './parseTimetable'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface DemoItem {
  offset: number
  start: string
  end: string
  title: string
  room: string
  tutor: string
  groups?: string
  link?: string
}

const MOODLE = 'https://moodle.ucl.ac.uk/course/view.php?id='

// Sample sessions modelled on the UCL Primary PGCE Group 2 timetable,
// with dates generated relative to today so the demo always has a "today".
const ITEMS: DemoItem[] = [
  { offset: -1, start: '09:30', end: '12:00', title: 'Primary PGCE Introduction & Welcome', room: 'B40 Darwin LT', tutor: '', groups: '1-10', link: `${MOODLE}56881` },
  { offset: -1, start: '13:00', end: '15:00', title: 'PS Meet and Greet', room: 'IOE - Bedford Way (20) - 631', tutor: 'LD', link: `${MOODLE}56892` },
  { offset: 0, start: '09:00', end: '11:00', title: 'PS1 - Exploring Professionalism - Introduction to PS and Teacher Identity', room: 'IOE - Bedford Way (20) - A5.03', tutor: 'LD', link: `${MOODLE}56892` },
  { offset: 0, start: '11:30', end: '13:30', title: 'English 1', room: 'IOE - Bedford Way (20) - 421 - Nunn Hall', tutor: 'EK', link: `${MOODLE}56887` },
  { offset: 0, start: '14:30', end: '16:30', title: 'Maths 1', room: 'IOE - Bedford Way (20) - 731', tutor: 'KaW', link: `${MOODLE}57040` },
  { offset: 1, start: '09:00', end: '11:00', title: 'PS2 - Exploring Professionalism - Aims and Values in Primary Education', room: 'IOE - Bedford Way (20) - 642', tutor: 'LD', link: `${MOODLE}56892` },
  { offset: 1, start: '11:30', end: '13:30', title: 'Self Study', room: 'Self Study', tutor: '' },
  { offset: 1, start: '14:30', end: '16:30', title: 'EYFS Pathway 1', room: 'IOE - Bedford Way (20) - 642', tutor: 'LD', link: `${MOODLE}56895` },
  { offset: 2, start: '09:00', end: '11:00', title: 'PSHE 1', room: 'IOE - Bedford Way (20) - 631', tutor: 'DO', link: `${MOODLE}56889` },
  { offset: 2, start: '11:30', end: '13:30', title: 'Science 1', room: 'IOE - Bedford Way (20) - 731', tutor: 'JH', link: `${MOODLE}57042` },
  { offset: 3, start: '09:00', end: '11:00', title: 'Specialism 1 - Art & Design', room: 'IOE - Bedford Way (20) - 828', tutor: 'KM', groups: '1-10', link: `${MOODLE}56884` },
  { offset: 3, start: '09:00', end: '11:00', title: 'Specialism 1 - Music', room: 'IOE - Bedford Way (20) - 305 - Clarke Hall', tutor: 'HB', groups: '1-10', link: `${MOODLE}56884` },
  { offset: 3, start: '09:00', end: '11:00', title: 'Specialism 1 - Computing', room: 'IOE - Bedford Way (20) - 631', tutor: 'YA', groups: '1-10', link: `${MOODLE}56884` },
  { offset: 3, start: '11:30', end: '13:30', title: 'Specialism 1 - Science', room: 'IOE - Bedford Way (20) - 780', tutor: 'AMa', groups: '1-10', link: `${MOODLE}56884` },
  { offset: 4, start: '10:00', end: '11:00', title: 'L&T 1', room: 'Cruciform Building B.3.04', tutor: 'AMa', groups: '1-10', link: `${MOODLE}56883` },
  { offset: 4, start: '11:30', end: '13:30', title: 'L&T 1', room: 'IOE - Bedford Way (20) - 305 - Clarke Hall', tutor: 'AS', link: `${MOODLE}56883` },
  { offset: 7, start: '09:00', end: '11:00', title: 'Maths 2', room: 'IOE - Bedford Way (20) - 728', tutor: 'KaW', link: `${MOODLE}57040` },
  { offset: 7, start: '11:30', end: '13:30', title: 'Music 1', room: 'IOE - Bedford Way (20) - 944', tutor: 'HB', link: `${MOODLE}56889` },
]

const SPECIALISM_RE = /^Specialism\s*\d*\s*[-–—:]\s*(.+)$/i

export function buildDemoSessions(): Session[] {
  const today = new Date()
  return ITEMS.map((item, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + item.offset)
    const specialismMatch = item.title.match(SPECIALISM_RE)
    return {
      id: `demo-${i}`,
      title: item.title,
      day: DAY_NAMES[d.getDay()],
      dateISO: toISODate(d.getFullYear(), d.getMonth(), d.getDate()),
      start: item.start,
      end: item.end,
      room: item.room,
      groups: item.groups ?? '2',
      tutor: item.tutor,
      subject: item.title,
      link: item.link,
      isSpecialism: !!specialismMatch,
      specialismName: specialismMatch ? specialismMatch[1].trim() : undefined,
      isSelfStudy: /^self[- ]?study$/i.test(item.title),
    }
  }).sort((a, b) => (a.dateISO + a.start).localeCompare(b.dateISO + b.start))
}
