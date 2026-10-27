/**
 * POST /api/grade — AI writing feedback for IELTS Task 2.
 * Secrets: DEEPSEEK_API_KEY (encrypted env var). Binding: QUOTA (KV namespace).
 * The essay is forwarded to the model provider and is never stored or logged here.
 */
import { FREE_DAILY, GLOBAL_DAILY_DEFAULT, MODEL, buildMessages, dayKey, parseGrade, readQuota, recordQuota, validateRequest } from "../_lib/core";
import type { KVLike } from "../_lib/core";

interface Env {
  DEEPSEEK_API_KEY?: string;
  QUOTA?: KVLike;
  GLOBAL_DAILY_LIMIT?: string;
  IP_SALT?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
const fail = (status: number, error: string, code: string) => json({ ok: false, error, code }, status);

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

class UpstreamError extends Error {
  constructor(public status: number) {
    super(`upstream ${status}`);
  }
}

async function callModel(apiKey: string, messages: { role: string; content: string }[]): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 40000);
  try {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: MODEL, messages, response_format: { type: "json_object" }, max_tokens: 2000, temperature: 0.3, stream: false }),
      signal: ctl.signal,
    });
    if (!res.ok) throw new UpstreamError(res.status);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

export const onRequest = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;
  if (request.method !== "POST") return fail(405, "不支持这种请求。", "method");

  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return fail(403, "来源不被允许。", "origin");

  if (!env.DEEPSEEK_API_KEY) return fail(503, "批改服务还没有配置好，请稍后再试。", "not_configured");
  if (!env.QUOTA) return fail(503, "批改服务还没有配置好，请稍后再试。", "not_configured");

  const raw = await request.text();
  if (raw.length > 30000) return fail(413, "内容太长。", "too_large");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "请求格式不正确。", "bad_request");
  }
  const v = validateRequest(body);
  if (!v.ok) return fail(400, v.error, v.code);

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const user = await sha256Hex(`${ip}|${env.IP_SALT ?? "wordlamp"}`);
  const day = dayKey();
  const globalLimit = Number.parseInt(env.GLOBAL_DAILY_LIMIT ?? "", 10) || GLOBAL_DAILY_DEFAULT;
  const quota = await readQuota(env.QUOTA, user, day, FREE_DAILY, globalLimit);
  if (!quota.allowed) {
    return quota.reason === "global"
      ? fail(429, "今天的批改名额已被用完，请明天再来。", "global_limit")
      : fail(429, `今天的 ${FREE_DAILY} 次免费批改已用完，明天再来吧。`, "daily_limit");
  }

  const messages = buildMessages(v.value, v.words);
  let grade = null;
  try {
    for (let attempt = 0; attempt < 2 && !grade; attempt++) grade = parseGrade(await callModel(env.DEEPSEEK_API_KEY, messages));
  } catch (e) {
    const status = e instanceof UpstreamError ? e.status : 0;
    console.error("model call failed", status);
    if (status === 429) return fail(429, "现在批改的人太多了，请稍后再试。", "busy");
    return fail(502, "批改服务暂时不可用，请稍后再试。这次不会扣你的次数。", "upstream");
  }
  if (!grade) return fail(502, "AI 这次没有给出有效结果，请再试一次。这次不会扣你的次数。", "bad_output");

  const used = await recordQuota(env.QUOTA, user, day);
  return json({ ok: true, grade, words: v.words, remaining: Math.max(0, FREE_DAILY - used), limit: FREE_DAILY });
};
