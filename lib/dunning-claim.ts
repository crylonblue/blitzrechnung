import {
  computeDefaultInterest,
  mayChargeLateFeeFlat,
  LATE_FEE_FLAT,
  type CustomerType,
  type InterestResult,
} from "./dunning-interest";
import { addDays, parseDay } from "./iso-day";
import { round2 } from "./invoice-totals";
import { formatCurrencyForLanguage, formatDateForLanguage } from "./invoice-translations";
import type { DunningStageDefinition } from "./dunning-stages";
import type { Invoice, PaymentReminder } from "../types";

/**
 * Aus Rechnung, Eskalationsstufe und Verzugsbeginn die konkrete Forderung.
 *
 * Dieses Modul ist die Stelle, an der aus „darf" ein „fällt an" wird. Die
 * Stufenkonfiguration (lib/dunning-stages.ts) sagt nur, was eine Stufe
 * *vorsieht*; ob es im Einzelfall tatsächlich gefordert werden kann, hängt an
 * Umständen, die keine Konfiguration kennt: ob überhaupt Verzug eingetreten
 * ist, ob der Schuldner ein Unternehmen ist, ob die 40-€-Pauschale in einer
 * früheren Stufe schon einmal berechnet wurde. Diese Regeln stehen deshalb
 * bewusst hier und nicht in den Stufen — eine falsch eingestellte Stufe darf
 * keine rechtswidrige Forderung erzeugen können.
 *
 * Reine Funktionen: keine Datenbank, kein `new Date()`, kein „heute". Der
 * Stichtag kommt immer von außen herein, damit dieselbe Rechnung morgen noch
 * dasselbe Ergebnis liefert und die Tests nicht mit dem Kalender kippen.
 *
 * Arithmetik wird nicht nachgebaut: die Zinsen kommen aus
 * `computeDefaultInterest`, die Rundung aus `lib/invoice-totals.ts`.
 */

// Datumsarithmetik: `lib/iso-day.ts`. ISO-Tage lassen sich lexikografisch
// vergleichen; nur fürs Addieren von Tagen braucht es echte Arithmetik, und die
// rechnet dort aus gutem Grund in UTC (siehe Kopfkommentar der Datei).

/** Kurzform für die Hinweistexte: '2026-03-02' -> '02.03.2026'. */
const d = (iso: string) => formatDateForLanguage(iso, "de");
/** Kurzform für die Hinweistexte: 40 -> '40,00 €'. */
const eur = (amount: number) => formatCurrencyForLanguage(amount, "de");

// ---------------------------------------------------------------------------
// 1. Verzugsbeginn
// ---------------------------------------------------------------------------

/**
 * § 286 Abs. 3 Satz 1 BGB: Verzug tritt spätestens 30 Tage nach Fälligkeit und
 * Zugang der Rechnung ein.
 */
export const VERZUG_KARENZ_TAGE = 30;

/** Was `verzugsbeginn` von einer Rechnung braucht. */
export type VerzugsbeginnInvoice = Pick<Invoice, "invoice_date" | "due_date">;

/**
 * Der maßgebliche Fälligkeitstag für den Verzug: **der spätere der beiden
 * Zeitpunkte — Fälligkeitsdatum oder Rechnungsdatum + 30 Tage.**
 *
 * Warum der Boden von 30 Tagen:
 *
 * § 286 Abs. 3 BGB lässt den Verzug bei einer Entgeltforderung 30 Tage nach
 * Zugang der Rechnung eintreten. Ein Zahlungsziel, das der Rechnungssteller
 * **einseitig** auf die Rechnung druckt, ist dagegen keine kalendermäßige
 * Bestimmung nach § 286 Abs. 2 Nr. 1 — dafür müsste es vereinbart sein. Wer
 * „zahlbar innerhalb von 7 Tagen" aufdruckt, verkürzt damit also nicht den
 * gesetzlichen Verzugseintritt; er darf ab Tag 8 nicht Zinsen rechnen.
 *
 * Im Normalfall kostet die Regel nichts: der Standard dieser Anwendung ist
 * ohnehin Rechnungsdatum + 30 Tage, beide Daten fallen also zusammen. Der
 * Boden greift nur bei einem **verkürzten** Zahlungsziel.
 *
 * ACHTUNG, Semantik des Rückgabewerts: Das ist der letzte Tag, an dem noch
 * rechtzeitig gezahlt werden kann — Verzug besteht **ab dem Folgetag**. Genau
 * diese Lesart erwartet `computeDefaultInterest` für sein `dueDate`-Feld
 * (§ 187 Abs. 1 BGB: der Tag des Ereignisses zählt nicht mit), der Wert wird
 * also unverändert durchgereicht.
 *
 * @param override Nachweislich vereinbartes Zahlungsziel (dann gilt das
 *   Fälligkeitsdatum direkt und der Boden entfällt) oder ein vom Nutzer besser
 *   gewusstes Datum. Wird ungeprüft übernommen — der Nutzer trägt hier die
 *   Verantwortung, nicht die Rechnung.
 */
