import { test } from "node:test";
import assert from "node:assert/strict";
import { nextStatusAfterSend } from "../lib/invoice-service";

/**
 * Statusentscheidung beim Rechnungsversand.
 *
 * Hintergrund: sendInvoice hat den Status früher pauschal auf 'sent' gesetzt.
 * Ein erneuter Versand hat damit eine gemahnte Rechnung auf "Versendet"
 * zurückgeworfen — und ebenso eine bezahlte oder stornierte. Der Versand darf
 * den Lebenszyklus nur vorwärts bewegen.
 */

/** Alle Werte des CHECK-Constraints aus supabase/migrations/010. */
const ALL_STATUSES = ["draft", "created", "sent", "reminded", "paid", "cancelled"] as const;

test("finalisierte, noch nie versendete Rechnung wird auf 'sent' gesetzt", () => {
  assert.equal(nextStatusAfterSend("created"), "sent");
});

test("gemahnte Rechnung fällt beim erneuten Versand nicht auf 'sent' zurück", () => {
  // Der eigentliche Fehler: Mahnstufe darf durch einen zweiten Versand des
  // identischen Dokuments nicht verloren gehen.
  assert.equal(nextStatusAfterSend("reminded"), null);
});

test("bezahlte und stornierte Rechnungen bleiben unangetastet", () => {
  // Eine Rechnung noch einmal zur Dokumentation zu verschicken macht sie weder
  // wieder offen noch hebt es ein Storno auf.
  assert.equal(nextStatusAfterSend("paid"), null);
  assert.equal(nextStatusAfterSend("cancelled"), null);
});

test("erneuter Versand einer versendeten Rechnung ändert nichts", () => {
  // Kein Status-Schreibvorgang, wo es nichts zu ändern gibt.
  assert.equal(nextStatusAfterSend("sent"), null);
});

test("nur 'created' löst überhaupt einen Statuswechsel aus", () => {
  // Deckt die Statusliste des Schemas vollständig ab: kommt ein neuer Status
  // dazu, fällt hier auf, dass die Versand-Regel dafür entschieden werden muss.
  const changing = ALL_STATUSES.filter((s) => nextStatusAfterSend(s) !== null);
  assert.deepEqual(changing, ["created"]);
});
