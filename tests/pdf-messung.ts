import { PDFDocument, PDFArray, PDFPage, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { createHash } from "node:crypto";

/**
 * Messapparat für erzeugte PDFs.
 *
 * Ein PDF lässt sich nicht ansehen, also wird es gemessen. Zwei Werkzeuge:
 *
 *  1. {@link miss} — Seiten, Zeichenoperationen und ein Hash je Seite, aus dem
 *     entpackten Inhaltsstrom. Dieselbe Technik, mit der
 *     `tests/pdf-charakterisierung-faelle.ts` das Rechnungs-PDF festhält; die
 *     Begründung steht dort ausführlich. Kurz: die Dateibytes tragen
 *     Zeitstempel und taugen nicht, der Inhaltsstrom ist reproduzierbar, weil
 *     pdf-lib seine Ressourcennamen aus einem gesetzten PRNG zieht.
 *
 *     Bewusst hier noch einmal und nicht aus der Charakterisierungsdatei
 *     importiert: Die hält das Rechnungs-PDF fest und soll für diesen Zweck
 *     nicht angefasst werden.
 *
 *  2. {@link protokolliereTexte} — jede gezeichnete Zeichenkette samt Seite
 *     und Grundlinie. Der Inhaltsstrom hilft hier nicht: Die Schriften werden
 *     als Teilmenge eingebettet, der Text steht deshalb als Folge von
 *     Glyphennummern in der Datei und ist nicht lesbar. Deshalb wird
 *     `PDFPage.drawText` für die Dauer eines Laufs mitgeschrieben — das misst
 *     genau das, was auf dem Blatt landet, und nichts daneben.
 */

/** Der festgehaltene Zustand eines erzeugten PDFs. */
export interface Messung {
  seiten: number;
  /** Alle Operatoren im Inhaltsstrom, je Seite. */
  operationen: number[];
  /** Nur die textzeichnenden Tj-Operationen, je Seite — entspricht Zeilen. */
  textzeilen: number[];
  /** SHA-256 des normalisierten Inhaltsstroms, je Seite, auf 16 Hex gekürzt. */
  hashes: string[];
}

async function inhaltsstroeme(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((seite) => {
    const contents = (seite.node as unknown as { Contents(): unknown }).Contents();
    const stroeme =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => doc.context.lookup(ref))
        : [contents];
    return stroeme
      .map((strom) =>
        Buffer.from(decodePDFRawStream(strom as PDFRawStream).decode()).toString("latin1")
      )
      .join("\n");
  });
}

function normalisiere(strom: string): string {
  return strom
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((zeile) => zeile.replace(/\s+$/, ""))
    .filter((zeile) => zeile.length > 0)
    .join("\n");
}

/** pdf-lib schreibt genau einen Operator je Zeile, und der steht am Zeilenende. */
function operatoren(strom: string): string[] {
  return normalisiere(strom)
    .split("\n")
    .map((zeile) => zeile.split(" ").pop() ?? "");
}

export async function miss(bytes: Uint8Array): Promise<Messung> {
  const stroeme = await inhaltsstroeme(bytes);
  return {
    seiten: stroeme.length,
    operationen: stroeme.map((s) => operatoren(s).length),
    textzeilen: stroeme.map((s) => operatoren(s).filter((op) => op === "Tj").length),
    hashes: stroeme.map((s) =>
      createHash("sha256").update(normalisiere(s), "latin1").digest("hex").slice(0, 16)
    ),
  };
}

/** Eine gezeichnete Zeichenkette mit ihrem Platz auf dem Blatt. */
export interface GezeichneterText {
  /** 1-basiert, in der Reihenfolge, in der die Seiten bezeichnet wurden. */
  seite: number;
  text: string;
  x: number;
  y: number;
}

/**
 * Führt `erzeuge` aus und schreibt dabei jeden `drawText`-Aufruf mit.
 *
 * Die Seitennummer entsteht aus der Reihenfolge, in der Seitenobjekte zum
 * ersten Mal bezeichnet werden — das ist genau die Reihenfolge, in der der
 * Generator sie anlegt.
 */
export async function protokolliereTexte(
  erzeuge: () => Promise<Uint8Array>
): Promise<{ bytes: Uint8Array; texte: GezeichneterText[] }> {
  const texte: GezeichneterText[] = [];
  const seiten: PDFPage[] = [];
  const original = PDFPage.prototype.drawText;

  PDFPage.prototype.drawText = function (
    this: PDFPage,
    text: string,
    options?: { x?: number; y?: number }
  ) {
    if (!seiten.includes(this)) seiten.push(this);
    texte.push({
      seite: seiten.indexOf(this) + 1,
      text,
      x: options?.x ?? 0,
      y: options?.y ?? 0,
    });
    return original.call(this, text, options as never);
  } as typeof PDFPage.prototype.drawText;

  try {
    const bytes = await erzeuge();
    return { bytes, texte };
  } finally {
    PDFPage.prototype.drawText = original;
  }
}
