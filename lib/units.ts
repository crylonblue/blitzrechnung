/**
 * Unit definitions with German and English labels and ZUGFeRD/UN/ECE Recommendation 20 codes
 */
export const UNITS = [
  { value: 'hour', label: 'Stunde', labelEn: 'Hour', code: 'HUR' },
  { value: 'day', label: 'Tag', labelEn: 'Day', code: 'DAY' },
  { value: 'piece', label: 'Stück', labelEn: 'Piece', code: 'C62' },
  { value: 'km', label: 'Kilometer', labelEn: 'Kilometre', code: 'KMT' },
  { value: 'kg', label: 'Kilogramm', labelEn: 'Kilogram', code: 'KGM' },
  { value: 'month', label: 'Monat', labelEn: 'Month', code: 'MON' },
  { value: 'meter', label: 'Meter', labelEn: 'Metre', code: 'MTR' },
  { value: 'liter', label: 'Liter', labelEn: 'Litre', code: 'LTR' },
  { value: 'gram', label: 'Gramm', labelEn: 'Gram', code: 'GRM' },
] as const

export type UnitValue = typeof UNITS[number]['value']

/**
 * Get the label for a unit value in the invoice language. Also accepts a German
 * label (older line items stored "Stück" instead of "piece"); free-text units
 * are returned unchanged.
 */
export function getUnitLabel(value: string, language: 'de' | 'en' = 'de'): string {
  const unit = UNITS.find(u => u.value === value || u.label === value)
  if (!unit) return value
  return language === 'en' ? unit.labelEn : unit.label
}

/**
 * Get the ZUGFeRD/UN/ECE code for a unit value
 */
export function getUnitCode(value: string): string {
  const unit = UNITS.find(u => u.value === value)
  return unit?.code ?? 'C62' // Default to "pieces" if unknown
}

/**
 * Map a unit string to ZUGFeRD unit code (UN/ECE Recommendation 20)
 * Supports both English values and German labels
 */
export function mapUnitToZugferdCode(unit: string): string {
  const normalizedUnit = unit.toLowerCase().trim()
  
  // Check by value first
  const byValue = UNITS.find(u => u.value === normalizedUnit)
  if (byValue) return byValue.code
  
  // Check by label
  const byLabel = UNITS.find(u => u.label.toLowerCase() === normalizedUnit)
  if (byLabel) return byLabel.code
  
  // Legacy mappings for backward compatibility
  const legacyMap: Record<string, string> = {
    hours: 'HUR',
    h: 'HUR',
    stunden: 'HUR',
    stunde: 'HUR',
    days: 'DAY',
    tage: 'DAY',
    pcs: 'C62',
    pieces: 'C62',
    stk: 'C62',
    kilometer: 'KMT',
    kilogram: 'KGM',
    m: 'MTR',
    g: 'GRM',
  }
  
  return legacyMap[normalizedUnit] || 'C62' // Default to "pieces"
}
