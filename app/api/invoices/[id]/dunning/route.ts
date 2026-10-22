import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { assertCompanyMembership, InvoiceServiceError } from '@/lib/invoice-service'
import { meldeFehler } from '@/lib/observability'
import {
  DunningServiceError,
  baueMahnungsMail,
  erstelleMahnungMitSchreiben,
  ladeMahnungen,
  sortiereHinweise,
  versendeMahnung,
} from '@/lib/dunning-service'
import {
  berechneForderung,
  istMahnbarerBeleg,
  istMahnbarerStatus,
  naechsteStufe,
  verzugsbeginn,
  type Forderung,
} from '@/lib/dunning-claim'
import { getDunningStages, type DunningStageDefinition } from '@/lib/dunning-stages'
import type { CustomerType } from '@/lib/dunning-interest'
import type { Invoice, PaymentReminder } from '@/types'

/**
 * Der Weg vom Mahnen-Dialog zum Mahnwesen.
 *
 * `GET` beantwortet die Frage „kann ich diese Rechnung mahnen, und was käme
 * dabei heraus?" — ohne eine Zeile zu schreiben. `POST` legt die Mahnung an
 * **und erzeugt ihr Mahnschreiben**: Danach steht sie in der Belegübersicht
 * und lässt sich herunterladen. Misslingt das PDF, entsteht gar keine Mahnung
 * (siehe `erstelleMahnungMitSchreiben`) — eine Mahnung ohne Dokument wäre eine
 * Zeile, die man nur noch verwerfen kann.
 *
 * Verschickt wird hier trotzdem nichts: Das ist ein eigener Schritt unter
 * `app/api/dunning/[reminderId]/send`, und erst er hebt die Rechnung auf
 * `reminded`. `reminded` sagt aus, dass gemahnt *wurde*, und das stimmt erst,
 * wenn das Schreiben draußen ist.
 *
 * **Warum diese Route nicht wirft, wo die Bibliothek wirft.**
 * `berechneForderung` wirft bei einer bezahlten, stornierten oder noch nicht
 * verschickten Rechnung mit voller Absicht: Eine Bibliothek, die in so einem
 * Fall ein Ergebnisobjekt zurückgäbe, lüde den Aufrufer ein, es trotzdem zu
 * drucken. Eine Route hat die umgekehrte Aufgabe. Der Dialog ruft sie auf, um
 * dem Nutzer eine *Lage* zu erklären, und „Serverfehler 500" erklärt nichts.
 * Deshalb wird hier jede dieser Lagen abgefangen und in einen deutschen Satz
 * übersetzt: `mahnbar: false` plus `grund`. Ein echter Programmfehler bleibt
 * ein 500er — die Unterscheidung ist genau der Punkt.
 *
 * **Der Stichtag ist immer heute.** Zinstage, Fristen und die Frage, ob eine
 * Stufe schon fällig ist, hängen am Kalender. Die Rechenmodule kennen bewusst
 * kein „heute" (siehe Kopfkommentar von `lib/dunning-claim.ts`); diese Route
 * ist die Stelle, an der der Kalender einmal hereinkommt.
 */

/** Heute als ISO-Tag, wie im restlichen Projekt (vgl. `lib/invoice-service.ts`). */
function heute(): string {
  return new Date().toISOString().split('T')[0]
}

// ---------------------------------------------------------------------------
// Die Überschreibungen aus „Anpassen"
// ---------------------------------------------------------------------------

/**
 * Was der Nutzer im Dialog übersteuern darf. Alles optional; `null` heißt
 * „nicht übergeben" und nicht „ausgeschaltet".
 */
interface Anpassungen {
  /** Position der Mahnstufe, die geschrieben werden soll. */
  stage: number | null
  /** Abweichender Verzugsbeginn (nachweislich vereinbartes Zahlungsziel). */
  defaultSince: string | null
  /** Zinsen erzwingen oder unterdrücken, abweichend von der Stufe. */
  interest: boolean | null
  /** Basiszinssatz von Hand, wenn die Tabelle veraltet ist. */
  baseRate: number | null
  /** Antwort auf die einmalige Frage nach dem Schuldnertyp. */
  customerType: 'business' | 'consumer' | null
}

