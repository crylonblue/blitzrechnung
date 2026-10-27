import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { extractKeyFromUrl } from "../lib/s3";

/**
 * Aus der gespeicherten Datei-URL zurück zum S3-Key.
 *
 * `buildPublicUrl` baut die URL beim Hochladen, `extractKeyFromUrl` nimmt sie
 * beim Herunterladen wieder auseinander — die beiden müssen zueinander passen,
 * sonst findet `downloadFromS3` die Datei nicht, die eben noch hochgeladen wurde.
 */

const KEY = "invoices/user-1/inv-1/RE-0001.pdf";
const alt = process.env.S3_PUBLIC_URL;
afterEach(() => {
  if (alt === undefined) delete process.env.S3_PUBLIC_URL;
  else process.env.S3_PUBLIC_URL = alt;
});

test("CDN-Domain ohne Pfad: der ganze Pfad ist der Key", () => {
  process.env.S3_PUBLIC_URL = "https://cdn.example.de";
  assert.equal(extractKeyFromUrl(`https://cdn.example.de/${KEY}`, "bucket"), KEY);
});

test("öffentliche URL mit Pfad (lokaler Storage): der Pfad gehört nicht zum Key", () => {
  process.env.S3_PUBLIC_URL = "http://127.0.0.1:55321/storage/v1/object/public/blitzrechnung";
  assert.equal(
    extractKeyFromUrl(`http://127.0.0.1:55321/storage/v1/object/public/blitzrechnung/${KEY}`, "blitzrechnung"),
    KEY
  );
});

test("Key-Präfix (S3_PATH_PREFIX) bleibt Teil des Keys", () => {
  process.env.S3_PUBLIC_URL = "http://127.0.0.1:55321/storage/v1/object/public/blitzrechnung";
  assert.equal(
    extractKeyFromUrl(`http://127.0.0.1:55321/storage/v1/object/public/blitzrechnung/app/${KEY}`, "blitzrechnung"),
    `app/${KEY}`
  );
});

test("Endpoint-URL ohne S3_PUBLIC_URL: der Bucket vorn wird abgezogen", () => {
  delete process.env.S3_PUBLIC_URL;
  assert.equal(extractKeyFromUrl(`https://acc.r2.cloudflarestorage.com/bucket/${KEY}`, "bucket"), KEY);
});

test("kein URL-Format: wird als Key genommen", () => {
  assert.equal(extractKeyFromUrl(KEY, "bucket"), KEY);
});
