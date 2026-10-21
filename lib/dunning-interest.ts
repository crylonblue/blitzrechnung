import { round2 } from "./invoice-totals";
import { DAY_MS, formatDay, halfYearStart, parseDay, yearOf } from "./iso-day";

/**
 * Verzugszinsen nach § 288 BGB.
 *
 * Die Zinsen laufen auf den **Bruttobetrag** der offenen Forderung — die
 * Umsatzsteuer ist Teil der Entgeltforderung, der Schuldner schuldet sie
 * ebenso. Der Satz ist der Basiszinssatz nach § 247 BGB plus ein fester
 * Aufschlag (siehe `surchargeFor`).
 *
 * Der Basiszinssatz ändert sich zum 1. Januar und zum 1. Juli. Eine Forderung,
 * die über eine solche Grenze hinweg offen ist, hat deshalb nicht *einen* Satz,
 * sondern mehrere: der Zeitraum wird geteilt und jedes Teilstück trägt den
 * damals geltenden Satz. Zusätzlich wird an jedem Jahreswechsel geteilt — nicht
 * wegen des Satzes, sondern damit jedes Teilstück in genau einem Kalenderjahr
 * liegt und durch dessen echte Länge geteilt werden kann (siehe
 * „Zinstagemethode" unten).
 *
 * **Zinstagemethode: taggenau / actual-actual (act/act).**
 * Gezählt werden die tatsächlichen Kalendertage, geteilt wird durch die
 * tatsächliche Länge des jeweiligen Kalenderjahres (365 bzw. 366). § 288 BGB
 * schreibt keine Methode vor; die kaufmännische 30/360-Methode („deutsche
 * Zinsmethode") ist eine Vereinbarung aus dem Bankgeschäft und passt nicht zu
 * einem gesetzlichen Zinsanspruch, der tagegenau mit dem Verzug entsteht und
 * endet. Ein pauschales /365 wiederum fordert im Schaltjahr zu viel. Act/act
 * ist damit die Methode, die am wenigsten unterstellt — und im Zweifel die
 * niedrigere Forderung ergibt.
 *
 * **Keine Zinseszinsen (§ 289 Satz 1 BGB).** Jedes Teilstück rechnet auf dem
 * ursprünglichen Betrag; aufgelaufene Zinsen werden nie auf die Hauptforderung
 * geschlagen. Die Berechnung ist in `principal` und in der Zeit linear.
 *
 * Dieses Modul ist reine Arithmetik und enthält keine Policy: ob eine Mahnung
 * überhaupt Zinsen fordert und ab wann Verzug besteht, entscheidet der Aufrufer.
 * Es liest keine Datenbank und kennt kein „heute" — jedes Datum kommt von außen,
 * damit die Berechnung reproduzierbar und testbar bleibt.
 */

/**
 * Wie der Schuldner einzuordnen ist. Entspricht `contacts.customer_type`:
 * `null` heißt **unbekannt**, nicht „Unternehmen".
 */
export type CustomerType = "business" | "consumer" | null;

/** § 288 Abs. 1 Satz 2 BGB — Regelfall: fünf Prozentpunkte über dem Basiszinssatz. */
export const SURCHARGE_DEFAULT = 5;

/**
 * § 288 Abs. 2 BGB — neun Prozentpunkte, aber nur bei Entgeltforderungen aus
 * Rechtsgeschäften, **an denen ein Verbraucher nicht beteiligt ist**.
 */
export const SURCHARGE_NO_CONSUMER = 9;

/**
 * § 288 Abs. 5 BGB — pauschale 40 € Verzugspauschale. Nur gegenüber einem
 * Schuldner, der kein Verbraucher ist; sie wird auf später entstehende Kosten
 * der Rechtsverfolgung angerechnet.
 */
export const LATE_FEE_FLAT = 40;

/**
 * Der Aufschlag auf den Basiszinssatz.
 *
 * Die neun Punkte setzen voraus, dass auf **keiner** Seite ein Verbraucher
 * beteiligt ist. Die Gläubigerseite ist hier immer ein Rechnungssteller, also
 * kein Verbraucher; offen bleibt damit nur der Schuldner. Ist dessen Typ
 * unbekannt (`null`), gelten bewusst die fünf Punkte: eine zu niedrig
 * geforderte Zinsforderung lässt sich nachfordern, eine zu hohe macht die
 * Mahnung angreifbar und den Mahnenden selbst in Verzug mit der Rückzahlung.
 */
export function surchargeFor(customerType: CustomerType | undefined): number {
  return customerType === "business" ? SURCHARGE_NO_CONSUMER : SURCHARGE_DEFAULT;
}

/**
 * Darf die 40-€-Pauschale nach § 288 Abs. 5 BGB gefordert werden?
 *
 * Nur bei einem Schuldner, der nachweislich kein Verbraucher ist — bei
 * unbekanntem Typ also nicht. Gleiche Begründung wie beim Aufschlag: im
 * Zweifel das, was weniger fordert.
 */