/** Eine unbrauchbare Eingabe — führt zu 400, nicht zu `mahnbar: false`. */
class AnpassungsFehler extends Error {}

/**
 * Query-Parameter und JSON-Body lesen dieselben Felder.
 *
 * Deshalb liest diese Funktion über einen Zugriff auf Namen statt über ein
 * konkretes Objekt: Der Dialog schickt im `GET` Zeichenketten und im `POST`
 * womöglich echte Zahlen und Wahrheitswerte, die Bedeutung ist dieselbe. Eine
 * zweite, leicht abweichende Auswertung wäre genau die Sorte Unterschied, die
 * später niemand mehr erklären kann.
 */
function leseAnpassungen(hole: (name: string) => string | null): Anpassungen {
  const stageRoh = hole('stage')
  let stage: number | null = null
  if (stageRoh !== null) {
    stage = Number(stageRoh)
    if (!Number.isInteger(stage) || stage < 1) {
      throw new AnpassungsFehler('Die Mahnstufe muss eine ganze Zahl ab 1 sein.')
    }
  }

  const interestRoh = hole('interest')
  let interest: boolean | null = null
  if (interestRoh !== null) {
    if (interestRoh === 'on' || interestRoh === 'true') interest = true
    else if (interestRoh === 'off' || interestRoh === 'false') interest = false
    else throw new AnpassungsFehler('Verzugszinsen lassen sich nur ein- („on") oder ausschalten („off").')
  }

  const baseRateRoh = hole('baseRate')
  let baseRate: number | null = null
  if (baseRateRoh !== null) {
    // Auch mit Komma: Wer einen deutschen Zinssatz abtippt, tippt „1,52".
    baseRate = Number(baseRateRoh.replace(',', '.'))
    if (!Number.isFinite(baseRate)) {
      throw new AnpassungsFehler('Der Basiszinssatz muss eine Zahl sein, zum Beispiel 1,52.')
    }
  }

  const typRoh = hole('customerType')
  if (typRoh !== null && typRoh !== 'business' && typRoh !== 'consumer') {
    throw new AnpassungsFehler('Der Schuldner ist entweder ein Unternehmen („business") oder ein Verbraucher („consumer").')
  }

  return {
    stage,
    defaultSince: hole('defaultSince'),
    interest,
    baseRate,
    customerType: (typRoh as 'business' | 'consumer' | null) ?? null,
  }
}

function ausQuery(request: NextRequest): Anpassungen {
  const { searchParams } = new URL(request.url)
  return leseAnpassungen((name) => searchParams.get(name))
}

function ausBody(body: Record<string, unknown>): Anpassungen {
  return leseAnpassungen((name) => {
    const wert = body[name]
    return wert === undefined || wert === null || wert === '' ? null : String(wert)
  })
}

// ---------------------------------------------------------------------------
// Die Lage
// ---------------------------------------------------------------------------

