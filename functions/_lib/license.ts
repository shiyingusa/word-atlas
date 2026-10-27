/**
 * License keys for Pro subscribers. A buyer completes a Paddle checkout, the page claims a
 * license key for that transaction, and Paddle webhooks keep the subscription status current.
 * KV layout:  lic:<KEY> -> { sub, created }      sub:<subscription id> -> SubRecord
 * The subscription record is the source of truth for whether a key is active.
 */
import type { KVLike } from "./core";

export const CLAIM_RETRY_MS = 15 * 60 * 1000;
export const WEBHOOK_TOLERANCE_S = 300;
/** Webhooks can be lost, so a key in use is re-checked with Paddle at least this often. */
export const RECHECK_MS = 6 * 3600 * 1000;
/** If Paddle cannot be reached and the paid period ended longer ago than this, stop trusting an old "active". */
export const GRACE_MS = 3 * 24 * 3600 * 1000;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 symbols, no 0/O/1/I
const KEY_RE = /^WL-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}(?:-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}){3}$/;

export interface SubRecord {
  key: string;
  status: string;
  ends: string | null;
  customer: string;
  email: string;
  claimedAt: number;
  updatedAt: number;
  /** When the status was last confirmed (webhook or direct check with Paddle). */
  checkedAt?: number;
}
export interface LicRecord {
  sub: string;
  created: number;
}

export const isActiveStatus = (status: string) => status === "active" || status === "trialing";

/** 20 symbols from 20 random bytes (256 is a multiple of 32, so there is no modulo bias). */
export function generateKey(bytes: Uint8Array): string {
  if (bytes.length < 20) throw new Error("need 20 random bytes");
  let out = "";
  for (let i = 0; i < 20; i++) {
    out += ALPHABET[bytes[i] % 32];
    if (i % 5 === 4 && i < 19) out += "-";
  }
  return `WL-${out}`;
}

export function normalizeKey(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const k = input.trim().toUpperCase().replace(/\s+/g, "");
  return KEY_RE.test(k) ? k : null;
}

/* ---------- Paddle webhook signature ---------- */

export function parseSignatureHeader(header: string | null): { ts: string; sigs: string[] } | null {
  if (!header) return null;
  let ts = "";
  const sigs: string[] = [];
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "ts") ts = v;
    else if (k === "h1") sigs.push(v);
  }
  return ts && sigs.length ? { ts, sigs } : null;
}

const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: "no_header" | "malformed_header" | "timestamp_out_of_range" | "mismatch"; skewSeconds?: number };

/** Paddle signs `${ts}:${rawBody}` with HMAC-SHA256. Several h1 values appear during secret rotation. */
export async function checkPaddleSignature(raw: string, header: string | null, secret: string, nowSec: number, toleranceSec = WEBHOOK_TOLERANCE_S): Promise<SignatureCheck> {
  if (!header) return { ok: false, reason: "no_header" };
  const p = parseSignatureHeader(header);
  const ts = p ? Number(p.ts) : Number.NaN;
  if (!p || !Number.isFinite(ts)) return { ok: false, reason: "malformed_header" };
  const skew = nowSec - ts;
  if (Math.abs(skew) > toleranceSec) return { ok: false, reason: "timestamp_out_of_range", skewSeconds: Math.round(skew) };
  const expected = await hmacSha256Hex(secret, `${p.ts}:${raw}`);
  return p.sigs.some((s) => timingSafeEqual(s.toLowerCase(), expected)) ? { ok: true } : { ok: false, reason: "mismatch" };
}

export async function verifyPaddleSignature(raw: string, header: string | null, secret: string, nowSec: number, toleranceSec = WEBHOOK_TOLERANCE_S): Promise<boolean> {
  return (await checkPaddleSignature(raw, header, secret, nowSec, toleranceSec)).ok;
}

/** Secrets pasted into a dashboard often pick up spaces, line breaks or quotes: strip them. */
export function cleanSecret(v: string | undefined): string {
  return (v ?? "").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
}

