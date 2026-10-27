/**
 * POST /api/paddle/webhook — Paddle notifications. Verifies the signature on the raw body, then keeps
 * the subscription status current. Secrets: PADDLE_WEBHOOK_SECRET. Binding: QUOTA (KV).
 */
import type { KVLike } from "../../_lib/core";
import { applySubscriptionUpdate, checkPaddleSignature, cleanSecret, subscriptionUpdateFromEvent } from "../../_lib/license";

interface Env {
  PADDLE_WEBHOOK_SECRET?: string;
  PADDLE_API_KEY?: string;
  PADDLE_ENV?: string;
  QUOTA?: KVLike;
}

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** Remember only the outcome of the latest delivery (never the payload) so setup can be checked from a browser. */
async function note(env: Env, result: string, type?: string, extra?: Record<string, unknown>) {
  try {
    await env.QUOTA?.put("wh:last", JSON.stringify({ at: new Date().toISOString(), result, type, ...extra }), { expirationTtl: 30 * 86400 });
  } catch {
    /* diagnostics must never break the webhook */
  }
}

export const onRequest = async ({ request, env }: { request: Request; env: Env }) => {
  if (request.method === "GET") {
    // Booleans and the last outcome only: no secrets, no event data.
    let last: unknown = null;
    try {
      last = JSON.parse((await env.QUOTA?.get("wh:last")) ?? "null");
    } catch {
      last = null;
    }
    const secret = cleanSecret(env.PADDLE_WEBHOOK_SECRET);
    const secretFormat = secret ? { prefixOk: secret.startsWith("pdl_ntfset_"), length: secret.length, hadOuterWhitespaceOrQuotes: secret !== (env.PADDLE_WEBHOOK_SECRET ?? "") } : null;
    // Is the API key the kind this environment needs? Only the kind and length are shown, never the key.
    const apiKey = cleanSecret(env.PADDLE_API_KEY);
    const kind = apiKey.startsWith("pdl_live_apikey_") ? "live" : apiKey.startsWith("pdl_sdbx_apikey_") ? "sandbox" : apiKey ? "unknown" : null;
    const wanted = env.PADDLE_ENV === "sandbox" ? "sandbox" : "live";
    const paddle = { env: env.PADDLE_ENV ?? null, expects: wanted, apiKeyKind: kind, apiKeyLength: apiKey.length, apiKeyMatchesEnv: kind === wanted };
    return reply(200, { ok: true, ready: !!(secret && env.QUOTA), secretSet: !!secret, storageBound: !!env.QUOTA, secretFormat, paddle, lastDelivery: last });
  }
  if (request.method !== "POST") return reply(405, { ok: false });
  const secret = cleanSecret(env.PADDLE_WEBHOOK_SECRET);
  if (!secret || !env.QUOTA) return reply(503, { ok: false, code: "not_configured" });

  const raw = await request.text(); // the signature covers the exact bytes Paddle sent
  if (raw.length > 500000) return reply(413, { ok: false });
  const check = await checkPaddleSignature(raw, request.headers.get("Paddle-Signature"), secret, Math.floor(Date.now() / 1000));
  if (!check.ok) {
    await note(env, "bad_signature", undefined, { reason: check.reason, skewSeconds: check.skewSeconds });
    return reply(401, { ok: false, code: "bad_signature" });
  }

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return reply(400, { ok: false });
  }
  const update = subscriptionUpdateFromEvent(event);
  const type = typeof (event as { event_type?: unknown })?.event_type === "string" ? (event as { event_type: string }).event_type : undefined;
  const outcome = update ? await applySubscriptionUpdate(env.QUOTA, update) : "ignored"; // an error here returns 500 so Paddle retries
  await note(env, outcome, type);
  return reply(200, { ok: true });
};
