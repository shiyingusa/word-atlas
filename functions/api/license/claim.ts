/**
 * POST /api/license/claim { transactionId } — called by the pricing page right after a checkout completes.
 * Confirms the transaction with Paddle, then issues (or re-shows, for 15 minutes) the license key.
 * Secrets: PADDLE_API_KEY. Vars: PADDLE_ENV ("sandbox" | "production"). Binding: QUOTA (KV).
 */
import { dayKey } from "../../_lib/core";
import type { KVLike } from "../../_lib/core";
import { PaddleError, bump, claimLicense, isActiveStatus, paddleBase, paddleGet, sha256Hex } from "../../_lib/license";

interface Env {
  PADDLE_API_KEY?: string;
  PADDLE_ENV?: string;
  QUOTA?: KVLike;
  IP_SALT?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
const fail = (status: number, error: string, code: string) => json({ ok: false, error, code }, status);

export const onRequest = async ({ request, env }: { request: Request; env: Env }) => {
  if (request.method !== "POST") return fail(405, "不支持这种请求。", "method");
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return fail(403, "来源不被允许。", "origin");
  if (!env.PADDLE_API_KEY || !env.QUOTA) return fail(503, "服务还没有配置好。", "not_configured");

  const raw = await request.text();
  if (raw.length > 2000) return fail(413, "内容太长。", "too_large");
  let transactionId = "";
  try {
    transactionId = String((JSON.parse(raw) as { transactionId?: unknown }).transactionId ?? "");
  } catch {
    return fail(400, "请求格式不正确。", "bad_request");
  }
  if (!/^txn_[a-z0-9]{20,40}$/.test(transactionId)) return fail(400, "交易编号格式不正确。", "bad_request");

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const who = await sha256Hex(`${ip}|${env.IP_SALT ?? "wordlamp"}`);
  if (!(await bump(env.QUOTA, `rl:claim:${dayKey()}:${who}`, 40))) return fail(429, "尝试次数太多，请稍后再试。", "rate_limited");

  const base = paddleBase(env.PADDLE_ENV);
  try {
    const txn = (await paddleGet(base, env.PADDLE_API_KEY, `/transactions/${transactionId}`)).data ?? {};
    const status = String(txn.status ?? "");
    const subId = typeof txn.subscription_id === "string" ? txn.subscription_id : "";
    if (status !== "completed" && status !== "paid") return fail(409, "付款还在处理中，请稍等几秒。", "pending");
    if (!subId) return fail(409, "订阅还在创建中，请稍等几秒。", "pending");

    const sub = (await paddleGet(base, env.PADDLE_API_KEY, `/subscriptions/${subId}`)).data ?? {};
    const period = sub.current_billing_period as { ends_at?: unknown } | null | undefined;
    const subStatus = String(sub.status ?? "");
    const ends = typeof period?.ends_at === "string" ? period.ends_at : null;
    const customer = typeof txn.customer_id === "string" ? txn.customer_id : "";
    let email = "";
    if (customer) {
      try {
        const c = (await paddleGet(base, env.PADDLE_API_KEY, `/customers/${customer}`)).data;
        if (typeof c?.email === "string") email = c.email;
      } catch {
        /* the email is only a convenience for support */
      }
    }

    const claim = await claimLicense(env.QUOTA, { subId, customer, email, status: subStatus, ends, now: Date.now(), random: crypto.getRandomValues(new Uint8Array(20)) });
    if (!claim.ok) return fail(409, "这笔订单的许可证已经领取过了。如需找回，请发邮件联系客服并附上收据。", "already_claimed");
    return json({ ok: true, key: claim.key, active: isActiveStatus(claim.status), renewsAt: claim.ends });
  } catch (e) {
    console.error("claim failed", e instanceof PaddleError ? e.status : 0);
    return fail(502, "付款已经成功，但激活暂时失败。请不要重复付款，稍后重试，或发邮件联系客服并附上收据。", "upstream");
  }
};