export function mayChargeLateFeeFlat(customerType: CustomerType | undefined): boolean {
  return customerType === "business";
}

export interface BaseRatePeriod {
  /** Erster Tag, an dem der Satz gilt (einschließlich). */
  from: string;
  /** Prozent pro Jahr. */
  rate: number;
}

/**
 * Basiszinssatz nach § 247 BGB, wie von der Deutschen Bundesbank veröffentlicht.
 * Neueste zuerst, und nur die Termine, an denen sich der Satz tatsächlich
 * geändert hat — die Suche nimmt den ersten Eintrag, der nicht nach dem
 * gesuchten Tag liegt.
 *
 * Abgeschnitten am 01.07.2016: die regelmäßige Verjährung beträgt drei Jahre,
 * ältere Sätze wären Dekoration. Ein Tag davor ist ein Fehler, keine Schätzung.
 *
 * Hier stehen nur geprüfte Sätze. Der Branch führte zusätzlich
 * `2026-07-01 → 1,52`; dieser Wert liess sich nicht gegen die Bundesbank
 * belegen (er wäre in sich plausibel — der Basiszinssatz lag in allen
 * gelisteten Perioden genau 0,88 Punkte unter dem Hauptrefinanzierungssatz der
 * EZB, 1,52 entspräche 2,40 % — bleibt aber eine Annahme) und wurde deshalb
 * entfernt.
 *
 * Eine ungeprüfte Zahl in dieser Tabelle ist gefährlicher als eine Lücke: Sie
 * sieht aus wie eine Tatsache, und wer das `stale`-Kennzeichen nicht liest,
 * mahnt damit. Ohne den Eintrag schreibt `baseRateFor` den letzten geprüften
 * Satz fort und meldet weiterhin `stale` — das fordert im Zweifel zu wenig
 * statt zu viel, und genau in diese Richtung soll ein Irrtum ausfallen.
 *
 * `tests/dunning-basiszins-aktualitaet.test.ts` wacht über beides.
 */
export const BASE_RATES: BaseRatePeriod[] = [
  { from: "2025-07-01", rate: 1.27 },
  { from: "2025-01-01", rate: 2.27 },
  { from: "2024-07-01", rate: 3.37 },
  { from: "2024-01-01", rate: 3.62 },
  { from: "2023-07-01", rate: 3.12 },
  { from: "2023-01-01", rate: 1.62 },
  { from: "2016-07-01", rate: -0.88 }, // lange unverändert bis Ende 2022
];

/**
 * Das letzte Halbjahr, das tatsächlich gegen die Bundesbank geprüft wurde.
 *
 * Bewusst getrennt von BASE_RATES: diese Liste führt nur Änderungen, ein
 * Halbjahr ohne Satzänderung erzeugt also keinen Eintrag. Aus dem neuesten
 * Eintrag lässt sich die Aktualität deshalb nicht ableiten.
 *
 * Liegt ein gesuchter Tag in einem späteren Halbjahr, meldet `baseRateFor`
 * `stale` — dann muss ein Mensch den Satz bestätigen, statt dass stillschweigend
 * mit einem fortgeschriebenen Wert gemahnt wird. `baseRateOverride` ist der
 * Ausweg.
 */
export const BASE_RATES_PUBLISHED_THROUGH = "2026-01-01";

/**
 * Der Teiler der act/act-Methode: die echte Länge des Kalenderjahres. Steht
 * bewusst hier und nicht in `lib/iso-day.ts` — das ist keine Datumsarithmetik,
 * sondern die Zinstagemethode dieses Moduls (siehe Kopfkommentar).
 */
function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

export interface BaseRateLookup {
  rate: number;
  /** Erster Tag der Periode, zu der dieser Satz gehört. */
  from: string;
  /**
   * Der Tag liegt in einem Halbjahr, das die Tabelle nicht geprüft hat — der
   * Satz ist also eine fortgeschriebene Annahme, keine veröffentlichte Zahl.
   */
  stale: boolean;
}

export function baseRateFor(day: string): BaseRateLookup {
  const period = BASE_RATES.find((p) => p.from <= day);
  if (!period) {
    throw new Error(
      `Kein Basiszinssatz für ${day} hinterlegt — die Tabelle beginnt am ${BASE_RATES[BASE_RATES.length - 1].from}.`
    );
  }
  return {
    rate: period.rate,
    from: period.from,
    stale: halfYearStart(day) > BASE_RATES_PUBLISHED_THROUGH,
  };
}

export interface InterestSegment {
  /** Erster Zinstag dieses Abschnitts (einschließlich). */
  from: string;
  /** Letzter Zinstag dieses Abschnitts (einschließlich). */
  to: string;
  days: number;
  baseRate: number;
  /** Basiszinssatz plus Aufschlag, Prozent pro Jahr. */
  ratePercent: number;
  /** 365 oder 366 — die Länge des Kalenderjahres, in dem der Abschnitt liegt. */
  daysInYear: number;
  amount: number;
  stale: boolean;
}

