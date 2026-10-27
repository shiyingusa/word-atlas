/** Scores of past writing feedback, kept only in this browser (no essay text is stored). */
export interface EssayResult {
  at: number;
  overall: number;
  tr: number;
  cc: number;
  lr: number;
  gra: number;
  words: number;
}

const KEY = "wordlamp:essays";
const MAX = 30;
const band = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 9 ? Math.round(v * 2) / 2 : null);

export function sanitizeEssays(input: unknown): EssayResult[] {
  if (!Array.isArray(input)) return [];
  const out: EssayResult[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const [overall, tr, cc, lr, gra] = [band(r.overall), band(r.tr), band(r.cc), band(r.lr), band(r.gra)];
    const at = typeof r.at === "number" && Number.isFinite(r.at) ? r.at : null;
    const words = typeof r.words === "number" && Number.isFinite(r.words) ? Math.max(0, Math.round(r.words)) : 0;
    if (overall === null || tr === null || cc === null || lr === null || gra === null || at === null) continue;
    out.push({ at, overall, tr, cc, lr, gra, words });
  }
  return out.sort((a, b) => a.at - b.at).slice(-MAX);
}

export function readEssays(): EssayResult[] {
  try {
    return sanitizeEssays(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export function addEssay(r: EssayResult): EssayResult[] {
  const next = sanitizeEssays([...readEssays(), r]);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage can be blocked */
  }
  window.dispatchEvent(new Event("wordlamp:essays"));
  return next;
}

/** Change of the overall estimate against the previous essay, or null with fewer than two. */
export function deltaVsPrevious(list: EssayResult[]): number | null {
  if (list.length < 2) return null;
  return list[list.length - 1].overall - list[list.length - 2].overall;
}

export function essaySummary(list: EssayResult[]) {
  if (!list.length) return null;
  const best = Math.max(...list.map((e) => e.overall));
  return { count: list.length, best, latest: list[list.length - 1].overall, first: list[0].overall };
}
