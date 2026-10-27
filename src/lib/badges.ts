import { isMastered } from "../store/srs";
import { dayKey } from "../store/store";
import type { Progress } from "../store/store";
import type { EssayResult } from "./essays";

export interface BadgeCtx {
  lit: number;
  mastered: number;
  /** Longest run of study days ever, so a badge is never taken back after a missed day. */
  streak: number;
  typingRounds: number;
  bestWpm: number;
  essays: number;
  essayGain: number;
}

export interface BadgeDef {
  id: string;
  icon: string;
  name: string;
  desc: string;
  target: number;
  pick: (c: BadgeCtx) => number;
}

export const BADGES: BadgeDef[] = [
  { id: "star-1", icon: "✨", name: "第一颗星", desc: "点亮第 1 个词", target: 1, pick: (c) => c.lit },
  { id: "star-10", icon: "🌟", name: "十星连珠", desc: "点亮 10 个词", target: 10, pick: (c) => c.lit },
  { id: "star-100", icon: "⭐", name: "百星成座", desc: "点亮 100 个词", target: 100, pick: (c) => c.lit },
  { id: "star-500", icon: "🌌", name: "五百星河", desc: "点亮 500 个词", target: 500, pick: (c) => c.lit },
  { id: "star-1000", icon: "🔭", name: "千星璀璨", desc: "点亮 1,000 个词", target: 1000, pick: (c) => c.lit },
  { id: "streak-3", icon: "🔥", name: "三日不辍", desc: "连续学习 3 天", target: 3, pick: (c) => c.streak },
  { id: "streak-7", icon: "📅", name: "七日成习", desc: "连续学习 7 天", target: 7, pick: (c) => c.streak },
  { id: "streak-14", icon: "🌙", name: "两周同行", desc: "连续学习 14 天", target: 14, pick: (c) => c.streak },
  { id: "streak-30", icon: "☀️", name: "月光不灭", desc: "连续学习 30 天", target: 30, pick: (c) => c.streak },
  { id: "master-10", icon: "🧠", name: "十词入心", desc: "掌握 10 个词", target: 10, pick: (c) => c.mastered },
  { id: "master-100", icon: "🏅", name: "百词在握", desc: "掌握 100 个词", target: 100, pick: (c) => c.mastered },
  { id: "type-1", icon: "⌨️", name: "指尖初试", desc: "完成 1 轮打字练习", target: 1, pick: (c) => c.typingRounds },
  { id: "type-wpm", icon: "⚡", name: "妙手生花", desc: "打字速度达到 30 WPM（正确率 90% 以上）", target: 30, pick: (c) => c.bestWpm },
  { id: "essay-1", icon: "📝", name: "落笔成文", desc: "完成 1 次写作批改", target: 1, pick: (c) => c.essays },
  { id: "essay-5", icon: "🖋️", name: "笔耕不辍", desc: "完成 5 次写作批改", target: 5, pick: (c) => c.essays },
  { id: "essay-up", icon: "📈", name: "更上一层", desc: "写作估算分比第一篇提高 1 分", target: 1, pick: (c) => c.essayGain },
];

export interface BadgeState extends BadgeDef {
  value: number;
  earned: boolean;
}

const parseDay = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export function longestStreak(days: Record<string, { r: number }>): number {
  const keys = Object.keys(days).filter((k) => days[k].r > 0 && /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  let best = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const k of keys) {
    const d = parseDay(k);
    if (prev) {
      const next = new Date(prev);
      next.setDate(next.getDate() + 1);
      run = dayKey(next) === k ? run + 1 : 1;
    } else run = 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

export function badgeContext(p: Progress, essays: EssayResult[]): BadgeCtx {
  const cards = Object.values(p.cards);
  const gain = essays.length >= 2 ? Math.max(...essays.map((e) => e.overall)) - essays[0].overall : 0;
  return {
    lit: cards.length,
    mastered: cards.filter(isMastered).length,
    streak: longestStreak(p.days),
    typingRounds: p.typing.length,
    bestWpm: Math.max(0, ...p.typing.filter((t) => t.accuracy >= 90).map((t) => t.wpm)),
    essays: essays.length,
    essayGain: Math.max(0, gain),
  };
}

export function evaluate(ctx: BadgeCtx): BadgeState[] {
  return BADGES.map((b) => {
    const raw = b.pick(ctx);
    return { ...b, value: Math.min(b.target, Math.max(0, Math.round(raw * 10) / 10)), earned: raw >= b.target };
  });
}

/** The unearned badge the learner is closest to: a concrete next goal. */
export function nextGoal(states: BadgeState[]): BadgeState | null {
  const open = states.filter((s) => !s.earned);
  if (!open.length) return null;
  return open.reduce((a, b) => (b.value / b.target > a.value / a.target || (b.value / b.target === a.value / a.target && b.target < a.target) ? b : a));
}
