import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, test } from "node:test";
import type { KVLike } from "../../functions/_lib/core";
import { onRequest as claim } from "../../functions/api/license/claim";
import { onRequest as status } from "../../functions/api/license/status";
import { onRequest as grade } from "../../functions/api/grade";
import { onRequest as webhook } from "../../functions/api/paddle/webhook";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function fakeKV(): KVLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, put: async (k, v) => void data.set(k, v) };
}
const TXN = "txn_01abcdefghijklmnopqrstuvwx";
const SUB = "sub_01abcdefghijklmnopqrstuvwx";
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const modelOut = { criteria: { TR: { score: 6, comment: "好" }, CC: { score: 6, comment: "好" }, LR: { score: 6, comment: "好" }, GRA: { score: 6, comment: "好" } }, strengths: ["a"], fixes: [{ original: "x y", better: "x z", why: "因为" }], next_steps: ["b"] };

type Paddle = { txnStatus?: string; subId?: string | null; subStatus?: string; fail?: number };
function mockNetwork(p: Paddle = {}) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    calls.push(u);
    if (u.startsWith("https://api.deepseek.com")) return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelOut) } }] }), { status: 200 });
    if (p.fail) return new Response("no", { status: p.fail });
    if (u.includes("/transactions/")) return new Response(JSON.stringify({ data: { id: TXN, status: p.txnStatus ?? "completed", subscription_id: p.subId === undefined ? SUB : p.subId, customer_id: "ctm_01abc" } }), { status: 200 });
    if (u.includes("/subscriptions/")) return new Response(JSON.stringify({ data: { id: SUB, status: p.subStatus ?? "active", current_billing_period: { ends_at: "2026-11-27T10:00:00Z" } } }), { status: 200 });
    if (u.includes("/customers/")) return new Response(JSON.stringify({ data: { email: "buyer@example.com" } }), { status: 200 });
    return new Response("?", { status: 404 });
  }) as typeof fetch;
  return calls;
}
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://wordlamp.net${path}`, { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.2.3.4", ...headers }, body: JSON.stringify(body) });
const run = async (fn: (c: { request: Request; env: never }) => Promise<Response>, req: Request, env: unknown) => {
  const res = await fn({ request: req, env: env as never });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};

test("claim: pays, confirms with Paddle, issues a key that unlocks Pro", async () => {
  const kv = fakeKV();
  const calls = mockNetwork();
  const env = { PADDLE_API_KEY: "pdl_key", PADDLE_ENV: "sandbox", QUOTA: kv, DEEPSEEK_API_KEY: "sk" };

  let r = await run(claim, post("/api/license/claim", { transactionId: TXN }), env);
  assert.equal(r.status, 200);
  assert.match(r.body.key, /^WL-/);
  assert.equal(r.body.active, true);
  assert.ok(calls.every((u) => u.startsWith("https://sandbox-api.paddle.com") || u.startsWith("https://api.deepseek.com")), "sandbox uses the sandbox API");
  const key = r.body.key as string;
  assert.ok(![...kv.data.values()].some((v) => v.includes("1.2.3.4")), "no raw IP stored");

  // same browser retries: same key
  r = await run(claim, post("/api/license/claim", { transactionId: TXN }), env);
  assert.equal(r.body.key, key);

  // status endpoint
  r = await run(status, post("/api/license/status", { key: key.toLowerCase() }), env);
  assert.deepEqual([r.status, r.body.active, r.body.key], [200, true, key]);
  r = await run(status, post("/api/license/status", { key: "WL-AAAAA-AAAAA-AAAAA-AAAAA" }), env);
  assert.equal(r.status, 404);

  // grading: pro limit of 15, free users still limited to 2
  const essay = { essay: words(150), consent: true };
  for (let i = 1; i <= 15; i++) {
    r = await run(grade, post("/api/grade", { ...essay, license: key }), env);
    assert.equal(r.status, 200, `pro call ${i}`);
    assert.equal(r.body.plan, "pro");
    assert.equal(r.body.remaining, 15 - i);
  }
  r = await run(grade, post("/api/grade", { ...essay, license: key }), env);
  assert.deepEqual([r.status, r.body.code], [429, "daily_limit"]);

  r = await run(grade, post("/api/grade", essay, { "CF-Connecting-IP": "9.9.9.9" }), env);
  assert.deepEqual([r.status, r.body.plan, r.body.limit], [200, "free", 2]);
  r = await run(grade, post("/api/grade", { ...essay, license: "WL-AAAAA-AAAAA-AAAAA-AAAAA" }, { "CF-Connecting-IP": "8.8.8.8" }), env);
  assert.deepEqual([r.status, r.body.plan, r.body.license], [200, "free", "unknown"]);
});

