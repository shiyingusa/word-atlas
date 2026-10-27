import assert from "node:assert/strict";
import { test } from "node:test";
import { dropUntouchedSession, isUntouchedSession, sanitizeProgress, sanitizeSettings, settingsResetPlan } from "./store";
import type { ActiveSession, Settings } from "./store";

const card = { due: 1, s: 2, d: 5, el: 0, sd: 1, ls: 0, reps: 1, lapses: 0, st: 2, seen: 1 };

test("keeps valid progress and drops malformed records", () => {
  const p = sanitizeProgress(
    {
      version: 2,
      cards: { ok: card, bad: { ...card, d: 99 }, worse: "x" },
      bookmarks: ["ok", 3],
      days: { "2026-10-25": { n: 1, r: 2, c: 1, t: 30 }, nope: { n: 1, r: 1, c: 1, t: 1 } },
      typing: [{ at: 1, mode: "word", items: 10, wpm: 40, accuracy: 98 }, { at: 1, mode: "hack", items: 1, wpm: 1, accuracy: 1 }],
    },
    "word-atlas-open",
  );
  assert.deepEqual(Object.keys(p.cards), ["ok"]);
  assert.deepEqual(p.bookmarks, ["ok"]);
  assert.deepEqual(Object.keys(p.days), ["2026-10-25"]);
  assert.equal(p.typing.length, 1);
});

test("rejects other versions and unknown settings", () => {
  assert.deepEqual(sanitizeProgress({ version: 1, cards: { ok: card } }, "x").cards, {});
  const s = sanitizeSettings({ accent: "fr", dailyNew: 1e9, theme: "dark", retention: 0.5 });
  assert.equal(s.accent, "uk");
  assert.equal(s.dailyNew, 10);
  assert.equal(s.theme, "dark");
  assert.equal(s.retention, 0.9);
});

const session = (over: Partial<ActiveSession> = {}): ActiveSession => ({ id: "s1", started: 1, steps: [], index: 0, graded: {}, newIds: [], reviewIds: [], ...over });

test("a session nobody has answered in is untouched; progress makes it permanent", () => {
  assert.equal(isUntouchedSession(null), false);
  assert.equal(isUntouchedSession(session()), true);
  assert.equal(isUntouchedSession(session({ index: 2 })), false);
  assert.equal(isUntouchedSession(session({ graded: { a: 3 } })), false);
  assert.equal(isUntouchedSession(session({ pending: { correct: true, value: "x" } })), false);
  assert.equal(isUntouchedSession(session({ finished: 5 })), false);
});

test("changing level or daily goal drops only an untouched session", () => {
  const base = sanitizeProgress({ version: 2, cards: {} }, "x");
  assert.equal(dropUntouchedSession({ ...base, session: session() }).session, null);
  const started = { ...base, session: session({ graded: { a: 3 } }) };
  assert.equal(dropUntouchedSession(started), started);

  const prev = sanitizeSettings({}) as Settings;
  assert.equal(settingsResetPlan(prev, { startLevel: prev.startLevel }), false);
  assert.equal(settingsResetPlan(prev, { theme: "dark" }), false);
  assert.equal(settingsResetPlan(prev, { startLevel: prev.startLevel + 2 }), true);
  assert.equal(settingsResetPlan(prev, { dailyNew: prev.dailyNew + 5 }), true);
});

test("typing stats accept the new recall mode", () => {
  const p = sanitizeProgress({ version: 2, cards: {}, typing: [{ at: 1, mode: "recall", items: 10, wpm: 30, accuracy: 95 }] }, "x");
  assert.equal(p.typing.length, 1);
});
