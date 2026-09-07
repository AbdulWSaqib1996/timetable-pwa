import type { GvizCell, GvizTable } from '../src/lib/gviz'
import type { Session } from '../src/types'
export function toISODate(y:number,monthIndex:number,d:number):string
export function parseDateCell(cell:GvizCell|null):string|null
export function parseTimeCell(cell:GvizCell|null):string
export function parseTimetable(table:GvizTable):{sessions:Session[];warnings:string[]}