/** Genau die Antwortform, gegen die der Dialog baut. */
interface Mahnlage {
  mahnbar: boolean
  /** Nur wenn nicht mahnbar: warum, in Sie-Form. */
  grund?: string
  stufe: { position: number; name: string } | null
  alleStufenDurchlaufen: boolean
  /**
   * Ab wann die Stufe geschrieben werden darf. `null`, wenn es keine Stufe
   * mehr gibt oder der Verzugsbeginn sich nicht bestimmen lässt — in beiden
   * Fällen steht auch `stufe` auf `null`.
   */
  faelligAb: string | null
  istFaellig: boolean
  /** `null` nur, wenn die Rechnung weder Rechnungs- noch Fälligkeitsdatum hat. */
  verzugsbeginn: string | null
  forderung: {
    offenerBetrag: number
    zinsen: number
    gebuehr: number
    pauschale: number
    summe: number
    neueFrist: string
  } | null
  zinsDetails: Forderung['zinsDetails']
  customerType: CustomerType
  stale: boolean
  hinweise: string[]
  /**
   * Die vorbereitete **Begleit-E-Mail** — nicht das Mahnschreiben.
   *
   * Sie reist mit, damit die Schublade beide Texte zeigen kann, bevor
   * irgendetwas angelegt ist, und zwar genau den Text, der ohne Bearbeitung
   * auch hinausginge. Gebaut wird er in `baueMahnungsMail`, also an derselben
   * Stelle wie beim Versand aus der Belegübersicht; zwei Vorlagen liefen
   * irgendwann auseinander. `null`, wenn es nichts zu mahnen gibt.
   */
  mail: { empfaenger: string | null; betreff: string; text: string } | null
  /**
   * Alle eingerichteten Mahnstufen, für die Auswahl unter „Dokument
   * hinzufügen". `bereitsErstellt` heißt: zu dieser Stufe steht schon eine
   * gültige Mahnung — der eindeutige Index ließe keine zweite zu, und das soll
   * die Auswahl sagen statt es den Nutzer probieren zu lassen.
   */
  stufen: Array<{ position: number; name: string; bereitsErstellt: boolean }>
  verlauf: Array<{
    id: string
    stage_position: number
    stage_name: string
    reminder_date: string
    status: PaymentReminder['status']
    due_date: string
    total_amount: number
    /** Gesetzt heißt: durch eine neuere Fassung abgelöst, zählt nicht mehr. */
    superseded_by: string | null
    /**
     * Das Mahnschreiben als Datei. Die Dokumentenliste hängt den
     * Herunterladen-Knopf allein daran. `null` tragen nur noch Mahnungen aus
     * der Zeit vor der Erzeugung — neue entstehen nicht ohne Schreiben.
     */
    pdf_url: string | null
    /** Wann das Schreiben das Haus verlassen hat; `null`, solange es das nicht tat. */
    sent_at: string | null
    /** Die hinterlegte Empfängeradresse — der Versandbildschirm belegt sie vor. */
    recipient_email: string | null
  }>
}

/** Was POST über die Antwort hinaus noch braucht, um zu schreiben. */
interface Bewertung {
  lage: Mahnlage
  invoice: Invoice
  /** Die Stufe samt Überschreibungen — nicht nur Position und Name. */
  stufe: DunningStageDefinition | null
  forderung: Forderung | null
  verzugsbeginnTag: string | null
  stichtag: string
}

/** Statusnamen, wie ein Mensch sie liest. */
const STATUS_GRUND: Record<string, string> = {
  draft:
    'Diese Rechnung ist noch ein Entwurf und hat den Empfänger nie erreicht. Mahnen können Sie erst, wenn die Rechnung festgeschrieben und verschickt ist.',
  paid: 'Diese Rechnung ist als bezahlt vermerkt. Es besteht keine offene Forderung, die Sie mahnen könnten.',
  cancelled: 'Diese Rechnung wurde storniert. Es besteht keine offene Forderung mehr.',
  uneinbringlich:
    'Diese Rechnung ist als uneinbringlich abgeschrieben. Nehmen Sie die Abschreibung zurück, wenn Sie sie doch noch beitreiben wollen.',
}

/**
 * Die ganze Lage ermitteln — lesend, ohne jede Schreiboperation.
 *
 * Bewusst eine Funktion für `GET` und `POST`: Der Dialog zeigt an, was hier
 * herauskommt, und bestätigt genau das. Würde `POST` eigenständig noch einmal
 * entscheiden, könnte er etwas anderes anlegen, als der Nutzer gesehen hat.
 */
