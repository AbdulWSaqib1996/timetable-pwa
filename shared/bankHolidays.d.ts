export interface BankHoliday {
  dateISO: string
  name: string
}
export function bankHolidaysForYear(year: number): BankHoliday[]
export function bankHolidayOn(dateISO: string): string | null
export function bankHolidaysBetween(from: string, to: string): BankHoliday[]
