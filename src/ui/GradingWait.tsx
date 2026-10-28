import "../styles/engage.css";

const TIPS = [
  "正在从任务回应、连贯衔接、词汇、语法四个维度评估你的作文。",
  "小提示：雅思大作文建议不少于 250 词，字数不足会影响“任务回应”。",
  "小提示：先看逐句修改建议，再看分数，收获更大。",
  "你的作文只用于这一次批改，我们不会保存。",
  "分数是 AI 的估算，仅供学习参考，不是官方评分。",
];

/** Shown while the model is working: honest about the wait, and quiet for screen readers. */
export function GradingWait({ elapsed }: { elapsed: number }) {
  return (
    <section className="wr-wait" aria-busy="true">
      <p className="sr-only" role="status">
        正在批改，请稍候。
      </p>
      <div aria-hidden="true">
        <p className="wr-wait-tip">{TIPS[Math.floor(elapsed / 4) % TIPS.length]}</p>
        <p className="muted">
          通常需要 10–20 秒，已等待 {elapsed} 秒。{elapsed >= 30 ? "比平时慢一些，请再等一等；超过 1 分钟会自动停止，你的作文不会丢。" : ""}
        </p>
        <div className="wr-skel">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="wr-skel-card">
              <i />
              <i />
              <i />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