async function bewerte(
  supabase: Awaited<ReturnType<typeof createClient>>,
  invoice: Invoice,
  anpassungen: Anpassungen
): Promise<Bewertung> {
  const stichtag = heute()
  const companyId = invoice.company_id

  // --- Schuldnertyp ------------------------------------------------------
  //
  // Der Kontakt wird über die Rechnung gefunden und zusätzlich auf die Firma
  // eingegrenzt — ein Kontakt einer fremden Firma ist für uns nicht vorhanden,
  // und sein `customer_type` darf hier nicht einfließen.
  let kontaktTyp: CustomerType = null
  if (invoice.buyer_contact_id) {
    const { data: kontakt } = await supabase
      .from('contacts')
      .select('customer_type')
      .eq('id', invoice.buyer_contact_id)
      .eq('company_id', companyId)
      .single()
    kontaktTyp = ((kontakt?.customer_type as CustomerType | undefined) ?? null) as CustomerType
  }
  // Die Antwort aus dem Dialog schlägt den gespeicherten Wert — im `GET` nur
  // für die Vorschau, gespeichert wird sie erst beim Anlegen.
  const customerType: CustomerType = anpassungen.customerType ?? kontaktTyp

  const mahnungen = await ladeMahnungen(supabase, { companyId }, invoice.id)
  const verlauf = mahnungen.map((m) => ({
    id: m.id,
    stage_position: m.stage_position,
    stage_name: m.stage_name,
    reminder_date: m.reminder_date,
    status: m.status,
    due_date: m.due_date,
    total_amount: m.total_amount,
    superseded_by: m.superseded_by,
    pdf_url: m.pdf_url,
    sent_at: m.sent_at,
    recipient_email: m.recipient_email,
  }))

  const basis: Mahnlage = {
    mahnbar: false,
    stufe: null,
    alleStufenDurchlaufen: false,
    faelligAb: null,
    istFaellig: false,
    verzugsbeginn: null,
    forderung: null,
    zinsDetails: null,
    customerType,
    stale: false,
    hinweise: [],
    mail: null,
    stufen: [],
    verlauf,
  }

  const leer = (grund: string): Bewertung => ({
    lage: { ...basis, grund },
    invoice,
    stufe: null,
    forderung: null,
    verzugsbeginnTag: null,
    stichtag,
  })

  // --- Die Lagen, in denen es gar nichts zu mahnen gibt -------------------
  //
  // Dieselbe Reihenfolge wie in `berechneForderung`: die Belegart vor dem
  // Status. Ein Status lässt sich ändern, aus einem Storno wird nie eine
  // Forderung.
  if (!istMahnbarerBeleg(invoice)) {
    return leer(
      'Dies ist eine Stornorechnung und damit eine Gutschrift: Der Betrag steht dem Empfänger zu, nicht Ihnen. Eine Gutschrift kann nicht gemahnt werden.'
    )
  }
  if (!istMahnbarerStatus(invoice.status)) {
    return leer(
      STATUS_GRUND[invoice.status] ??
        `Eine Rechnung im Status „${invoice.status}" kann nicht gemahnt werden.`
    )
  }

  // --- Verzugsbeginn -----------------------------------------------------
  let verzugsbeginnTag: string
  try {
    verzugsbeginnTag = verzugsbeginn(invoice, anpassungen.defaultSince)
  } catch {
    // Entweder fehlen beide Daten (praktisch nur bei Entwürfen, die oben schon
    // heraus sind) oder der Nutzer hat ein unbrauchbares Datum übergeben.
    // Beides ist keine Serverstörung, sondern eine Lage, die man erklären kann.
    return leer(
      anpassungen.defaultSince
        ? `Der Verzugsbeginn „${anpassungen.defaultSince}" ist kein gültiges Datum.`
        : 'Der Verzugsbeginn lässt sich nicht bestimmen: Die Rechnung hat weder ein Rechnungs- noch ein Fälligkeitsdatum.'
    )
  }
  basis.verzugsbeginn = verzugsbeginnTag

  // --- Die Stufe ---------------------------------------------------------
  const alleStufen = await getDunningStages(supabase, companyId)
  if (anpassungen.stage !== null && !alleStufen.some((s) => s.position === anpassungen.stage)) {
    throw new AnpassungsFehler(`Eine Mahnstufe ${anpassungen.stage} ist nicht eingerichtet.`)
  }

  // Die Auswahl für „Dokument hinzufügen". Sie steht hier und nicht erst im
  // Erfolgsfall: Auch wenn die gerechnete Forderung scheitert, soll die
  // Oberfläche sagen können, welche Stufen es überhaupt gibt. Abgelöste
  // Fassungen zählen nicht mit — sie geben ihre Stufe wieder frei (vgl.
  // `gueltige()` in `lib/dunning-claim.ts`).
  const belegteStufen = new Set(
    mahnungen.filter((m) => m.superseded_by === null).map((m) => m.stage_position)
  )
  basis.stufen = alleStufen.map((s) => ({
    position: s.position,
    name: s.name,
    bereitsErstellt: belegteStufen.has(s.position),
  }))

  // Wählt der Nutzer eine Stufe, werden die darunterliegenden ausgeblendet —
  // dann liefert `naechsteStufe` genau diese Stufe und rechnet ihre Frist
  // gegen denselben Bezugspunkt (Verzugsbeginn bzw. Frist der letzten gültigen
  // Mahnung). So bleibt diese Regel an einer einzigen Stelle.
  const kandidaten =
    anpassungen.stage === null
      ? alleStufen
      : alleStufen.filter((s) => s.position >= anpassungen.stage!)
  const naechste = naechsteStufe(kandidaten, mahnungen, verzugsbeginnTag, stichtag)

  basis.alleStufenDurchlaufen = naechste.alleStufenDurchlaufen
  basis.faelligAb = naechste.faelligAb
  basis.istFaellig = naechste.istFaellig

  if (naechste.stufe === null) {
    return leer(
      'Alle Mahnstufen sind durchlaufen. Weitere Schritte — gerichtliches Mahnverfahren oder Inkasso — liegen außerhalb dieser Anwendung.'
    )
  }
  if (anpassungen.stage !== null && naechste.stufe.position !== anpassungen.stage) {
    // Der Nutzer wollte eine Stufe, die bereits eine gültige Mahnung trägt.
    // Der partielle eindeutige Index ließe sie ohnehin nicht zweimal zu; hier
    // steht der Satz dazu, statt später ein Datenbankfehler.
    return leer(
      `Zu dieser Rechnung besteht bereits eine gültige Mahnung der Stufe ${anpassungen.stage}. Löschen Sie die bestehende Mahnung oder lösen Sie sie ab, bevor Sie diese Stufe erneut mahnen.`
    )
  }

  // Die Zinsentscheidung des Nutzers wird auf eine **Kopie** der Stufe
  // gelegt. Die Stufenkonfiguration der Firma bleibt unberührt — angepasst
  // wird diese eine Mahnung, nicht die Einstellung.
  const stufe: DunningStageDefinition =
    anpassungen.interest === null
      ? naechste.stufe
      : { ...naechste.stufe, charge_interest: anpassungen.interest }

  basis.stufe = { position: stufe.position, name: stufe.name }

  // --- Die Forderung -----------------------------------------------------
  let forderung: Forderung
  try {
    forderung = berechneForderung({
      invoice,
      stufe,
      bisherigeMahnungen: mahnungen,
      customerType,
      verzugsbeginn: verzugsbeginnTag,
      stichtag,
      ...(anpassungen.baseRate === null ? {} : { baseRateOverride: anpassungen.baseRate }),
    })
  } catch (err) {
    // Hierher kommt, was die Prüfungen oben nicht vorweggenommen haben — vor
    // allem ein offener Betrag von null oder darunter. Die Bibliothek
    // formuliert bereits in Sie-Form; der Satz wird unverändert durchgereicht.
    return leer(err instanceof Error ? err.message : 'Diese Rechnung kann nicht gemahnt werden.')
  }

  // Die Begleit-E-Mail, vorbereitet aus der Mahnung, die hier **entstünde**.
  // Dieselbe Vorlage wie beim Versand: Was die Schublade zeigt, geht auch
  // hinaus, wenn niemand sie anfasst.
  const { data: firma } = await supabase
    .from('companies')
    .select('name')
    .eq('id', companyId)
    .single()
  const kaeufer = invoice.buyer_snapshot as { email?: string } | null
  const mail = {
    ...baueMahnungsMail(
      {
        stage_name: stufe.name,
        due_date: forderung.neueFrist,
        total_amount: forderung.summe,
        language: invoice.language || 'de',
      },
      invoice.invoice_number,
      (firma?.name as string | undefined) || ''
    ),
    empfaenger: invoice.recipient_email || kaeufer?.email || null,
  }

  return {
    lage: {
      ...basis,
      mahnbar: true,
      mail,
      forderung: {
        offenerBetrag: forderung.offenerBetrag,
        zinsen: forderung.zinsen,
        gebuehr: forderung.gebuehr,
        pauschale: forderung.pauschale,
        summe: forderung.summe,
        neueFrist: forderung.neueFrist,
      },
      zinsDetails: forderung.zinsDetails,
      stale: forderung.stale,
      hinweise: sortiereHinweise(forderung.hinweise),
    },
    invoice,
    stufe,
    forderung,
    verzugsbeginnTag,
    stichtag,
  }
}