export function verzugsbeginn(
  invoice: VerzugsbeginnInvoice,
  override?: string | null
): string {
  if (override) {
    parseDay(override); // nur Formatprüfung; ein kaputtes Datum soll hier knallen
    return override;
  }

  // `invoices.due_date` ist nullbar: Entwürfe und per API angelegte Rechnungen
  // haben nicht zwingend eines.
  const vereinbart = invoice.due_date;
  const gesetzlich = invoice.invoice_date
    ? addDays(invoice.invoice_date, VERZUG_KARENZ_TAGE)
    : null;

  if (gesetzlich === null && vereinbart === null) {
    throw new Error(
      "Der Verzugsbeginn lässt sich nicht bestimmen: Die Rechnung hat weder ein Rechnungs- noch ein Fälligkeitsdatum."
    );
  }
  // Ohne Rechnungsdatum lässt sich der 30-Tage-Boden nicht rechnen; dann bleibt
  // nur das Fälligkeitsdatum. Das betrifft praktisch nur Entwürfe, und die sind
  // ohnehin nicht mahnbar.
  if (vereinbart === null) return gesetzlich!;

  parseDay(vereinbart); // Formatprüfung, bevor lexikografisch verglichen wird
  if (gesetzlich === null) return vereinbart;

  return vereinbart > gesetzlich ? vereinbart : gesetzlich;
}

// ---------------------------------------------------------------------------
// 2. Nächste fällige Stufe
// ---------------------------------------------------------------------------

/**
 * Was dieses Modul von einer bereits geschriebenen Mahnung braucht — ein
 * echter `payment_reminders`-Datensatz passt, ein Testobjekt mit diesen vier
 * Feldern auch.
 */
export type BisherigeMahnung = Pick<
  PaymentReminder,
  "stage_position" | "due_date" | "late_fee_flat" | "superseded_by"
>;

/**
 * Nur die gültigen Fassungen.
 *
 * Eine abgelöste Mahnung (`superseded_by` gesetzt) ist durch ihre
 * Nachfolgefassung ersetzt und existiert nur noch als Beleg, dass einmal etwas
 * anderes verschickt wurde. Sie zählt deshalb weder als erreichte Stufe noch
 * als bereits berechnete Pauschale.
 */
function gueltige(mahnungen: readonly BisherigeMahnung[]): BisherigeMahnung[] {
  return mahnungen.filter((m) => m.superseded_by === null);
}

export interface NaechsteStufeErgebnis {
  /** Die nächste zu schreibende Stufe, oder `null` wenn alle durchlaufen sind. */
  stufe: DunningStageDefinition | null;
  /** Ab wann diese Stufe geschrieben werden darf; `null` wenn es keine gibt. */
  faelligAb: string | null;
  istFaellig: boolean;
  /** Eigener Zustand, kein Fehler: es gibt nichts mehr zu eskalieren. */
  alleStufenDurchlaufen: boolean;
  /** Höchste bereits gemahnte, noch gültige Stufe; 0 = noch nicht gemahnt. */
  hoechsteStufe: number;
}

/**
 * Welche Stufe als nächstes dran ist und ab wann.
 *
 * Bezugsgröße für `days_after_previous` (so auch im Kommentar der Migration
 * 040 festgehalten):
 *
 *  * **Stufe 1** zählt ab dem Verzugsbeginn, also ab der maßgeblichen
 *    Fälligkeit der Rechnung.
 *  * **Jede weitere Stufe** zählt ab dem `due_date` der letzten gültigen
 *    Mahnung — also ab dem Ablauf der Frist, die diese Mahnung tatsächlich
 *    eingeräumt hat.
 *
 * Warum das `due_date` der Vorstufe und nicht deren `grace_days`: Die Frist auf
 * dem Papier ist das, was der Schuldner gelesen hat. `grace_days` ist nur die
 * Rechenvorschrift, aus der sie einmal entstanden ist — wer sie hier erneut
 * addierte, zählte die Nachfrist doppelt. Und weil die Frist relativ zum
 * tatsächlichen Schreiben steht und nicht absolut zur Rechnung, stellt eine
 * verspätet verschickte Mahnung die nächste nicht rückwirkend fällig.
 */
