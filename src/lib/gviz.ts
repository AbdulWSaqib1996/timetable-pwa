export interface GvizCell {
  v: unknown
  f?: string
}

export interface GvizTable {
  cols: { id: string; label: string; type: string }[]
  rows: { c: (GvizCell | null)[] }[]
}

/**
 * Fetch a public Google Sheet tab via the GViz endpoint. No API key needed,
 * but the sheet must be shared as "anyone with the link can view".
 * `headers=0` forces every row to come back as data so we can detect the
 * header row ourselves (timetable sheets often have a title row above it).
 */
export async function fetchGvizTable(sheetId: string, gid: string | null): Promise<GvizTable> {
  const gidParam = gid ? `&gid=${gid}` : ''
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&headers=0${gidParam}`
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new Error('Could not reach Google Sheets. Check your connection.')
  }
  if (!res.ok) {
    throw new Error(`Google Sheets returned ${res.status}. Is the sheet shared as "anyone with the link can view"?`)
  }
  const text = await res.text()
  // Response is JS: google.visualization.Query.setResponse({...}); — extract the JSON body.
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start || text.trimStart().startsWith('<')) {
    throw new Error('Unexpected response — the sheet may not be public. Set sharing to "anyone with the link can view".')
  }
  let json: { status?: string; errors?: { detailed_message?: string; message?: string }[]; table?: GvizTable }
  try {
    json = JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new Error('Could not parse the sheet response.')
  }
  if (json.status === 'error') {
    const detail = json.errors?.[0]?.detailed_message || json.errors?.[0]?.message || 'unknown error'
    throw new Error(`Google Sheets error: ${detail}`)
  }
  if (!json.table) throw new Error('The sheet response contained no data.')
  return json.table
}
