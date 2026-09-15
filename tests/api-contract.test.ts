import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { GET as openapiRoute } from "../app/api/v1/openapi.json/route";

/**
 * Die OpenAPI-Spec gegen die tatsächlich vorhandenen Routen.
 *
 * Die Spec wird von Hand gepflegt und ist das, womit Kunden ihre Integration
 * bauen. Sie läuft deshalb zwangsläufig aus dem Ruder, sobald jemand eine
 * Route hinzufügt und die Dokumentation vergisst — was genau einmal passiert
 * ist: /invoices/{id}/cancel existierte, ohne dokumentiert zu sein.
 *
 * Dieser Test vergleicht beide Richtungen, damit das nicht unbemerkt bleibt.
 */

const API_ROOT = join(process.cwd(), "app/api/v1");

/** Sammelt alle Routen unterhalb von app/api/v1 im OpenAPI-Pfadformat. */
function routesOnDisk(dir = API_ROOT, prefix = ""): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (entry === "route.ts") {
      // Die Wurzel selbst ist kein Pfad, und _lib/ ist interner Code.
      if (prefix) found.push(prefix);
      continue;
    }
    if (!statSync(full).isDirectory()) continue;
    if (entry.startsWith("_")) continue;
    // openapi.json beschreibt die Spec, ist aber selbst kein Teil von ihr.
    if (entry === "openapi.json") continue;

    // Next.js' [id] entspricht OpenAPIs {id}.
    const segment = entry.replace(/^\[(.+)\]$/, "{$1}");
    found.push(...routesOnDisk(full, `${prefix}/${segment}`));
  }

  return found;
}

async function specPaths(): Promise<string[]> {
  const spec = await (await openapiRoute()).json();
  return Object.keys(spec.paths);
}

test("jeder dokumentierte Pfad existiert auch als Route", async () => {
  const onDisk = new Set(routesOnDisk());
  const undokumentiert = (await specPaths()).filter((p) => !onDisk.has(p));

  assert.deepEqual(
    undokumentiert,
    [],
    `Diese Pfade stehen in der Spec, es gibt sie aber nicht: ${undokumentiert.join(", ")}`
  );
});

test("jede Route ist auch dokumentiert", async () => {
  const documented = new Set(await specPaths());
  const fehlend = routesOnDisk().filter((p) => !documented.has(p));

  assert.deepEqual(
    fehlend,
    [],
    `Diese Routen existieren, fehlen aber in der OpenAPI-Spec: ${fehlend.join(", ")}`
  );
});

test("die Spec ist gültiges OpenAPI 3 mit Bearer-Auth", async () => {
  const spec = await (await openapiRoute()).json();

  assert.match(spec.openapi, /^3\./, "OpenAPI-Version muss 3.x sein");
  assert.ok(spec.info?.title, "info.title fehlt");
  assert.ok(spec.info?.version, "info.version fehlt");

  // Kunden generieren daraus ihre Clients — ohne Sicherheitsschema schicken die
  // Generate-Tools keinen Authorization-Header mit.
  const schemes = spec.components?.securitySchemes ?? {};
  const bearer = Object.values(schemes).find(
    (s) => (s as { type?: string; scheme?: string }).type === "http" &&
           (s as { scheme?: string }).scheme === "bearer"
  );
  assert.ok(bearer, "Es fehlt ein http/bearer-Sicherheitsschema");
});

test("jede dokumentierte Operation hat eine Beschreibung und Antworten", async () => {
  const spec = await (await openapiRoute()).json();
  const maengel: string[] = [];

  for (const [path, item] of Object.entries<Record<string, unknown>>(spec.paths)) {
    for (const [method, op] of Object.entries(item)) {
      const operation = op as { summary?: string; responses?: Record<string, unknown> };
      if (!operation.summary) maengel.push(`${method.toUpperCase()} ${path}: summary fehlt`);
      if (!operation.responses || Object.keys(operation.responses).length === 0) {
        maengel.push(`${method.toUpperCase()} ${path}: responses fehlen`);
      }
    }
  }

  assert.deepEqual(maengel, [], maengel.join("\n"));
});