test("claim: unpaid, malformed, foreign-origin and upstream-failure cases", async () => {
  const kv = fakeKV();
  const env = { PADDLE_API_KEY: "pdl_key", PADDLE_ENV: "production", QUOTA: kv };
  mockNetwork({ txnStatus: "draft" });
  let r = await run(claim, post("/api/license/claim", { transactionId: TXN }), env);
  assert.deepEqual([r.status, r.body.code], [409, "pending"]);
  mockNetwork({ subId: null });
  r = await run(claim, post("/api/license/claim", { transactionId: TXN }), env);
  assert.deepEqual([r.status, r.body.code], [409, "pending"]);
  r = await run(claim, post("/api/license/claim", { transactionId: "../../etc" }), env);
  assert.equal(r.status, 400);
  r = await run(claim, post("/api/license/claim", { transactionId: TXN }, { Origin: "https://evil.example" }), env);
  assert.equal(r.status, 403);
  r = await run(claim, post("/api/license/claim", { transactionId: TXN }), { QUOTA: kv });
  assert.equal(r.status, 503);
  mockNetwork({ fail: 500 });
  r = await run(claim, post("/api/license/claim", { transactionId: TXN }), env);
  assert.deepEqual([r.status, r.body.code], [502, "upstream"]);
  assert.equal([...kv.data.keys()].filter((k) => k.startsWith("lic:")).length, 0, "no key is issued when Paddle cannot confirm");
});

test("webhook: rejects bad signatures, applies cancellations, deactivates the key", async () => {
  const kv = fakeKV();
  mockNetwork();
  const env = { PADDLE_API_KEY: "pdl_key", PADDLE_ENV: "sandbox", PADDLE_WEBHOOK_SECRET: "pdl_ntfset_secret", QUOTA: kv, DEEPSEEK_API_KEY: "sk" };
  const key = (await run(claim, post("/api/license/claim", { transactionId: TXN }), env)).body.key as string;

  const send = (event: object, secret = "pdl_ntfset_secret", ts = Math.floor(Date.now() / 1000)) => {
    const raw = JSON.stringify(event);
    const sig = createHmac("sha256", secret).update(`${ts}:${raw}`).digest("hex");
    return run(webhook, new Request("https://wordlamp.net/api/paddle/webhook", { method: "POST", headers: { "Paddle-Signature": `ts=${ts};h1=${sig}` }, body: raw }), env);
  };
  const cancel = { event_type: "subscription.canceled", occurred_at: new Date(Date.now() + 60_000).toISOString(), data: { id: SUB, status: "canceled", customer_id: "ctm_01abc", current_billing_period: null, scheduled_change: null } };

  assert.equal((await send(cancel, "wrong_secret")).status, 401);
  assert.equal((await run(status, post("/api/license/status", { key }), env)).body.active, true, "forged webhook changed nothing");
  assert.equal((await send(cancel, "pdl_ntfset_secret", Math.floor(Date.now() / 1000) - 3600)).status, 401, "stale timestamp");

  assert.equal((await send(cancel)).status, 200);
  assert.equal((await run(status, post("/api/license/status", { key }), env)).body.active, false);
  const essay = { essay: words(150), consent: true };
  const r = await run(grade, post("/api/grade", { ...essay, license: key }), env);
  assert.deepEqual([r.status, r.body.plan, r.body.license], [200, "free", "inactive"], "a cancelled key falls back to the free allowance");

  assert.equal((await send({ event_type: "transaction.completed", data: { id: TXN } })).status, 200, "unrelated events are acknowledged");
  const noSecret = await run(webhook, new Request("https://wordlamp.net/api/paddle/webhook", { method: "POST", body: "{}" }), { QUOTA: kv });
  assert.equal(noSecret.status, 503);
});

test("lost webhook: the status endpoint and grading notice a cancellation by asking Paddle", async () => {
  const kv = fakeKV();
  mockNetwork();
  const env = { PADDLE_API_KEY: "pdl_key", PADDLE_ENV: "sandbox", QUOTA: kv, DEEPSEEK_API_KEY: "sk" };
  const key = (await run(claim, post("/api/license/claim", { transactionId: TXN }), env)).body.key as string;
  assert.equal((await run(status, post("/api/license/status", { key }), env)).body.active, true);

  // 7 hours pass, the cancellation webhook never arrived, but Paddle now says canceled
  const rec = JSON.parse(kv.data.get(`own:${SUB}`)!);
  const back = 7 * 3600 * 1000;
  kv.data.set(`own:${SUB}`, JSON.stringify({ ...rec, claimedAt: rec.claimedAt - back }));
  mockNetwork({ subStatus: "canceled" });

  const r = await run(status, post("/api/license/status", { key }), env);
  assert.deepEqual([r.status, r.body.active, r.body.status], [200, false, "canceled"]);
  const g = await run(grade, post("/api/grade", { essay: words(150), consent: true, license: key }), env);
  assert.deepEqual([g.status, g.body.plan, g.body.license], [200, "free", "inactive"]);
});