// ---------------------------------------------------------------------------
// Zugriff
// ---------------------------------------------------------------------------

/**
 * Rechnung laden und Zugriff prüfen — wie in
 * `app/api/invoices/finalize/route.ts`: erst die Zeile, dann die
 * Firmenzugehörigkeit des angemeldeten Nutzers über `assertCompanyMembership`.
 * Die RLS der Datenbank trägt dieselbe Grenze ein zweites Mal; diese Prüfung
 * steht davor, damit der Nutzer 403 und einen Satz bekommt statt einer leeren
 * Antwort.
 */
async function ladeUndPruefe(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  invoiceId: string
): Promise<Invoice> {
  const { data: invoice } = await supabase.from('invoices').select('*').eq('id', invoiceId).single()
  if (!invoice) throw new InvoiceServiceError(404, 'NOT_FOUND', 'Rechnung nicht gefunden')
  await assertCompanyMembership(supabase, userId, (invoice as Invoice).company_id)
  return invoice as Invoice
}

function antwortAufFehler(err: unknown, bereich: string, invoiceId: string): NextResponse {
  if (err instanceof AnpassungsFehler) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
  if (err instanceof InvoiceServiceError || err instanceof DunningServiceError) {
    return NextResponse.json({ error: err.message }, { status: err.status })
  }
  meldeFehler(err, { bereich, invoiceId })
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

// ---------------------------------------------------------------------------
// GET — anzeigen, nichts schreiben
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const invoice = await ladeUndPruefe(supabase, user.id, id)
    const { lage } = await bewerte(supabase, invoice, ausQuery(request))
    return NextResponse.json(lage)
  } catch (err) {
    return antwortAufFehler(err, 'dunning.lage', id)
  }
}

