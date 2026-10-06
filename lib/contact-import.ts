import { COUNTRIES } from './countries'

/**
 * Kontakt-Import aus CSV/Excel.
 *
 * Bewusst frei von Browser- und Supabase-Abhängigkeiten: Die Vorschau im Client
 * und die API-Route validieren mit denselben Funktionen, damit der Server nie
 * etwas anlegt, das die Vorschau nicht genauso gezeigt hat.
 */

export const IMPORT_FIELDS = [
  'name',
  'street',
  'streetnumber',
  'zip',
  'city',
  'country',
  'email',
  'vat_id',
] as const

export type ImportField = (typeof IMPORT_FIELDS)[number]

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  name: 'Name / Firma',
  street: 'Straße',
  streetnumber: 'Hausnummer',
  zip: 'PLZ',
  city: 'Ort',
  country: 'Land',
  email: 'E-Mail',
  vat_id: 'USt-IdNr.',
}

/** Obergrenze pro Import — schützt Route und Datenbank vor versehentlichen Riesendateien. */
export const MAX_IMPORT_ROWS = 2000

/** Spaltenindex je Feld; `null` = nicht zugeordnet. */
export type ColumnMapping = Record<ImportField, number | null>

export interface ImportContact {
  name: string
  address: {
    street: string
    streetnumber: string
    zip: string
    city: string
    country: string
  }
  email: string | null
  vat_id: string | null
}

export interface ImportRowResult {
  /** 1-basierte Zeilennummer in der Datei (inkl. Kopfzeile), für Fehlermeldungen. */
  line: number
  contact: ImportContact
  errors: string[]
  duplicate: boolean
}

// Kopfzeilen werden vor dem Vergleich normalisiert (klein, ohne Umlaute und
// Satzzeichen), sodass "E-Mail", "e_mail" und "EMail" gleich behandelt werden.
const HEADER_SYNONYMS: Record<ImportField, string[]> = {
  name: [
    'name', 'firma', 'firmenname', 'unternehmen', 'unternehmensname', 'company', 'companyname',
    'kunde', 'kundenname', 'organisation', 'organization', 'empfaenger', 'rechnungsempfaenger',
    'kontakt', 'kontaktname', 'displayname', 'anzeigename',
  ],
  street: [
    'strasse', 'str', 'street', 'adresse', 'anschrift', 'address', 'addressline1', 'adresszeile1',
    'strasseundhausnummer', 'strassehausnummer', 'strassenr', 'strassenummer',
  ],
  streetnumber: ['hausnummer', 'hausnr', 'nr', 'number', 'streetnumber', 'housenumber', 'hnr'],
  zip: ['plz', 'postleitzahl', 'zip', 'zipcode', 'postalcode', 'postcode'],
  city: ['ort', 'stadt', 'city', 'town', 'wohnort', 'sitz'],
  country: ['land', 'country', 'laendercode', 'countrycode', 'staat'],
  email: ['email', 'mail', 'emailadresse', 'mailadresse', 'rechnungsemail', 'emailrechnung', 'emailaddress'],
  vat_id: [
    'ustid', 'ustidnr', 'ustidnummer', 'umsatzsteuerid', 'umsatzsteueridentifikationsnummer',
    'vatid', 'vat', 'vatnumber', 'vatno', 'ustnr',
  ],
}

export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '')
}

/** Ordnet Spalten anhand ihrer Überschrift automatisch zu; jede Spalte höchstens einmal. */
export function guessMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader)
  const mapping = Object.fromEntries(IMPORT_FIELDS.map((f) => [f, null])) as ColumnMapping
  const used = new Set<number>()

  for (const field of IMPORT_FIELDS) {
    const index = normalized.findIndex((h, i) => !used.has(i) && HEADER_SYNONYMS[field].includes(h))
    if (index !== -1) {
      mapping[field] = index
      used.add(index)
    }
  }
  return mapping
}

// Zusätzliche Schreibweisen, die in Exporten aus anderen Tools häufig vorkommen.
const COUNTRY_ALIASES: Record<string, string> = {
  d: 'DE', deu: 'DE', germany: 'DE', brd: 'DE',
  a: 'AT', aut: 'AT', austria: 'AT', oesterreich: 'AT',
  ch: 'CH', che: 'CH', switzerland: 'CH', suisse: 'CH',
  nl: 'NL', nld: 'NL', netherlands: 'NL', holland: 'NL',
  f: 'FR', fra: 'FR', france: 'FR',
  i: 'IT', ita: 'IT', italy: 'IT',
  b: 'BE', bel: 'BE', belgium: 'BE',
  l: 'LU', lux: 'LU', luxembourg: 'LU',
  usa: 'US', unitedstates: 'US',
  uk: 'GB', gbr: 'GB', unitedkingdom: 'GB', grossbritannien: 'GB', england: 'GB',
}

