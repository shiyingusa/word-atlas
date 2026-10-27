import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import type { KVLike } from "../../functions/_lib/core";
import { CLAIM_RETRY_MS, applySubscriptionUpdate, claimLicense, generateKey, isActiveStatus, lookupLicense, normalizeKey, parseSignatureHeader, subscriptionUpdateFromEvent, verifyPaddleSignature } from "../../functions/_lib/license";

function fakeKV(): KVLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, put: async (k, v) => void data.set(k, v) };
}
const bytes = (n: number) => Uint8Array.from({ length: 20 }, (_, i) => (i * 13 + n) % 256);
const sign = (secret: string, ts: number, body: string) => createHmac("sha256", secret).update(`${ts}:${body}`).digest("hex");

test("license keys have a fixed shape and survive normalization", () => {
  const k = generateKey(bytes(1));
  assert.match(k, /^WL-[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
  assert.ok(!/[01OI]/.test(k.slice(3).replace(/-/g, "")), "no look-alike characters");
  assert.equal(normalizeKey(`  ${k.toLowerCase()}  `), k);
  assert.equal(normalizeKey(k.replace(/-/g, " - ").replace(/ - /g, "-")), k);
  for (const bad of [null, 5, "", "WL-AAAAA", k.slice(0, -1), k.replace("WL-", "XX-"), k + "X"]) assert.equal(normalizeKey(bad), null);
  assert.notEqual(generateKey(bytes(1)), generateKey(bytes(2)));
  assert.throws(() => generateKey(new Uint8Array(5)));
});

test("only active and trialing subscriptions count as Pro", () => {
  assert.equal(isActiveStatus("active"), true);
  assert.equal(isActiveStatus("trialing"), true);
  for (const s of ["canceled", "paused", "past_due", "", "ACTIVE"]) assert.equal(isActiveStatus(s), false);
});

test("signature header parsing handles rotation", () => {
  assert.deepEqual(parseSignatureHeader("ts=1;h1=aa;h1=bb"), { ts: "1", sigs: ["aa", "bb"] });
  assert.equal(parseSignatureHeader(null), null);
  assert.equal(parseSignatureHeader("garbage"), null);
  assert.equal(parseSignatureHeader("ts=1"), null);
});

test("Paddle signatures: valid, tampered, wrong secret, stale, rotated", async () => {
  const body = JSON.stringify({ event_type: "subscription.activated", data: { id: "sub_01abc" } });
  const now = 1_800_000_000;
  const good = `ts=${now};h1=${sign("pdl_secret", now, body)}`;
  assert.equal(await verifyPaddleSignature(body, good, "pdl_secret", now), true);
  assert.equal(await verifyPaddleSignature(body + " ", good, "pdl_secret", now), false, "tampered body");
  assert.equal(await verifyPaddleSignature(body, good, "other_secret", now), false, "wrong secret");
  assert.equal(await verifyPaddleSignature(body, good, "pdl_secret", now + 10_000), false, "replay outside tolerance");
  assert.equal(await verifyPaddleSignature(body, `ts=${now};h1=${"0".repeat(64)};h1=${sign("pdl_secret", now, body)}`, "pdl_secret", now), true, "any h1 may match");
  assert.equal(await verifyPaddleSignature(body, null, "pdl_secret", now), false);
  assert.equal(await verifyPaddleSignature(body, `ts=abc;h1=${sign("pdl_secret", now, body)}`, "pdl_secret", now), false);
});

test("subscription events are mapped and unrelated events ignored", () => {
  const ev = { event_type: "subscription.updated", occurred_at: "2026-10-27T10:00:00Z", data: { id: "sub_1", status: "active", customer_id: "ctm_1", current_billing_period: { ends_at: "2026-11-27T10:00:00Z" }, scheduled_change: null } };
  assert.deepEqual(subscriptionUpdateFromEvent(ev), { subId: "sub_1", status: "active", ends: "2026-11-27T10:00:00Z", customer: "ctm_1", at: Date.parse("2026-10-27T10:00:00Z") });
  const cancelled = { ...ev, data: { ...ev.data, status: "canceled", current_billing_period: null, scheduled_change: { effective_at: "2026-11-01T00:00:00Z" } } };
  assert.equal(subscriptionUpdateFromEvent(cancelled)?.ends, "2026-11-01T00:00:00Z");
  assert.equal(subscriptionUpdateFromEvent({ event_type: "transaction.completed", data: { id: "txn_1" } }), null);
  assert.equal(subscriptionUpdateFromEvent({ event_type: "subscription.updated", data: { id: "notsub", status: "active" } }), null);
  assert.equal(subscriptionUpdateFromEvent(null), null);
});

test("claiming issues one key per subscription and blocks late replays", async () => {
  const kv = fakeKV();
  const base = { subId: "sub_1", customer: "ctm_1", email: "a@b.c", status: "active", ends: "2026-11-27T00:00:00Z", random: bytes(3) };
  const t0 = 1_000_000;
  const first = await claimLicense(kv, { ...base, now: t0 });
  assert.ok(first.ok && !first.reused);
  const again = await claimLicense(kv, { ...base, now: t0 + 60_000, random: bytes(9) });
  assert.ok(again.ok && again.reused);
  assert.equal(again.ok && first.ok && again.key, first.ok && first.key, "the same key is re-shown within the retry window");
  const late = await claimLicense(kv, { ...base, now: t0 + CLAIM_RETRY_MS + 1, random: bytes(9) });
  assert.deepEqual(late, { ok: false, code: "already_claimed" });
});

test("a key is active only while its subscription record points at it", async () => {
  const kv = fakeKV();
  const t0 = Date.parse("2026-10-27T10:00:00Z");
  const c = await claimLicense(kv, { subId: "sub_1", customer: "ctm_1", email: "", status: "active", ends: null, now: t0, random: bytes(4) });
  assert.ok(c.ok);
  const key = c.ok ? c.key : "";
  assert.deepEqual(await lookupLicense(kv, key), { active: true, status: "active", ends: null });

  // cancellation arrives
  assert.equal(await applySubscriptionUpdate(kv, { subId: "sub_1", status: "canceled", ends: null, customer: "ctm_1", at: t0 + 1000 }), "applied");
  assert.equal((await lookupLicense(kv, key))?.active, false);

  // an older "active" event delivered late must not revive it
  assert.equal(await applySubscriptionUpdate(kv, { subId: "sub_1", status: "active", ends: null, customer: "ctm_1", at: t0 + 500 }), "stale");
  assert.equal((await lookupLicense(kv, key))?.active, false);

  // renewal after resubscribing is a newer event
  await applySubscriptionUpdate(kv, { subId: "sub_1", status: "active", ends: null, customer: "ctm_1", at: t0 + 5000 });
  assert.equal((await lookupLicense(kv, key))?.active, true);

  // unknown keys and orphaned keys are rejected
  assert.equal(await lookupLicense(kv, "WL-AAAAA-AAAAA-AAAAA-AAAAA"), null);
  kv.data.set("sub:sub_1", JSON.stringify({ ...JSON.parse(kv.data.get("sub:sub_1")!), key: "WL-OTHER" }));
  assert.equal(await lookupLicense(kv, key), null, "a key that lost its subscription link is not valid");
});

test("a webhook that arrives before the claim does not lose the status", async () => {
  const kv = fakeKV();
  const t0 = Date.parse("2026-10-27T10:00:00Z");
  await applySubscriptionUpdate(kv, { subId: "sub_9", status: "active", ends: "2026-11-27T10:00:00Z", customer: "ctm_9", at: t0 });
  const c = await claimLicense(kv, { subId: "sub_9", customer: "ctm_9", email: "x@y.z", status: "active", ends: "2026-11-27T10:00:00Z", now: t0 + 2000, random: bytes(7) });
  assert.ok(c.ok);
  assert.equal((await lookupLicense(kv, c.ok ? c.key : ""))?.active, true);
});