/* ---------- webhook events -> subscription state ---------- */

export interface SubscriptionUpdate {
  subId: string;
  status: string;
  ends: string | null;
  customer: string;
  at: number;
}

export function subscriptionUpdateFromEvent(ev: unknown): SubscriptionUpdate | null {
  if (typeof ev !== "object" || ev === null) return null;
  const e = ev as { event_type?: unknown; occurred_at?: unknown; data?: Record<string, unknown> };
  if (typeof e.event_type !== "string" || !e.event_type.startsWith("subscription.")) return null;
  const d = e.data;
  if (!d || typeof d.id !== "string" || !d.id.startsWith("sub_") || typeof d.status !== "string") return null;
  const period = d.current_billing_period as { ends_at?: unknown } | null | undefined;
  const sched = d.scheduled_change as { effective_at?: unknown } | null | undefined;
  const ends = typeof period?.ends_at === "string" ? period.ends_at : typeof sched?.effective_at === "string" ? sched.effective_at : null;
  const at = typeof e.occurred_at === "string" ? Date.parse(e.occurred_at) : Number.NaN;
  return { subId: d.id, status: d.status, ends, customer: typeof d.customer_id === "string" ? d.customer_id : "", at: Number.isFinite(at) ? at : Date.now() };
}

async function readJson<T>(kv: KVLike, key: string): Promise<T | null> {
  const v = await kv.get(key);
  if (!v) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

/** Older events never overwrite newer state (webhooks can arrive out of order). */
export async function applySubscriptionUpdate(kv: KVLike, u: SubscriptionUpdate): Promise<"stale" | "applied"> {
  const cur = await readJson<SubRecord>(kv, `sub:${u.subId}`);
  if (cur && cur.updatedAt > u.at) return "stale";
  const next: SubRecord = {
    key: cur?.key ?? "",
    status: u.status,
    ends: u.ends,
    customer: u.customer || cur?.customer || "",
    email: cur?.email ?? "",
    claimedAt: cur?.claimedAt ?? 0,
    updatedAt: u.at,
    checkedAt: u.at,
  };
  await kv.put(`sub:${u.subId}`, JSON.stringify(next));
  return "applied";
}

/* ---------- claiming and looking up licenses ---------- */

export interface ClaimInput {
  subId: string;
  customer: string;
  email: string;
  status: string;
  ends: string | null;
  now: number;
  random: Uint8Array;
}
export type ClaimResult = { ok: true; key: string; status: string; ends: string | null; reused: boolean } | { ok: false; code: "already_claimed" };

export async function claimLicense(kv: KVLike, i: ClaimInput): Promise<ClaimResult> {
  const cur = await readJson<SubRecord>(kv, `sub:${i.subId}`);
  if (cur?.key) {
    // The same browser may retry right after paying; anyone else holding the transaction id is too late.
    if (i.now - cur.claimedAt <= CLAIM_RETRY_MS) return { ok: true, key: cur.key, status: cur.status, ends: cur.ends, reused: true };
    return { ok: false, code: "already_claimed" };
  }
  const key = generateKey(i.random);
  const sub: SubRecord = { key, status: i.status, ends: i.ends, customer: i.customer, email: i.email, claimedAt: i.now, updatedAt: i.now, checkedAt: i.now };
  const lic: LicRecord = { sub: i.subId, created: i.now };
  await kv.put(`lic:${key}`, JSON.stringify(lic));
  await kv.put(`sub:${i.subId}`, JSON.stringify(sub));
  return { ok: true, key, status: i.status, ends: i.ends, reused: false };
}

export interface LicenseState {
  active: boolean;
  status: string;
  ends: string | null;
}

/** A key is valid only while its subscription record points back at it. */
export async function lookupLicense(kv: KVLike, key: string): Promise<LicenseState | null> {
  const lic = await readJson<LicRecord>(kv, `lic:${key}`);
  if (!lic) return null;
  const sub = await readJson<SubRecord>(kv, `sub:${lic.sub}`);
  if (!sub || sub.key !== key) return null;
  return { active: isActiveStatus(sub.status), status: sub.status, ends: sub.ends };
}

export interface RemoteSub {
  status: string;
  ends: string | null;
  customer: string;
}
export type FetchSub = (subId: string) => Promise<RemoteSub | null>;

/**
 * Like lookupLicense, but does not rely on webhooks alone: when the stored status has not been confirmed
 * for RECHECK_MS it asks Paddle directly. If Paddle cannot be reached the stored state is kept, except
 * that an "active" subscription whose period ended more than GRACE_MS ago is no longer trusted.
 */
export async function lookupLicenseFresh(kv: KVLike, key: string, opts: { now: number; fetchSub?: FetchSub }): Promise<LicenseState | null> {
  const lic = await readJson<LicRecord>(kv, `lic:${key}`);
  if (!lic) return null;
  let sub = await readJson<SubRecord>(kv, `sub:${lic.sub}`);
  if (!sub || sub.key !== key) return null;

  let confirmed = false;
  if (opts.fetchSub && opts.now - (sub.checkedAt ?? sub.updatedAt) > RECHECK_MS) {
    const remote = await opts.fetchSub(lic.sub);
    if (remote) {
      sub = { ...sub, status: remote.status, ends: remote.ends, customer: remote.customer || sub.customer, updatedAt: Math.max(sub.updatedAt, opts.now), checkedAt: opts.now };
      await kv.put(`sub:${lic.sub}`, JSON.stringify(sub));
      confirmed = true;
    }
  }
  let active = isActiveStatus(sub.status);
  if (active && !confirmed && sub.ends && Date.parse(sub.ends) + GRACE_MS < opts.now) active = false;
  return { active, status: sub.status, ends: sub.ends };
}

/* ---------- small helpers shared by the endpoints ---------- */

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return toHex(new Uint8Array(d)).slice(0, 24);
}

