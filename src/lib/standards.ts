/** The eight Teachers' Standards (DfE), used to tag session notes/photos as evidence. */
export const TEACHERS_STANDARDS: { id: string; label: string }[] = [
  { id: 'TS1', label: 'Set high expectations' },
  { id: 'TS2', label: 'Promote good progress' },
  { id: 'TS3', label: 'Good subject & curriculum knowledge' },
  { id: 'TS4', label: 'Plan and teach well structured lessons' },
  { id: 'TS5', label: 'Adapt teaching to all pupils' },
  { id: 'TS6', label: 'Accurate & productive use of assessment' },
  { id: 'TS7', label: 'Manage behaviour effectively' },
  { id: 'TS8', label: 'Wider professional responsibilities' },
]

export function standardLabel(id: string): string {
  return TEACHERS_STANDARDS.find((s) => s.id === id)?.label ?? id
}
