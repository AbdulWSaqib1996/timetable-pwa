/**
 * Extract the spreadsheet ID and (optionally) the tab gid from a pasted Google Sheets URL.
 * Handles /edit, /view, /htmlview and account-scoped URLs (/spreadsheets/u/0/d/…).
 */
export function parseSheetUrl(url: string): { sheetId: string; gid: string | null } | null {
  const idMatch = url.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/(?:e\/)?([a-zA-Z0-9_-]{20,})/)
  if (!idMatch) return null
  const gidMatch = url.match(/[#?&]gid=(\d+)/)
  return { sheetId: idMatch[1], gid: gidMatch ? gidMatch[1] : null }
}