/** Counts a use against a limit; returns false when the limit is already reached. */
export async function bump(kv: KVLike, key: string, limit: number, ttlSeconds = 172800): Promise<boolean> {
  const n = Number.parseInt((await kv.get(key)) ?? "0", 10) || 0;
  if (n >= limit) return false;
  await kv.put(key, String(n + 1), { expirationTtl: ttlSeconds });
  return true;
}

export class PaddleError extends Error {
  constructor(public status: number) {
    super(`paddle ${status}`);
  }
}

export const paddleBase = (env?: string) => (env === "sandbox" ? "https://sandbox-api.paddle.com" : "https://api.paddle.com");

export function makeFetchSub(env: { PADDLE_API_KEY?: string; PADDLE_ENV?: string }): FetchSub | undefined {
  const apiKey = cleanSecret(env.PADDLE_API_KEY);
  if (!apiKey) return undefined;
  const base = paddleBase(env.PADDLE_ENV);
  return async (subId) => {
    try {
      const d = (await paddleGet(base, apiKey, `/subscriptions/${subId}`)).data;
      if (!d || typeof d.status !== "string") return null;
      const period = d.current_billing_period as { ends_at?: unknown } | null | undefined;
      const sched = d.scheduled_change as { effective_at?: unknown } | null | undefined;
      const ends = typeof period?.ends_at === "string" ? period.ends_at : typeof sched?.effective_at === "string" ? sched.effective_at : null;
      return { status: d.status, ends, customer: typeof d.customer_id === "string" ? d.customer_id : "" };
    } catch {
      return null; // keep the stored state; the next use will try again
    }
  };
}

export async function paddleGet(base: string, apiKey: string, path: string): Promise<{ data?: Record<string, unknown> }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, signal: ctl.signal });
    if (!res.ok) throw new PaddleError(res.status);
    return (await res.json()) as { data?: Record<string, unknown> };
  } finally {
    clearTimeout(timer);
  }
}