// ---------------------------------------------------------------------------
// POST — die Mahnung anlegen, erzeugen und auf Wunsch verschicken
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const invoice = await ladeUndPruefe(supabase, user.id, id)
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const anpassungen = ausBody(body)
    // Zwei Texte, zwei Felder:
    //
    //  * `text` ist das **Mahnschreiben** — der Brief, der im PDF steht und
    //    eingefroren wird. Ohne Angabe bleibt es beim Text der Stufe; ein
    //    leerer String heisst "kein Text" und ist etwas anderes als "nicht
    //    angegeben".
    //  * `emailSubject`/`emailBody` sind das **Begleitschreiben** der E-Mail.
    //    Sie werden nirgends gespeichert: Sie gelten für diesen einen Versand.
    const schreibtext = typeof body.text === 'string' ? body.text : undefined
    const sofortSenden = body.send === true

    const bewertung = await bewerte(supabase, invoice, anpassungen)
    if (!bewertung.lage.mahnbar || !bewertung.stufe || !bewertung.forderung || !bewertung.verzugsbeginnTag) {
      // Kein 500er: Der Dialog hat denselben Satz schon per GET bekommen, nur
      // kann sich die Lage zwischen Anzeigen und Bestätigen geändert haben.
      return NextResponse.json({ error: bewertung.lage.grund ?? 'Diese Rechnung kann nicht gemahnt werden.' }, { status: 400 })
    }

    // Den Schuldnertyp merken, bevor die Mahnung entsteht: Er wird im Dialog
    // einmal erfragt und soll nie wieder erfragt werden. Gehört der Kontakt
    // nicht zur Firma, wird gar nichts angelegt.
    if (anpassungen.customerType !== null) {
      await merkeSchuldnertyp(supabase, invoice, anpassungen.customerType)
    }

    const mahnung = await erstelleMahnungMitSchreiben(
      supabase,
      // Die Nutzerkennung bestimmt den Ablageort der Datei — dieselbe
      // Ordnerstruktur wie bei den Rechnungsdokumenten.
      { companyId: invoice.company_id, userId: user.id },
      {
        invoiceId: invoice.id,
        stufe: bewertung.stufe,
        forderung: bewertung.forderung,
        // Stichtag und Mahndatum sind dasselbe: Gerechnet wurde auf heute,
        // und genau dieses Datum wird eingefroren.
        reminderDate: bewertung.stichtag,
        defaultSince: bewertung.verzugsbeginnTag,
        // Der im Dialog bearbeitete Schreibtext. Ohne Angabe gilt der Text der
        // Stufe; ein leerer String ist dagegen eine Entscheidung des Nutzers
        // und wird als solche eingefroren.
        introText: schreibtext,
      }
    )

    if (!sofortSenden) {
      return NextResponse.json({ mahnung, versendet: false }, { status: 201 })
    }

    /**
     * Erstellen und Senden in einem Zug — aber nicht als ein Schicksal.
     *
     * Scheitert der Versand, bleibt das Dokument stehen. Es ist erzeugt,
     * abgelegt und herunterladbar; die Mahnung deswegen wieder einzusammeln
     * hiesse, eine gelungene Arbeit wegen eines fremden Postfachs
     * wegzuwerfen. Der Nutzer erfährt beides — die Mahnung ist da, die E-Mail
     * ging nicht — und kann sie aus der Belegübersicht erneut senden.
     *
     * Deshalb auch 201 und kein Fehlerstatus: Angelegt wurde, was angelegt
     * werden sollte. Was fehlt, steht in `versandFehler`.
     */
    try {
      const versand = await versendeMahnung(
        supabase,
        { companyId: invoice.company_id },
        {
          reminderId: mahnung.id,
          recipientEmail: typeof body.recipientEmail === 'string' ? body.recipientEmail : null,
          subject: typeof body.emailSubject === 'string' ? body.emailSubject : undefined,
          body: typeof body.emailBody === 'string' ? body.emailBody : undefined,
        }
      )
      return NextResponse.json(
        {
          mahnung: versand.mahnung,
          versendet: true,
          empfaengerEmail: versand.empfaengerEmail,
          rechnungsStatus: versand.rechnungsStatus,
        },
        { status: 201 }
      )
    } catch (versandFehler) {
      if (!(versandFehler instanceof DunningServiceError)) {
        meldeFehler(versandFehler, { bereich: 'dunning.anlegen.versand', invoiceId: id })
      }
      return NextResponse.json(
        {
          mahnung,
          versendet: false,
          versandFehler:
            versandFehler instanceof DunningServiceError
              ? versandFehler.message
              : 'Die E-Mail konnte nicht versendet werden.',
        },
        { status: 201 }
      )
    }
  } catch (err) {
    return antwortAufFehler(err, 'dunning.anlegen', id)
  }
}