export function naechsteStufe(
  stages: readonly DunningStageDefinition[],
  bisherigeMahnungen: readonly BisherigeMahnung[],
  verzugsbeginnTag: string,
  stichtag: string
): NaechsteStufeErgebnis {
  const aktuelle = gueltige(bisherigeMahnungen);
  const hoechsteStufe = aktuelle.reduce((max, m) => Math.max(max, m.stage_position), 0);

  const sortiert = [...stages].sort((a, b) => a.position - b.position);
  const stufe = sortiert.find((s) => s.position > hoechsteStufe) ?? null;

  if (stufe === null) {
    return {
      stufe: null,
      faelligAb: null,
      istFaellig: false,
      alleStufenDurchlaufen: true,
      hoechsteStufe,
    };
  }

  // Bei mehreren Fassungen derselben Stufe (kann es durch den partiellen
  // UNIQUE-Index eigentlich nicht geben) zählt die mit der spätesten Frist —
  // das ist die, die der Schuldner zuletzt in der Hand hatte.
  const letzte = aktuelle
    .filter((m) => m.stage_position === hoechsteStufe)
    .sort((a, b) => (a.due_date < b.due_date ? 1 : -1))[0];

  const bezug = letzte ? letzte.due_date : verzugsbeginnTag;
  const faelligAb = addDays(bezug, stufe.days_after_previous);

  return {
    stufe,
    faelligAb,
    istFaellig: stichtag >= faelligAb,
    alleStufenDurchlaufen: false,
    hoechsteStufe,
  };
}

// ---------------------------------------------------------------------------
// 3. Die Forderung
// ---------------------------------------------------------------------------

/**
 * Status, in denen nicht gemahnt wird.
 *
 * `draft` ist noch gar keine Rechnung — sie hat den Schuldner nie erreicht, es
 * gibt also nichts, womit er in Verzug sein könnte. `paid`, `cancelled` und
 * `uneinbringlich` sind Endzustände: bezahlt, zurückgenommen, abgeschrieben.
 * In allen vier Fällen besteht keine Forderung mehr, die sich beziffern ließe.
 *
 * Die Werte stammen aus dem CHECK auf `invoices.status` (Migration 040 bzw.
 * `types/database.ts`); mahnbar bleiben damit `created`, `sent` und `reminded`.
 */
export const NICHT_MAHNBARE_STATUS = [
  "draft",
  "paid",
  "cancelled",
  "uneinbringlich",
] as const satisfies readonly Invoice["status"][];

export function istMahnbarerStatus(status: Invoice["status"]): boolean {
  return !(NICHT_MAHNBARE_STATUS as readonly string[]).includes(status);
}

/**
 * Ist der Beleg seiner **Natur** nach mahnbar?
 *
 * Eine Stornorechnung (`invoice_type === 'cancellation'`) ist keine Forderung,
 * sondern eine Gutschrift: Das Geld schuldet der Rechnungssteller dem
 * Empfänger, nicht umgekehrt. Sie zu mahnen ist nicht „betragsmäßig sinnlos",
 * sondern fachlich verkehrt — und zwar unabhängig davon, welche Zahl im Beleg
 * steht.
 *
 * Bisher fiel ein Storno nur deshalb heraus, weil seine Beträge negiert sind
 * und damit die Prüfung `offenerBetrag <= 0` griff. Das ist ein Zufallstreffer:
 * Er prüft das Vorzeichen, nicht den Beleg. Ein Storno mit positivem Betrag
 * (fehlerhaft erzeugt, importiert, per API angelegt, oder über den Parameter
 * `offenerBetrag` übersteuert) rutschte durch — und erzeugte eine Mahnung über
 * Geld, das der Mahnende selbst schuldet.
 *
 * Bewusst **neben** `istMahnbarerStatus` und nicht darin:
 *
 *  * Es sind zwei verschiedene Fragen. Der Status ist ein Lebenszyklus und
 *    ändert sich („bezahlt"), die Belegart ist eine Eigenschaft, die der Beleg
 *    nie wieder verliert. Getrennt gehalten, trägt jede ihre eigene, klare
 *    Fehlermeldung; zusammengelegt bliebe nur eine gemeinsame, vage.
 *  * `istMahnbarerStatus` nähme sonst die ganze Rechnung statt eines Status und
 *    müsste umbenannt werden — eine Signaturänderung an einer exportierten
 *    Funktion, die anderswo bereits aufgerufen wird.
 *  * `lib/invoice-utils.ts` (`isOverdue`) trennt die beiden Prüfungen genauso.
 *    Zwei Stellen, dieselbe Reihenfolge, dieselbe Begründung.
 */
