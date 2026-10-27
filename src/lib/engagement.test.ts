import assert from "node:assert/strict";
import { test } from "node:test";
import { BADGES, badgeContext, evaluate, longestStreak, nextGoal } from "./badges";
import { deltaVsPrevious, essaySummary, sanitizeEssays } from "./essays";
import { buildReminderIcs, normalizeTime } from "./reminder";
import { emptyProgress } from "../store/store";
import type { CardState } from "../store/srs";

const card = (over: Partial<CardState> = {}): CardState => ({ due: 0, s: 1, d: 5, el: 0, sd: 0, ls: 0, reps: 1, lapses: 0, st: 1, seen: 1, ...over });
const day = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

test("longest streak counts consecutive study days and survives a gap", () => {
  assert.equal(longestStreak({}), 0);
  const days: Record<string, { r: number }> = {};
  for (const d of [1, 2, 3, 4]) days[day(2026, 10, d)] = { r: 5 };
  days[day(2026, 10, 6)] = { r: 5 };
  days[day(2026, 10, 7)] = { r: 0 }; // opened but answered nothing: not a study day
  assert.equal(longestStreak(days), 4);
  days[day(2026, 10, 5)] = { r: 2 };
  assert.equal(longestStreak(days), 6, "filling the gap joins the runs");
  assert.equal(longestStreak({ [day(2026, 2, 28)]: { r: 1 }, [day(2026, 3, 1)]: { r: 1 } }), 2, "month boundaries count");
});

test("badges follow the learner's numbers and never mix up thresholds", () => {
  const p = emptyProgress("x");
  const zero = evaluate(badgeContext(p, []));
  assert.equal(zero.filter((b) => b.earned).length, 0);
  assert.ok(new Set(BADGES.map((b) => b.id)).size === BADGES.length, "badge ids are unique");

  for (let i = 0; i < 12; i++) p.cards[`w${i}`] = card();
  p.typing.push({ at: 1, mode: "word", items: 10, wpm: 34, accuracy: 96 }, { at: 2, mode: "word", items: 10, wpm: 80, accuracy: 70 });
  const got = new Map(evaluate(badgeContext(p, [])).map((b) => [b.id, b]));
  assert.equal(got.get("star-1")!.earned, true);
  assert.equal(got.get("star-10")!.earned, true);
  assert.equal(got.get("star-100")!.earned, false);
  assert.equal(got.get("star-100")!.value, 12 > 100 ? 100 : 12);
  assert.equal(got.get("type-1")!.earned, true);
  assert.equal(got.get("type-wpm")!.earned, true, "34 WPM at 96% counts");
  assert.equal(badgeContext(p, []).bestWpm, 34, "a fast but sloppy round does not count");
});

test("writing badges need real improvement, and the next goal is the closest one", () => {
  const e = (overall: number, at: number) => ({ at, overall, tr: overall, cc: overall, lr: overall, gra: overall, words: 250 });
  const p = emptyProgress("x");
  assert.equal(badgeContext(p, [e(5, 1)]).essayGain, 0, "one essay is not progress yet");
  assert.equal(badgeContext(p, [e(5, 1), e(6.5, 2)]).essayGain, 1.5);
  assert.equal(badgeContext(p, [e(6, 1), e(5, 2)]).essayGain, 0, "never negative");
  const states = evaluate(badgeContext(p, [e(5, 1), e(6, 2)]));
  assert.equal(states.find((b) => b.id === "essay-up")!.earned, true);

  for (let i = 0; i < 8; i++) p.cards[`w${i}`] = card();
  const goal = nextGoal(evaluate(badgeContext(p, [])))!;
  assert.equal(goal.id, "star-10", "8 of 10 stars is the nearest goal");
  const all = BADGES.map((b) => ({ ...b, value: b.target, earned: true }));
  assert.equal(nextGoal(all), null);
});

test("essay history is sanitized, ordered, capped and reports change", () => {
  const good = { at: 2, overall: 6, tr: 5.5, cc: 6, lr: 6, gra: 6.5, words: 251.6 };
  const list = sanitizeEssays([good, { ...good, at: 1, overall: 5 }, { ...good, overall: 12 }, { ...good, overall: "x" }, null, "junk", { ...good, at: NaN }]);
  assert.deepEqual(list.map((x) => [x.at, x.overall]), [[1, 5], [2, 6]]);
  assert.equal(list[1].words, 252);
  assert.equal(deltaVsPrevious(list), 1);
  assert.equal(deltaVsPrevious(list.slice(0, 1)), null);
  assert.deepEqual(essaySummary(list), { count: 2, best: 6, latest: 6, first: 5 });
  assert.equal(essaySummary([]), null);
  assert.equal(sanitizeEssays(Array.from({ length: 50 }, (_, i) => ({ ...good, at: i }))).length, 30);
  assert.deepEqual(sanitizeEssays("nope"), []);
});

test("the reminder is a valid daily calendar event", () => {
  const ics = buildReminderIcs("7:05", 10, new Date(2026, 9, 27, 12, 0, 0));
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(ics.includes("DTSTART:20261027T070500\r\n"), "floating local time, zero padded");
  assert.ok(ics.includes("RRULE:FREQ=DAILY\r\n"));
  assert.ok(ics.includes("BEGIN:VALARM") && ics.includes("TRIGGER:PT0M"));
  assert.ok(!/[^\r]\n/.test(ics), "only CRLF line endings");
  for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, `line too long: ${line}`);
  const unfolded = ics.replace(/\r\n /g, "");
  assert.ok(unfolded.includes("SUMMARY:词灯：今天点亮 10 颗星"));
  assert.equal(normalizeTime("25:00"), "20:00");
  assert.equal(normalizeTime("abc"), "20:00");
  assert.equal(normalizeTime("9:30"), "09:30");
  assert.ok(buildReminderIcs("20:00", 999).replace(/\r\n /g, "").includes("点亮 50 颗星"), "goal is clamped");
});
