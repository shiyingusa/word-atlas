import { useEffect, useState } from "react";
import { badgeContext, evaluate, nextGoal } from "../lib/badges";
import { readEssays } from "../lib/essays";
import type { EssayResult } from "../lib/essays";
import { useStore } from "../store/store";
import { toast } from "./Toast";
import "../styles/engage.css";

const SEEN = "wordlamp:badges-seen";
const ls = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage can be blocked */
    }
  },
};

export function useEssays(): EssayResult[] {
  const [list, setList] = useState<EssayResult[]>(() => readEssays());
  useEffect(() => {
    const f = () => setList(readEssays());
    window.addEventListener("wordlamp:essays", f);
    return () => window.removeEventListener("wordlamp:essays", f);
  }, []);
  return list;
}

/** Celebrates a newly earned badge once. The first run only records what is already earned. */
export function BadgeWatcher() {
  const progress = useStore((s) => s.progress);
  const essays = useEssays();
  useEffect(() => {
    const states = evaluate(badgeContext(progress, essays));
    const earned = states.filter((s) => s.earned);
    const raw = ls.get(SEEN);
    if (raw === null) {
      ls.set(SEEN, JSON.stringify(earned.map((s) => s.id)));
      return;
    }
    let seen: string[] = [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) seen = parsed.filter((x): x is string => typeof x === "string");
    } catch {
      /* start over */
    }
    const fresh = earned.filter((s) => !seen.includes(s.id));
    if (!fresh.length) return;
    ls.set(SEEN, JSON.stringify([...seen, ...fresh.map((s) => s.id)]));
    fresh.forEach((s, i) => window.setTimeout(() => toast(`${s.icon} 解锁勋章「${s.name}」· ${s.desc}`, "ok"), i * 1200));
  }, [progress, essays]);
  return null;
}

export function BadgePanel() {
  const progress = useStore((s) => s.progress);
  const essays = useEssays();
  const states = evaluate(badgeContext(progress, essays));
  const done = states.filter((s) => s.earned).length;
  const goal = nextGoal(states);
  return (
    <section className="panel badges" aria-label="勋章">
      <div className="badges-head">
        <h3 className="eyebrow">勋章</h3>
        <span>
          <b>{done}</b> / {states.length}
        </span>
      </div>
      {goal ? (
        <p className="badges-next">
          下一枚：{goal.icon} <i>{goal.name}</i> · {goal.desc}（{goal.value}/{goal.target}）
        </p>
      ) : (
        <p className="badges-next">全部勋章都已点亮，了不起。</p>
      )}
      <div className="badge-grid">
        {states.map((s) => (
          <div key={s.id} className={`badge ${s.earned ? "is-earned" : "is-locked"}`}>
            <span className="bi" aria-hidden="true">
              {s.icon}
            </span>
            <b>{s.name}</b>
            <small>{s.desc}</small>
            {!s.earned && (
              <div className="bar" aria-label={`进度 ${s.value}/${s.target}`}>
                <i style={{ width: `${Math.round((s.value / s.target) * 100)}%` }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
