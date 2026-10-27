/**
 * POST /api/paddle/webhook — Paddle notifications. Verifies the signature on the raw body, then keeps
 * the subscription status current. Secrets: PADDLE_WEBHOOK_SECRET. Binding: QUOTA (KV).
 */
import type { KVLike } from "../../_lib/core";
import { applySubscriptionUpdate, subscriptionUpdateFromEvent, verifyPaddleSignature } from "../../_lib/license";

interface Env {
  PADDLE_WEBHOOK_SECRET?: string;
  QUOTA?: KVLike;
}

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const onRequest = async ({ request, env }: { request: Request; env: Env }) => {
  if (request.method !== "POST") return reply(405, { ok: false });
  if (!env.PADDLE_WEBHOOK_SECRET || !env.QUOTA) return reply(503, { ok: false, code: "not_configured" });

  const raw = await request.text(); // the signature covers the exact bytes Paddle sent
  if (raw.length > 500000) return reply(413, { ok: false });
  const valid = await verifyPaddleSignature(raw, request.headers.get("Paddle-Signature"), env.PADDLE_WEBHOOK_SECRET, Math.floor(Date.now() / 1000));
  if (!valid) return reply(401, { ok: false, code: "bad_signature" });

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return reply(400, { ok: false });
  }
  const update = subscriptionUpdateFromEvent(event);
  if (update) await applySubscriptionUpdate(env.QUOTA, update); // an error here returns 500 so Paddle retries
  return reply(200, { ok: true });
};