export function istMahnbarerBeleg(invoice: Pick<Invoice, "invoice_type">): boolean {
  return invoice.invoice_type !== "cancellation";
}

/** Was `berechneForderung` von einer Rechnung braucht. */
export type ForderungInvoice = Pick<
  Invoice,
  "status" | "invoice_type" | "invoice_date" | "due_date" | "total_amount"
>;

export interface ForderungInput {
  invoice: ForderungInvoice;
  stufe: DunningStageDefinition;
  /** Alle Fassungen zu dieser Rechnung, abgelöste eingeschlossen. */
  bisherigeMahnungen: readonly BisherigeMahnung[];
  /** `null` heißt unbekannt, nicht „Unternehmen". */
  customerType: CustomerType;
  /** Ergebnis von `verzugsbeginn()` — der maßgebliche Fälligkeitstag. */
  verzugsbeginn: string;
  /** Datum der Mahnung. Es gibt bewusst keinen Standardwert „heute". */
  stichtag: string;
  /** Basiszinssatz von Hand setzen, wenn die Tabelle veraltet ist. */
  baseRateOverride?: number;
  /**
   * Noch offener Bruttobetrag. Standard ist `invoice.total_amount`; der
   * Parameter deckt Teilzahlungen ab, für die es keine Zahlungstabelle gibt.
   */
  offenerBetrag?: number;
}

export interface Forderung {
  /** Hauptforderung (brutto). */
  offenerBetrag: number;
  zinsen: number;
  /** Mahngebühr dieser Stufe — tatsächliche Kosten, nie die eigene Zeit. */
  gebuehr: number;
  /** 40 € nach § 288 Abs. 5 BGB, oder 0. */
  pauschale: number;
  summe: number;
  /** Stichtag + `grace_days` der Stufe. */
  neueFrist: string;
  /**
   * Die Zinsen stützen sich auf einen Basiszinssatz, den niemand gegen die
   * Bundesbank geprüft hat. Die Oberfläche muss das zur Bestätigung vorlegen,
   * bevor die Mahnung rausgeht.
   */
  stale: boolean;
  /** Alles, was der Nutzer wissen muss. Deutsch, in Sie-Form, zum Anzeigen. */
  hinweise: string[];
  /**
   * Zinsgrundlagen zum Einfrieren in `payment_reminders` (interest_rate,
   * base_rate, interest_from, interest_days). `null`, wenn keine Zinsen
   * anfallen.
   */
  zinsDetails: InterestResult | null;
}

