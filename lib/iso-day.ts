/**
 * Datumsarithmetik auf ISO-Tagen ('YYYY-MM-DD').
 *
 * Ein ISO-Tag ist eine Zeichenkette ohne Uhrzeit und ohne Zone. Solange das so
 * bleibt, lassen sich zwei Tage lexikografisch vergleichen (`a > b`) — echte
 * Arithmetik braucht es nur fürs Addieren von Tagen. Genau diese Stelle ist die
 * gefährliche, und deshalb steht sie hier einmal und nicht mehrfach:
 *
 * **Warum UTC und nicht die lokale Zeitzone.** `new Date('2026-03-29')` wird in
 * JavaScript als UTC-Mitternacht gelesen, `new Date(2026, 2, 29)` dagegen als
 * *lokale* Mitternacht. Wer in lokaler Zeit rechnet, verschiebt über einen
 * Sommerzeitwechsel hinweg den Tag um eins: Aus 24 Stunden werden 23 oder 25,
 * und das Ergebnis kippt auf den Vor- oder Folgetag. Bei einer Mahnfrist
 * verfehlt das die Frist um einen Tag; bei den Verzugszinsen nach § 288 BGB
 * kostet oder schenkt es einen Zinstag — gerechnet wird dort taggenau
 * (act/act), ein Tag ist also bares Geld. UTC kennt keine Sommerzeit, jeder Tag
 * ist dort exakt 86 400 000 ms lang, und die Rechnung ist auf jedem Rechner
 * dieselbe, unabhängig davon, wo der Server steht.
 *
 * **Warum `parseDay` streng prüft.** Ein unvollständiges oder erfundenes Datum
 * („2026-02-30", ein ISO-Zeitstempel mit Uhrzeit) erzeugt beim naiven Zerlegen
 * stillschweigend `NaN`. Das rechnet sich nicht in einen Fehler, sondern in
 * 0,00 € — und landet so als Zinsforderung auf einer Mahnung, ohne dass es
 * jemand merkt. Ein lauter Wurf ist hier immer besser als eine leise Null.
 *
 * Dieses Modul ist reine Arithmetik: keine Datenbank, kein `new Date()` ohne
 * Argument, kein „heute". Der Kalender gehört dem Aufrufer.
 */

/** Ein UTC-Tag in Millisekunden. In UTC konstant — genau das ist der Punkt. */
export const DAY_MS = 86_400_000;

/** Nur ein nackter Tag. Kein Zeitstempel, kein Offset, keine Kurzform. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 'YYYY-MM-DD' als UTC-Zeitstempel.
 *
 * Zweistufig geprüft: Das Format fängt den Zeitstempel und die Kurzform ab, der
 * Rückvergleich über `formatDay` fängt den Tag, den es nicht gibt — `Date.UTC`
 * lässt den 30. Februar nämlich klaglos auf den 2. März überlaufen.
 */
export function parseDay(iso: string): number {
  if (!ISO_DAY.test(iso)) {
    throw new Error(`Ungültiges Datum "${iso}" — erwartet wird YYYY-MM-DD.`);
  }
  const [year, month, day] = iso.split("-").map(Number);
  const ms = Date.UTC(year, month - 1, day);
  if (formatDay(ms) !== iso) {
    throw new Error(`Ungültiges Datum "${iso}" — diesen Tag gibt es nicht.`);
  }
  return ms;
}

/** UTC-Zeitstempel zurück auf 'YYYY-MM-DD'. */
export function formatDay(ms: number): string {
  return new Date(ms).toISOString().split("T")[0];
}

/** Tage addieren (negativ: abziehen). '2026-02-28' + 1 -> '2026-03-01'. */
export function addDays(iso: string, days: number): string {
  return formatDay(parseDay(iso) + days * DAY_MS);
}

/**
 * Tage von `von` bis `bis`. Negativ, wenn `bis` davor liegt.
 *
 * Die Division geht ohne Rest auf, weil beide Werte UTC-Mitternachten sind und
 * ein UTC-Tag konstant `DAY_MS` lang ist — hier wird nichts gerundet und nichts
 * abgeschnitten. In lokaler Zeit wäre genau das nicht wahr; siehe oben.
 *
 * Die Zählweise ist die des § 187 Abs. 1 BGB: Der Tag des Ereignisses zählt
 * nicht mit. `daysBetween('2026-10-07', '2026-10-08')` ist also 1 — ein Tag
 * Verzug, nicht zwei.
 */
export function daysBetween(von: string, bis: string): number {
  return (parseDay(bis) - parseDay(von)) / DAY_MS;
}

/** Das Kalenderjahr eines UTC-Zeitstempels. */
export function yearOf(ms: number): number {
  return new Date(ms).getUTCFullYear();
}

/**
 * Das Halbjahr, zu dem ein Tag gehört: '2026-08-14' -> '2026-07-01'.
 *
 * Der Basiszinssatz nach § 247 BGB ändert sich zum 1. Januar und zum 1. Juli;
 * das Halbjahr ist deshalb die natürliche Einheit, in der sich ein Satz mit
 * einem anderen vergleichen lässt.
 *
 * Prüft über `parseDay` mit, obwohl für die Rückgabe nur Jahr und Monat
 * gebraucht werden: Sonst ergäbe „2026-13-01" stillschweigend „2026-07-01" —
 * dieselbe Klasse stiller Fehler, gegen die `parseDay` angetreten ist.
 */
export function halfYearStart(iso: string): string {
  parseDay(iso);
  const [year, month] = iso.split("-").map(Number);
  return month <= 6 ? `${year}-01-01` : `${year}-07-01`;
}
