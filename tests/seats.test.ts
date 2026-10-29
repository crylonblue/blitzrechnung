import { test } from "node:test";
import assert from "node:assert/strict";
import { syncSeats } from "../lib/seats";

/**
 * Plätze — die Menge am Stripe-Abo folgt der Mitgliederzahl, bei Monats- wie
 * bei Jahrestarif. Mehr Plätze werden sofort berechnet, weniger gutgeschrieben.
 */

function db(members: number, subscriptionId: string | null = "sub_1") {
  return {
    from(table: string) {
      if (table === "subscriptions") {
        const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: subscriptionId ? { stripe_subscription_id: subscriptionId } : null }) };
        return q;
      }
      const q: any = { select: () => q, eq: async () => ({ count: members, error: null }) };
      return q;
    },
  } as any;
}

function stripe(status: string, quantity: number, interval: "month" | "year") {
  const calls: any[] = [];
  return {
    calls,
    subscriptions: {
      retrieve: async () => ({ id: "sub_1", status, items: { data: [{ id: "si_1", quantity, price: { recurring: { interval } } }] } }),
      update: async (...args: any[]) => void calls.push(args),
    },
  } as any;
}

for (const interval of ["month", "year"] as const) {
  test(`mehr Plätze werden sofort berechnet (${interval})`, async () => {
    const s = stripe("active", 2, interval);
    assert.equal(await syncSeats(db(4), s, "c1"), 4);
    assert.deepEqual(s.calls, [["sub_1", { items: [{ id: "si_1", quantity: 4 }], proration_behavior: "always_invoice" }]]);
  });

  test(`weniger Plätze schreiben gut (${interval})`, async () => {
    const s = stripe("active", 4, interval);
    await syncSeats(db(3), s, "c1");
    assert.equal(s.calls[0][1].proration_behavior, "create_prorations");
    assert.equal(s.calls[0][1].items[0].quantity, 3);
  });
}

test("gleiche Menge: kein Aufruf an Stripe", async () => {
  const s = stripe("active", 3, "month");
  assert.equal(await syncSeats(db(3), s, "c1"), 3);
  assert.equal(s.calls.length, 0);
});

test("ohne Abo oder bei beendetem Abo: nichts zu tun", async () => {
  assert.equal(await syncSeats(db(3, null), stripe("active", 1, "month"), "c1"), null);
  const s = stripe("canceled", 1, "month");
  assert.equal(await syncSeats(db(3), s, "c1"), null);
  assert.equal(s.calls.length, 0);
});