export function berechneForderung(input: ForderungInput): Forderung {
  const {
    invoice,
    stufe,
    bisherigeMahnungen,
    customerType,
    verzugsbeginn: verzugsbeginnTag,
    stichtag,
    baseRateOverride,
  } = input;

  // Nicht mahnbare Rechnungen werfen, statt ein Ergebnis mit Hinweis zu
  // liefern. `hinweise` ist der Kanal für eine Forderung, die *besteht* und
  // über die der Nutzer noch etwas wissen muss. Bei einer bezahlten,
  // stornierten, abgeschriebenen oder nie verschickten Rechnung besteht gar
  // keine Forderung — ein Ergebnisobjekt mit `summe > 0` und einem Satz
  // daneben lädt den Aufrufer geradezu ein, es trotzdem zu drucken. Ein Wurf
  // kann nicht versehentlich in einem PDF landen. Die Oberfläche filtert diese
  // Rechnungen ohnehin vorher aus; kommt eine hier an, ist das ein Fehler im
  // Programm und keine Lage des Nutzers.
  // Vor dem Status, weil die Belegart der grundsätzlichere Einwand ist: Ein
  // Status lässt sich ändern, aus einem Storno wird nie eine Forderung. Steht
  // ein Storno zusätzlich auf einem Endstatus, ist „das ist eine Gutschrift"
  // die Auskunft, die weiterhilft.
  if (!istMahnbarerBeleg(invoice)) {
    throw new Error(
      "Eine Stornorechnung kann nicht gemahnt werden: Sie ist eine Gutschrift — der Betrag steht dem Empfänger zu, nicht Ihnen."
    );
  }

  if (!istMahnbarerStatus(invoice.status)) {
    throw new Error(
      `Eine Rechnung im Status "${invoice.status}" kann nicht gemahnt werden.`
    );
  }

  const offenerBetrag = round2(input.offenerBetrag ?? invoice.total_amount);
  if (offenerBetrag <= 0) {
    // Gleiche Begründung wie oben, und zugleich der CHECK
    // payment_reminders.claimed_amount > 0 aus Migration 040.
    throw new Error(
      "Es gibt nichts zu mahnen: Der offene Betrag ist null oder negativ."
    );
  }

  parseDay(verzugsbeginnTag);
  parseDay(stichtag);

  const hinweise: string[] = [];

  // Verzug besteht erst NACH Ablauf des maßgeblichen Fälligkeitstages — am Tag
  // selbst darf noch gezahlt werden (§ 187 Abs. 1 BGB). Deshalb `>` und
  // nicht `>=`; dieselbe Grenze zieht `computeDefaultInterest`, das bei
  // asOf === dueDate null Zinstage rechnet.
  const verzugEingetreten = stichtag > verzugsbeginnTag;

  const stufeFordertNebenforderungen =
    stufe.charge_interest || stufe.charge_late_fee_flat || stufe.fee_amount > 0;

  if (!verzugEingetreten) {
    hinweise.push(
      `Der Verzug beginnt erst nach Ablauf des ${d(verzugsbeginnTag)}; zum Stichtag ${d(stichtag)} befindet sich der Schuldner noch nicht in Verzug.` +
        (stufeFordertNebenforderungen
          ? ` Verzugszinsen, Mahngebühr und Verzugspauschale fallen deshalb nicht an, obwohl die Stufe „${stufe.name}" sie vorsieht.`
          : " Diese Mahnung enthält deshalb nur die offene Hauptforderung.")
    );
  }

  // --- Zinsen ------------------------------------------------------------
  //
  // Die Konfiguration sagt „darf" (`charge_interest`), der Verzug entscheidet
  // „fällt an". `verzugsbeginnTag` geht unverändert als `dueDate` hinein: die
  // Zinsen laufen ab dem Folgetag.
  const zinsDetails =
    stufe.charge_interest && verzugEingetreten
      ? computeDefaultInterest({
          principal: offenerBetrag,
          dueDate: verzugsbeginnTag,
          asOf: stichtag,
          customerType,
          baseRateOverride,
        })
      : null;

  const zinsen = zinsDetails ? zinsDetails.amount : 0;
  const stale = zinsDetails ? zinsDetails.stale : false;

  if (stale) {
    hinweise.push(
      "Der Basiszinssatz für diesen Zeitraum ist in der Anwendung noch nicht als geprüft hinterlegt, sondern fortgeschrieben. Bitte bestätigen Sie den verwendeten Satz, bevor Sie diese Mahnung versenden."
    );
  }

  // --- Mahngebühr --------------------------------------------------------
  //
  // Mahnkosten sind Verzugsschaden (§ 286 Abs. 4, § 280 BGB) und setzen
  // deshalb ebenfalls Verzug voraus.
  const gebuehr = verzugEingetreten ? round2(stufe.fee_amount) : 0;

  // --- Verzugspauschale --------------------------------------------------
  //
  // Die 40 € nach § 288 Abs. 5 BGB fallen **einmal je Forderung** an, nicht je
  // Schreiben — auch dann nicht mehrfach, wenn mehrere Stufen
  // `charge_late_fee_flat` tragen.
  //
  // Welche früheren Mahnungen dabei zählen:
  //
  //  * Abgelöste Fassungen zählen **nicht**. Sie sind durch ihre Nachfolgerin
  //    ersetzt; was sie einmal gefordert haben, ist keine bestehende Forderung
  //    mehr. Zählte man sie mit, ließe sich eine einmal irrtümlich berechnete
  //    Pauschale nie wieder korrigieren: die abgelöste Fassung blockierte sie
  //    für immer. Dazu passt auch ON DELETE SET NULL auf `superseded_by` —
  //    wird eine ungesendete Korrektur gelöscht, ist die Vorgängerin wieder
  //    gültig und zählt dann wieder mit. „Gültig oder nicht" ist damit das
  //    einzige Kriterium, das in beide Richtungen konsistent bleibt.
  //
  //  * Fassungen **derselben Stufe** zählen ebenfalls nicht. Wer gerade eine
  //    Korrektur der 1. Mahnung rechnet, rechnet nicht *zusätzlich* zu ihr,
  //    sondern *an ihrer Stelle*. Zum Rechenzeitpunkt steht die Vorgängerin
  //    noch auf gültig (sie kann erst abgelöst werden, wenn die Nachfolgerin
  //    als Zeile existiert), dürfte die Pauschale also sonst nie erneut
  //    tragen — und die Korrektur wäre um 40 € zu niedrig.
  const pauschaleBereitsBerechnet = gueltige(bisherigeMahnungen).some(
    (m) => m.stage_position !== stufe.position && m.late_fee_flat > 0
  );

  let pauschale = 0;
  if (stufe.charge_late_fee_flat) {
    if (!mayChargeLateFeeFlat(customerType)) {
      hinweise.push(
        customerType === "consumer"
          ? `Die Verzugspauschale von ${eur(LATE_FEE_FLAT)} nach § 288 Abs. 5 BGB steht Ihnen nur gegenüber Unternehmen zu und wird gegenüber einem Verbraucher deshalb nicht berechnet.`
          : `Die Verzugspauschale von ${eur(LATE_FEE_FLAT)} nach § 288 Abs. 5 BGB wird nicht berechnet, weil nicht hinterlegt ist, ob der Schuldner ein Unternehmen ist.`
      );
    } else if (pauschaleBereitsBerechnet) {
      hinweise.push(
        `Die Verzugspauschale von ${eur(LATE_FEE_FLAT)} nach § 288 Abs. 5 BGB fällt je Forderung nur einmal an. Sie wurde bereits mit einer früheren Mahnung berechnet und wird hier nicht erneut angesetzt.`
      );
    } else if (verzugEingetreten) {
      pauschale = LATE_FEE_FLAT;
    }
  }

  // Der unbekannte Schuldnertyp kostet den höheren Zinssatz (5 statt 9 Punkte)
  // und die Pauschale. Der Hinweis erscheint nur, wenn an dieser Stufe
  // tatsächlich etwas davon hängt — sonst wäre er Lärm.
  if (customerType === null && (stufe.charge_interest || stufe.charge_late_fee_flat)) {
    hinweise.push(
      `Sie haben nicht hinterlegt, ob es sich beim Schuldner um ein Unternehmen oder um einen Verbraucher handelt. Vorsichtshalber werden nur 5 Prozentpunkte über dem Basiszinssatz berechnet (§ 288 Abs. 1 BGB) statt 9 (§ 288 Abs. 2 BGB), und die Verzugspauschale von ${eur(LATE_FEE_FLAT)} bleibt außen vor. Pflegen Sie die Angabe am Kontakt nach, wenn Sie gegenüber einem Unternehmen mahnen.`
    );
  }

  if (input.offenerBetrag !== undefined && offenerBetrag !== round2(invoice.total_amount)) {
    hinweise.push(
      `Sie mahnen einen Teilbetrag von ${eur(offenerBetrag)} statt des vollen Rechnungsbetrags von ${eur(round2(invoice.total_amount))}. Verzugszinsen werden nur auf den offenen Teilbetrag berechnet.`
    );
  }

  return {
    offenerBetrag,
    zinsen,
    gebuehr,
    pauschale,
    // Gerundet summiert, nicht aus ungerundeten Zwischenwerten: der CHECK
    // payment_reminders_total_is_sum rechnet in NUMERIC exakt nach und duldet
    // keinen Rundungsrest.
    summe: round2(offenerBetrag + zinsen + gebuehr + pauschale),
    // `grace_days` ist eine **Nach**frist — sie setzt voraus, dass eine Frist
    // abgelaufen ist. Steht die Faelligkeit der Rechnung noch bevor, gibt es
    // nichts nachzufristen: Dann nennt die Erinnerung den Termin der Rechnung
    // selbst. Sonst entstuende ein zweites, widersprechendes Zahlungsziel —
    // bei einer in drei Wochen faelligen Rechnung frueher als die Rechnung
    // verlangt, bei einer uebermorgen faelligen spaeter. Und weil dieser Wert
    // als payment_reminders.due_date eingefroren wird und `naechsteStufe` die
    // Folgestufe dagegen rechnet, schaltete Stufe 2 sonst frei, bevor die
    // Rechnung ueberhaupt faellig ist.
    neueFrist:
      invoice.due_date && invoice.due_date > stichtag
        ? invoice.due_date
        : addDays(stichtag, stufe.grace_days),
    stale,
    hinweise,
    zinsDetails,
  };
}
