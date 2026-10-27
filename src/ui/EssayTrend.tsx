import { essaySummary } from "../lib/essays";
import { useEssays } from "./Badges";
import "../styles/engage.css";

export function EssayTrend() {
  const list = useEssays();
  const s = essaySummary(list);
  if (!s) return null;
  const pts = list.slice(-10);
  const W = 300;
  const H = 70;
  const x = (i: number) => (pts.length === 1 ? W / 2 : 8 + (i * (W - 16)) / (pts.length - 1));
  const y = (v: number) => H - 8 - ((Math.min(9, Math.max(4, v)) - 4) / 5) * (H - 16);
  return (
    <section className="panel trend" aria-label="写作进步记录">
      <p>
        <b>你的写作记录</b> · 已批改 {s.count} 篇 · 最高 {s.best.toFixed(1)} · 最近 {s.latest.toFixed(1)}
      </p>
      {pts.length >= 2 && (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`最近 ${pts.length} 篇的估算分走势`}>
          <polyline points={pts.map((p, i) => `${x(i)},${y(p.overall)}`).join(" ")} />
          {pts.map((p, i) => (
            <circle key={p.at} className={i === pts.length - 1 ? "last" : ""} cx={x(i)} cy={y(p.overall)} r={i === pts.length - 1 ? 4 : 3} />
          ))}
        </svg>
      )}
    </section>
  );
}
