import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canAccessInvoice,
  canManageDepartmentMembers,
  canManageTeam,
  readableDepartmentIds,
  writableDepartmentIds,
  type CompanyRole,
  type InvoiceScope,
} from "../lib/access";

/**
 * Rechte-Matrix (Migration 043). Dieselben Fälle gelten in den RLS-Policies;
 * wer eine Seite ändert, ändert die andere.
 */

const EIGENE = "dep-eigen";
const FREMDE = "dep-fremd";

function scope(role: CompanyRole, departmentIds: string[] = [], managed: string[] = []): InvoiceScope {
  return { role, departmentIds, managedDepartmentIds: managed };
}

test("owner und admin sehen und ändern Rechnungen jeder Abteilung", () => {
  for (const role of ["owner", "admin"] as const) {
    assert.equal(canAccessInvoice(scope(role), FREMDE, "read"), true);
    assert.equal(canAccessInvoice(scope(role), FREMDE, "write"), true);
  }
});

test("ohne Abteilung ist auch für owner nichts schreibbar", () => {
  assert.equal(canAccessInvoice(scope("owner"), null, "write"), false);
});

test("accountant sieht alles, ändert nichts", () => {
  const s = scope("accountant");
  assert.equal(canAccessInvoice(s, FREMDE, "read"), true);
  assert.equal(canAccessInvoice(s, FREMDE, "write"), false);
  assert.deepEqual(writableDepartmentIds(s), []);
  assert.equal(readableDepartmentIds(s), null);
});

test("member sieht und ändert nur die eigene Abteilung", () => {
  const s = scope("member", [EIGENE]);
  assert.equal(canAccessInvoice(s, EIGENE, "read"), true);
  assert.equal(canAccessInvoice(s, EIGENE, "write"), true);
  assert.equal(canAccessInvoice(s, FREMDE, "read"), false);
  assert.equal(canAccessInvoice(s, FREMDE, "write"), false);
  assert.deepEqual(readableDepartmentIds(s), [EIGENE]);
  assert.deepEqual(writableDepartmentIds(s), [EIGENE]);
});

test("member ohne Abteilung sieht keine Rechnung", () => {
  const s = scope("member");
  assert.equal(canAccessInvoice(s, EIGENE, "read"), false);
  assert.equal(canAccessInvoice(s, null, "read"), false);
  assert.deepEqual(readableDepartmentIds(s), []);
});

test("Abteilungs-Manager verwaltet nur die eigene Abteilung", () => {
  const s = scope("member", [EIGENE, "dep-b"], [EIGENE]);
  assert.equal(canManageDepartmentMembers(s, EIGENE), true);
  assert.equal(canManageDepartmentMembers(s, "dep-b"), false);
  assert.equal(canManageDepartmentMembers(s, FREMDE), false);
  assert.equal(canManageTeam(s.role), false);
});

test("owner und admin verwalten Team und jede Abteilung", () => {
  assert.equal(canManageTeam("owner"), true);
  assert.equal(canManageTeam("admin"), true);
  assert.equal(canManageTeam("accountant"), false);
  assert.equal(canManageDepartmentMembers(scope("admin"), FREMDE), true);
});