/** Liefert den ISO-Code oder `null`, wenn das Land nicht erkannt wird. Leer = Deutschland. */
export function normalizeCountry(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return 'DE'

  const upper = trimmed.toUpperCase()
  if (COUNTRIES.some((c) => c.code === upper)) return upper

  const key = normalizeHeader(trimmed)
  const byName = COUNTRIES.find((c) => normalizeHeader(c.name) === key)
  if (byName) return byName.code

  return COUNTRY_ALIASES[key] ?? null
}

/**
 * Trennt "Rotebühlstr. 77" in Straße und Hausnummer, falls die Datei keine
 * eigene Hausnummer-Spalte hat. Erkennt auch "12a", "12 a" und "12-14".
 */
export function splitStreet(value: string): { street: string; streetnumber: string } {
  const match = value.trim().match(/^(.*?\S)\s+(\d+\s?[a-zA-Z]?(?:\s?[-/]\s?\d+\s?[a-zA-Z]?)?)$/)
  if (!match) return { street: value.trim(), streetnumber: '' }
  return { street: match[1], streetnumber: match[2].replace(/\s+/g, '') }
}

function cellToString(cell: unknown): string {
  if (cell === null || cell === undefined) return ''
  if (cell instanceof Date) return cell.toISOString().slice(0, 10)
  return String(cell).trim()
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Schlüssel für die Duplikaterkennung: gleicher Name und gleiche PLZ. */
export function duplicateKey(name: string, zip: string): string {
  return `${normalizeHeader(name)}|${zip.replace(/\s/g, '')}`
}

export function validateContact(contact: ImportContact, countryRaw = ''): string[] {
  const errors: string[] = []
  if (!contact.name) errors.push('Name fehlt')
  if (!contact.address.street) errors.push('Straße fehlt')
  if (!contact.address.streetnumber) errors.push('Hausnummer fehlt')
  if (!contact.address.zip) errors.push('PLZ fehlt')
  if (!contact.address.city) errors.push('Ort fehlt')
  if (!contact.address.country) {
    errors.push(countryRaw ? `Land „${countryRaw}“ nicht erkannt` : 'Land fehlt')
  }
  if (contact.email && !EMAIL_PATTERN.test(contact.email)) errors.push('E-Mail ungültig')
  return errors
}

/** Baut aus einer Datenzeile einen Kontakt — ohne Validierung. */
export function rowToContact(row: unknown[], mapping: ColumnMapping): { contact: ImportContact; countryRaw: string } {
  const get = (field: ImportField) => {
    const index = mapping[field]
    return index === null ? '' : cellToString(row[index])
  }

  let street = get('street')
  let streetnumber = get('streetnumber')
  if (street && !streetnumber) {
    ;({ street, streetnumber } = splitStreet(street))
  }

  const countryRaw = get('country')
  const country = normalizeCountry(countryRaw) ?? ''

  // Excel speichert PLZ gern als Zahl und verliert dabei die führende Null ("01067" → 1067).
  let zip = get('zip')
  if (country === 'DE' && /^\d{4}$/.test(zip)) zip = `0${zip}`

  const email = get('email')
  const vatId = get('vat_id').replace(/\s/g, '').toUpperCase()

  return {
    contact: {
      name: get('name'),
      address: { street, streetnumber, zip, city: get('city'), country },
      email: email || null,
      vat_id: vatId || null,
    },
    countryRaw,
  }
}

/**
 * Wandelt die Datenzeilen (ohne Kopfzeile) in geprüfte Kontakte um. Leere
 * Zeilen werden übersprungen; Duplikate gegenüber bestehenden Kontakten und
 * innerhalb der Datei werden markiert, nicht entfernt.
 */
export function processRows(
  rows: unknown[][],
  mapping: ColumnMapping,
  existing: { name: string; zip: string }[] = []
): ImportRowResult[] {
  const seen = new Set(existing.map((c) => duplicateKey(c.name, c.zip)))
  const results: ImportRowResult[] = []

  rows.forEach((row, i) => {
    if (row.every((cell) => cellToString(cell) === '')) return

    const { contact, countryRaw } = rowToContact(row, mapping)
    const errors = validateContact(contact, countryRaw)

    const key = duplicateKey(contact.name, contact.address.zip)
    const duplicate = errors.length === 0 && seen.has(key)
    if (errors.length === 0) seen.add(key)

    results.push({ line: i + 2, contact, errors, duplicate })
  })

  return results
}

/** Vorlage für den Download — dieselben Überschriften, die `guessMapping` erkennt. */
export const TEMPLATE_CSV =
  'Name;Straße;Hausnummer;PLZ;Ort;Land;E-Mail;USt-IdNr.\r\n' +
  'Muster GmbH;Hauptstraße;1;10115;Berlin;DE;rechnung@muster.de;DE123456789\r\n'