test("webhook health check shows configuration and the last delivery, nothing secret", async () => {
  const kv = fakeKV();
  mockNetwork();
  const env = { PADDLE_API_KEY: "k", PADDLE_ENV: "sandbox", PADDLE_WEBHOOK_SECRET: "pdl_ntfset_topsecret", QUOTA: kv };
  const getHealth = (e: unknown) => run(webhook, new Request("https://wordlamp.net/api/paddle/webhook"), e);
  let r = await getHealth(env);
  assert.deepEqual([r.status, r.body.ready, r.body.lastDelivery], [200, true, null]);
  assert.ok(!JSON.stringify(r.body).includes("topsecret"), "the secret is never echoed");
  assert.equal((await getHealth({ QUOTA: kv })).body.ready, false);

  const send = (secret: string, event: object) => {
    const raw = JSON.stringify(event);
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", secret).update(`${ts}:${raw}`).digest("hex");
    return run(webhook, new Request("https://wordlamp.net/api/paddle/webhook", { method: "POST", headers: { "Paddle-Signature": `ts=${ts};h1=${sig}` }, body: raw }), env);
  };
  await send("wrong", { event_type: "subscription.canceled", data: { id: SUB, status: "canceled" } });
  r = await getHealth(env);
  assert.equal(r.body.lastDelivery.result, "bad_signature");
  await send("pdl_ntfset_topsecret", { event_type: "subscription.canceled", occurred_at: new Date().toISOString(), data: { id: SUB, status: "canceled" } });
  r = await getHealth(env);
  assert.deepEqual([r.body.lastDelivery.result, r.body.lastDelivery.type], ["applied", "subscription.canceled"]);
  await send("pdl_ntfset_topsecret", { event_type: "transaction.completed", data: { id: TXN } });
  assert.equal((await getHealth(env)).body.lastDelivery.result, "ignored");
});

test("a secret pasted with a trailing line break still verifies, and the health check reports the format and the reason for failures", async () => {
  const kv = fakeKV();
  mockNetwork();
  const env = { PADDLE_API_KEY: "k", PADDLE_ENV: "sandbox", PADDLE_WEBHOOK_SECRET: "pdl_ntfset_abc123\n", QUOTA: kv };
  const health = () => run(webhook, new Request("https://wordlamp.net/api/paddle/webhook"), env);
  let r = await health();
  assert.deepEqual(r.body.secretFormat, { prefixOk: true, length: 17, hadOuterWhitespaceOrQuotes: true });
  assert.ok(!JSON.stringify(r.body).includes("abc123"), "no part of the secret is shown");

  const send = (secret: string, ts: number) => {
    const raw = JSON.stringify({ event_type: "subscription.updated", occurred_at: new Date().toISOString(), data: { id: SUB, status: "active" } });
    const sig = createHmac("sha256", secret).update(`${ts}:${raw}`).digest("hex");
    return run(webhook, new Request("https://wordlamp.net/api/paddle/webhook", { method: "POST", headers: { "Paddle-Signature": `ts=${ts};h1=${sig}` }, body: raw }), env);
  };
  const now = Math.floor(Date.now() / 1000);
  assert.equal((await send("pdl_ntfset_abc123", now)).status, 200, "the cleaned secret matches");
  assert.equal((await health()).body.lastDelivery.result, "applied");
  assert.equal((await send("pdl_ntfset_WRONG", now)).status, 401);
  r = await health();
  assert.deepEqual([r.body.lastDelivery.result, r.body.lastDelivery.reason], ["bad_signature", "mismatch"]);
  assert.equal((await send("pdl_ntfset_abc123", now - 4000)).status, 401);
  r = await health();
  assert.deepEqual([r.body.lastDelivery.reason, r.body.lastDelivery.skewSeconds], ["timestamp_out_of_range", 4000]);
});

test("the health check says whether the API key matches the Paddle environment, without showing the key", async () => {
  const kv = fakeKV();
  const health = (env: object) => run(webhook, new Request("https://wordlamp.net/api/paddle/webhook"), env);
  const live = "pdl_live_apikey_01abcdefghij_secretsecretsecret";
  const sbx = "pdl_sdbx_apikey_01abcdefghij_secretsecretsecret";
  let r = await health({ QUOTA: kv, PADDLE_ENV: "production", PADDLE_API_KEY: live });
  assert.deepEqual([r.body.paddle.env, r.body.paddle.apiKeyKind, r.body.paddle.apiKeyMatchesEnv], ["production", "live", true]);
  assert.ok(!JSON.stringify(r.body).includes("secretsecret"), "the key is never echoed");
  r = await health({ QUOTA: kv, PADDLE_ENV: "production", PADDLE_API_KEY: sbx });
  assert.deepEqual([r.body.paddle.apiKeyKind, r.body.paddle.apiKeyMatchesEnv], ["sandbox", false], "a sandbox key with the live environment is flagged");
  r = await health({ QUOTA: kv, PADDLE_ENV: "sandbox", PADDLE_API_KEY: sbx + "\n" });
  assert.equal(r.body.paddle.apiKeyMatchesEnv, true, "a pasted line break does not matter");
  r = await health({ QUOTA: kv, PADDLE_ENV: "production", PADDLE_API_KEY: "apikey_nonsense" });
  assert.deepEqual([r.body.paddle.apiKeyKind, r.body.paddle.apiKeyMatchesEnv], ["unknown", false]);
  r = await health({ QUOTA: kv });
  assert.deepEqual([r.body.paddle.apiKeyKind, r.body.paddle.apiKeyMatchesEnv], [null, false]);
});
