/** POST /api/license/status { key } — is this license key valid and active? Binding: QUOTA (KV). */
import { dayKey } from "../../_lib/core";
import type { KVLike } from "../../_lib/core";
import { bump, lookupLicenseFresh, makeFetchSub, normalizeKey, sha256Hex } from "../../_lib/license";

interface Env {
  PADDLE_API_KEY?: string;
  PADDLE_ENV?: string;
  QUOTA?: KVLike;
  IP_SALT?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

export const onRequest = async ({ request, env }: { request: Request; env: Env }) => {
  if (request.method !== "POST") return json({ ok: false, error: "不支持这种请求。", code: "method" }, 405);
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return json({ ok: false, error: "来源不被允许。", code: "origin" }, 403);
  if (!env.QUOTA) return json({ ok: false, error: "服务还没有配置好。", code: "not_configured" }, 503);

  const raw = await request.text();
  if (raw.length > 500) return json({ ok: false, error: "内容太长。", code: "too_large" }, 413);
  let input: unknown;
  try {
    input = (JSON.parse(raw) as { key?: unknown }).key;
  } catch {
    return json({ ok: false, error: "请求格式不正确。", code: "bad_request" }, 400);
  }

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const who = await sha256Hex(`${ip}|${env.IP_SALT ?? "wordlamp"}`);
  // Guessing keys is pointless (100 bits) but keep it cheap to abuse anyway.
  if (!(await bump(env.QUOTA, `rl:status:${dayKey()}:${who}`, 200))) return json({ ok: false, error: "尝试次数太多，请稍后再试。", code: "rate_limited" }, 429);

  const key = normalizeKey(input);
  const state = key ? await lookupLicenseFresh(env.QUOTA, key, { now: Date.now(), fetchSub: makeFetchSub(env) }) : null;
  if (!key || !state) return json({ ok: false, error: "这个许可证密钥不正确。请检查是否完整复制。", code: "invalid" }, 404);
  return json({ ok: true, key, active: state.active, status: state.status, renewsAt: state.ends });
};