/**
 * Den Schuldnertyp am Kontakt festhalten.
 *
 * Die Bedingung `company_id` ist die eigentliche Zugriffsprüfung: Die
 * Kontakt-ID kommt zwar aus der Rechnung und nicht aus der Anfrage, aber auf
 * eine Zeile, die einer anderen Firma gehört, darf von hier aus nichts
 * geschrieben werden. Kommt keine Zeile zurück, wird mit einem Satz
 * abgebrochen, statt stillschweigend weiterzulaufen — wer hier nichts
 * speichern kann, bekäme sonst bei jeder Mahnung dieselbe Frage erneut.
 *
 * Hat die Rechnung gar keinen Kontakt (freier Empfänger im Snapshot), gibt es
 * nichts zu merken; die Angabe gilt dann nur für diese eine Mahnung.
 */
async function merkeSchuldnertyp(
  supabase: Awaited<ReturnType<typeof createClient>>,
  invoice: Invoice,
  customerType: 'business' | 'consumer'
): Promise<void> {
  if (!invoice.buyer_contact_id) return

  const { data, error } = await supabase
    .from('contacts')
    .update({ customer_type: customerType })
    .eq('id', invoice.buyer_contact_id)
    .eq('company_id', invoice.company_id)
    .select('id')

  if (error) {
    throw new DunningServiceError(500, 'SERVER_ERROR', 'Die Angabe zum Schuldner konnte nicht gespeichert werden')
  }
  if (!data || data.length === 0) {
    throw new DunningServiceError(
      403,
      'FORBIDDEN',
      'Der Kontakt dieser Rechnung gehört nicht zu Ihrer Firma; die Angabe zum Schuldner wurde nicht gespeichert.'
    )
  }
}
