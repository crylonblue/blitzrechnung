import { daysBetween } from "./iso-day";

/**
 * Die Achse: der Mahnweg einer Rechnung als eine Spur.
 *
 * Was war, was dran ist und was kommt — untereinander, in der Reihenfolge, in
 * der es geschieht. Das löst die getrennte Darstellung ab, bei der die
 * vorhandenen Dokumente in einer Liste standen und der Ausblick auf die
 * nächste Stufe als Satz darunter: Beides ist derselbe Weg, und wer ihn
 * zerschneidet, zwingt den Leser, ihn im Kopf wieder zusammenzusetzen.
 *
 * **Warum das überhaupt ein eigenes Modul ist.** Die Leiter gehört der Firma
 * (`dunning_stages`), nicht uns. Welcher Schritt wo steht, hängt damit an
 * Daten, die sich je Firma unterscheiden — mal drei Stufen mit
 * Zahlungserinnerung, mal zwei ohne. Eine Komponente, die das beim Zeichnen
 * nebenbei entscheidet, lässt sich nur noch im Browser prüfen. Hier steht die
 * Entscheidung als reine Funktion, und `tests/dunning-axis.test.ts` fährt sie
 * gegen beide Leitern.
 *
 * **Keine Stufennamen im Code.** In diesem Modul kommt weder
 * „Zahlungserinnerung" noch „1. Mahnung" vor. Jeder Name stammt aus der
 * Einstellung der Firma; wer keine Zahlungserinnerung führt, sieht auch keine.
 * Steht hier irgendwann doch ein Stufenname, ist etwas falsch.
 *
 * **Kein `new Date()`.** Der heutige Tag kommt als Argument herein, wie
 * überall im Mahnwesen. Ein Modul, das selbst in den Kalender sieht, lässt
 * sich zum Jahreswechsel nicht mehr prüfen.
 */

// ---------------------------------------------------------------------------
// Was hereinkommt
// ---------------------------------------------------------------------------

/*
 * Die Eingabetypen sind hier **eigenständig erklärt** und nicht aus
 * `components/invoices/dunning-api.ts` importiert, obwohl die echten Objekte
 * von dort kommen. Zwei Gründe: `lib/` darf nicht von `components/` abhängen,
 * sonst zieht ein Test der Fachlogik die halbe Oberfläche nach sich. Und
 * strukturelle Typisierung macht den Import überflüssig — es zählt die Form,
 * nicht der Name. Hier steht deshalb nur, was die Achse wirklich liest.
 */

export interface AchsenRechnung {
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  total_amount: number;
  status: string;
}

export interface AchsenMahnung {
  id: string;
  stage_position: number;
  stage_name: string;
  reminder_date: string;
  status: string;
  total_amount: number;
  superseded_by: string | null;
  pdf_url: string | null;
  sent_at: string | null;
}

export interface AchsenStufe {
  position: number;
  name: string;
  bereitsErstellt: boolean;
  tageNachVorstufe: number;
  fristTage: number;
  berechnetZinsen: boolean;
  berechnetPauschale: boolean;
  gebuehr: number;
}

export interface AchsenForderung {
  offenerBetrag: number;
  zinsen: number;
  gebuehr: number;
  pauschale: number;
  summe: number;
  neueFrist: string;
}

export interface AchsenStatus {
  mahnbar: boolean;
  stufe: { position: number; name: string } | null;
  istFaellig: boolean;
  faelligAb: string | null;
  forderung: AchsenForderung | null;
  stufen: readonly AchsenStufe[];
  verlauf: readonly AchsenMahnung[];
}

// ---------------------------------------------------------------------------
// Was herauskommt
// ---------------------------------------------------------------------------

/**
 * Die fünf Arten von Schritten — mehr gibt es nicht.
 *
 * `rechnung` und `frist` sind die beiden Ereignisse, die jede Rechnung hat und
 * die keiner Mahnstufe gehören. `mahnung` ist ein Schreiben, das existiert.
 * `faellig` ist der eine Schritt mit einem Knopf. `kuenftig` sind die, die
 * danach kämen — ohne Termin, denn ihr Datum hängt daran, wann das fällige
 * Schreiben tatsächlich hinausgeht.
 */
export type SchrittArt = "rechnung" | "frist" | "mahnung" | "faellig" | "kuenftig";

export interface AchsenSchritt {
  art: SchrittArt;
  /** Stabil über Neuberechnungen hinweg — React braucht ihn als `key`. */
  schluessel: string;
  /** Die Überschrift der Zeile. Bei Stufen: ihr eingestellter Name. */
  titel: string;
  /**
   * Der Tag, an dem der Schritt steht. `null` bei künftigen Stufen: Ihr Termin
   * ergibt sich erst aus dem Versandtag des fälligen Schreibens, und ein
   * ausgedachtes Datum sähe aus wie ein Termin.
   */
  tag: string | null;
  /** Nur bei `rechnung`: der Rechnungsbetrag. */
  betrag?: number;
  /** Nur bei `frist`: wie viele Tage die Frist zurückliegt. */
  verzugsTage?: number;
  /** Nur bei `mahnung`: das Schreiben selbst. */
  mahnung?: AchsenMahnung;
  /** Bei `faellig` und `kuenftig`: die Stufe aus der Einstellung der Firma. */
  stufe?: AchsenStufe;
  /** Nur bei `faellig`: was dieses Schreiben heute fordern würde. */
  forderung?: AchsenForderung;
  /**
   * Nur bei `faellig`: Ist die Stufe nach dem Zeitplan schon an der Reihe?
   * `false` heisst **nicht** „gesperrt" — gemahnt werden darf trotzdem, die
   * Zeile sagt es nur dazu.
   */
  istFaellig?: boolean;
}