export interface InterestResult {
  amount: number;
  days: number;
  segments: InterestSegment[];
  /**
   * Ein Satz zum Ausdrucken, wenn der ganze Zeitraum einen trägt, sonst der
   * tagesgewichtete Durchschnitt. Nur zur Anzeige — `amount` ist die Summe der
   * Abschnitte, nicht aus diesem Satz gerechnet.
   */
  effectiveRate: number;
  /** Mindestens ein Abschnitt stützt sich auf einen ungeprüften Basiszinssatz. */
  stale: boolean;
}

export interface InterestInput {
  /** Offener Bruttobetrag. § 288 verzinst die Bruttoforderung. */
  principal: number;
  /**
   * Fälligkeitstag der Rechnung. Die Zinsen beginnen am Tag danach — § 187
   * Abs. 1 BGB: der Tag des Ereignisses zählt nicht mit.
   */
  dueDate: string;
  /** Letzter berechneter Tag (einschließlich), normalerweise das Mahndatum. */
  asOf: string;
  /**
   * Einordnung des Schuldners; `null` heißt unbekannt und führt zum niedrigeren
   * Satz. Bewusst ein Pflichtfeld: der Aufrufer soll sich entscheiden, statt
   * dass ein vergessener Parameter stillschweigend neun Punkte fordert.
   */
  customerType: CustomerType;
  /**
   * Diesen Basiszinssatz für den ganzen Zeitraum verwenden statt der Tabelle.
   * Der Ausweg, wenn die Tabelle veraltet ist oder der Nutzer es besser weiß.
   */
  baseRateOverride?: number;
}

/** Frisches Null-Ergebnis — kein geteiltes Objekt, das ein Aufrufer mutieren könnte. */
function emptyResult(): InterestResult {
  return { amount: 0, days: 0, segments: [], effectiveRate: 0, stale: false };
}

export function computeDefaultInterest(input: InterestInput): InterestResult {
  const { principal, dueDate, asOf, customerType, baseRateOverride } = input;
  const surcharge = surchargeFor(customerType);

  const firstDay = parseDay(dueDate) + DAY_MS;
  const lastDay = parseDay(asOf);
  if (lastDay < firstDay || principal <= 0) return emptyResult();

  // Jede Satzänderung, dazu jeder 1. Januar. Die Jahreswechsel haben nichts mit
  // dem Satz zu tun — sie halten jeden Abschnitt in einem Kalenderjahr, damit
  // der Teiler (365/366) eindeutig ist.
  const boundaries = new Set<number>();
  for (const period of BASE_RATES) boundaries.add(parseDay(period.from));
  for (let year = yearOf(firstDay); year <= yearOf(lastDay) + 1; year++) {
    boundaries.add(Date.UTC(year, 0, 1));
  }
  const sortedBoundaries = [...boundaries].sort((a, b) => a - b);

  const segments: InterestSegment[] = [];
  let cursor = firstDay;

  while (cursor <= lastDay) {
    const nextBoundary = sortedBoundaries.find((b) => b > cursor);
    const segmentEnd =
      nextBoundary === undefined ? lastDay : Math.min(lastDay, nextBoundary - DAY_MS);

    const days = Math.round((segmentEnd - cursor) / DAY_MS) + 1;
    const lookup =
      baseRateOverride === undefined
        ? baseRateFor(formatDay(cursor))
        : { rate: baseRateOverride, from: formatDay(cursor), stale: false };
    const ratePercent = round2(lookup.rate + surcharge);
    const divisor = daysInYear(yearOf(cursor));

    segments.push({
      from: formatDay(cursor),
      to: formatDay(segmentEnd),
      days,
      baseRate: lookup.rate,
      ratePercent,
      daysInYear: divisor,
      // Immer auf `principal`, nie auf principal + bereits aufgelaufene Zinsen:
      // § 289 Satz 1 BGB verbietet Zinseszinsen. Je Abschnitt gerundet und dann
      // summiert — dieselbe Regel wie in computeInvoiceTotals, damit die auf der
      // Mahnung gedruckten Abschnitte zur ausgewiesenen Summe addieren.
      amount: round2((principal * (ratePercent / 100) * days) / divisor),
      stale: lookup.stale,
    });

    cursor = segmentEnd + DAY_MS;
  }

  const days = segments.reduce((sum, s) => sum + s.days, 0);
  const amount = round2(segments.reduce((sum, s) => sum + s.amount, 0));
  const rates = new Set(segments.map((s) => s.ratePercent));
  const effectiveRate =
    rates.size === 1
      ? segments[0].ratePercent
      : round2(segments.reduce((sum, s) => sum + s.ratePercent * s.days, 0) / days);

  return {
    amount,
    days,
    segments,
    effectiveRate,
    stale: segments.some((s) => s.stale),
  };
}
