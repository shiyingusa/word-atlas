/** User-facing counts, kept in one place so they stay accurate and testable. */
export const summaryLine = (newCount: number, wordCount: number) => (newCount > 0 ? `今天点亮了 ${newCount} 颗星` : `今天复习了 ${wordCount} 个词`);

/** "Lit a star" means a NEW word; reviewing old words is reviewing. */
export const practiceCountLine = (pool: number) => `可练 ${pool} 个词；本轮 ${Math.min(10, pool)} 个${pool > 10 ? "（随机抽取，最多 10 个）" : ""}。`;