/** Status, in denen eine offene Frist keine Auskunft mehr ist. */
const ERLEDIGT = new Set(["paid", "cancelled", "uneinbringlich"]);

/**
 * Die Schritte einer Rechnung, chronologisch.
 *
 * `heute` ist ein ISO-Tag. Die Reihenfolge ergibt sich aus der Sache und nicht
 * aus einer Sortierung über alles: Rechnung, dann Fristablauf, dann die
 * Schreiben nach ihrem Datum, dann das fällige, dann die künftigen nach
 * Position. Ein Gesamtsortieren wäre hier sogar falsch — die künftigen Stufen
 * haben absichtlich kein Datum und würden irgendwohin rutschen.
 */
export function baueAchse(
  rechnung: AchsenRechnung,
  status: AchsenStatus,
  heute: string
): AchsenSchritt[] {
  const schritte: AchsenSchritt[] = [];

  schritte.push({
    art: "rechnung",
    schluessel: "rechnung",
    titel: rechnung.invoice_number ? `Rechnung ${rechnung.invoice_number}` : "Rechnung",
    tag: rechnung.invoice_date,
    betrag: rechnung.total_amount,
  });

  // Der Fristablauf wird nur gezeigt, solange er etwas bedeutet. Bei einer
  // bezahlten oder stornierten Rechnung ist „überfällig" zwar historisch wahr,
  // liest sich aber wie ein offener Posten — und das wäre eine Falschauskunft
  // an der auffälligsten Stelle der Spur.
  const offen = !ERLEDIGT.has(rechnung.status);
  if (offen && rechnung.due_date && rechnung.due_date < heute) {
    schritte.push({
      art: "frist",
      schluessel: "frist",
      titel: "Zahlungsfrist abgelaufen",
      tag: rechnung.due_date,
      verzugsTage: daysBetween(rechnung.due_date, heute),
    });
  }

  // Abgelöste Fassungen bleiben in der Spur: Sie sind geschehen, und ein
  // Verlauf, der Geschehenes verschweigt, ist kein Verlauf. Dass sie nicht
  // mehr zählen, sagt ihre Zeile — hier wird nicht aussortiert.
  const nachDatum = [...status.verlauf].sort(
    (a, b) =>
      a.reminder_date.localeCompare(b.reminder_date) || a.stage_position - b.stage_position
  );
  for (const mahnung of nachDatum) {
    schritte.push({
      art: "mahnung",
      schluessel: mahnung.id,
      titel: mahnung.stage_name,
      tag: mahnung.reminder_date,
      mahnung,
    });
  }

  // Die fällige Stufe. `status.stufe` nennt nur Position und Name; die
  // Rechenfelder stehen in `status.stufen`. Fehlt dort der passende Eintrag,
  // gibt es keinen Knopf — lieber kein Schritt als einer, der nicht sagen
  // kann, was er auslöst.
  const dran =
    status.mahnbar && status.stufe
      ? (status.stufen.find((s) => s.position === status.stufe!.position) ?? null)
      : null;

  if (dran) {
    schritte.push({
      art: "faellig",
      schluessel: `stufe-${dran.position}`,
      titel: dran.name,
      tag: status.faelligAb,
      stufe: dran,
      forderung: status.forderung ?? undefined,
      istFaellig: status.istFaellig,
    });

    // Was danach käme. Nur wenn es ein Danach gibt: Ohne fällige Stufe —
    // bezahlt, storniert, alle Stufen durchlaufen — ist die Spur zu Ende, und
    // eine Vorschau auf Schreiben, die niemand mehr verschickt, wäre Lärm.
    for (const stufe of status.stufen) {
      if (stufe.position <= dran.position) continue;
      if (stufe.bereitsErstellt) continue;
      schritte.push({
        art: "kuenftig",
        schluessel: `stufe-${stufe.position}`,
        titel: stufe.name,
        tag: null,
        stufe,
      });
    }
  }

  return schritte;
}

/**
 * Was eine künftige Stufe **zusätzlich** fordern wird — als Aufzählung.
 *
 * Leer heisst „nichts obendrauf". Die Zinsen stehen auch dann drin, wenn eine
 * frühere Stufe sie bereits berechnet: Für den Leser ist die Frage nicht, ob
 * dieses Schreiben die Zinsen erfindet, sondern ob es welche fordert.
 */
export function zusatzForderungen(stufe: AchsenStufe): string[] {
  const teile: string[] = [];
  if (stufe.berechnetZinsen) teile.push("Verzugszinsen");
  if (stufe.berechnetPauschale) teile.push("40 € Pauschale");
  if (stufe.gebuehr > 0) teile.push("Mahngebühr");
  return teile;
}
