import { Loader2, PenLine, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { CRITERIA, FREE_DAILY, MAX_WORDS, MIN_WORDS, PRO_DAILY, countWords } from "../../functions/_lib/core";
import type { CriterionKey, Grade } from "../../functions/_lib/core";
import "../styles/write.css";

const NAMES: Record<CriterionKey, [string, string]> = {
  TR: ["任务回应", "Task Response"],
  CC: ["连贯与衔接", "Coherence & Cohesion"],
  LR: ["词汇资源", "Lexical Resource"],
  GRA: ["语法范围与准确", "Grammatical Range & Accuracy"],
};

type Result = { grade: Grade; words: number; remaining: number; limit: number; plan: "free" | "pro" };
type GradeReply = { grade: Grade; words: number; remaining: number; limit: number; plan: "free" | "pro"; license?: "active" | "inactive" | "unknown" };
type StatusReply = { key: string; active: boolean; status: string; renewsAt: string | null };
type ClaimReply = { key: string; active: boolean; renewsAt: string | null };
type Api<T> = ({ ok: true } & T) | { ok: false; error: string; code?: string };
type Plan = { active: boolean; renewsAt: string | null };

const LS_KEY = "wordlamp:license";
const LS_PENDING = "wordlamp:pending-txn";
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
  del(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* storage can be blocked */
    }
  },
};

async function postJson<T>(url: string, body: unknown): Promise<Api<T>> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => null)) as Api<T> | null;
    return data ?? { ok: false, error: "服务暂时没有响应，请稍后再试。" };
  } catch {
    return { ok: false, error: "网络出了点问题，请检查网络后再试。" };
  }
}
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });

export function Write() {
  const [question, setQuestion] = useState("");
  const [essay, setEssay] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [license, setLicense] = useState<string | null>(() => ls.get(LS_KEY));
  const [plan, setPlan] = useState<Plan | null>(null);
  const [licInput, setLicInput] = useState("");
  const [licBusy, setLicBusy] = useState(false);
  const [licMsg, setLicMsg] = useState<string | null>(null);
  const isPro = !!(license && plan?.active);

  useEffect(() => {
    let live = true;
    (async () => {
      // Paid but the key never arrived (closed tab, bad connection)? Retry the claim quietly.
      const pending = ls.get(LS_PENDING);
      if (!license && pending) {
        const r = await postJson<ClaimReply>("/api/license/claim", { transactionId: pending });
        if (live && r.ok) {
          ls.set(LS_KEY, r.key);
          ls.del(LS_PENDING);
          setLicense(r.key);
          setPlan({ active: r.active, renewsAt: r.renewsAt });
        }
        return;
      }
      if (license) {
        const r = await postJson<StatusReply>("/api/license/status", { key: license });
        if (!live) return;
        if (r.ok) setPlan({ active: r.active, renewsAt: r.renewsAt });
        else if (r.code === "invalid") setLicMsg("本机保存的许可证不正确或已失效，目前按免费版使用。");
      }
    })();
    return () => {
      live = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function activate() {
    setLicBusy(true);
    setLicMsg(null);
    const r = await postJson<StatusReply>("/api/license/status", { key: licInput });
    setLicBusy(false);
    if (!r.ok) return setLicMsg(r.error);
    if (!r.active) return setLicMsg("这个许可证对应的订阅已经结束或暂停。续订后即可继续使用。");
    ls.set(LS_KEY, r.key);
    setLicense(r.key);
    setPlan({ active: true, renewsAt: r.renewsAt });
    setLicInput("");
    setLicMsg("已激活 Pro，感谢支持！");
  }

  function leavePro() {
    ls.del(LS_KEY);
    setLicense(null);
    setPlan(null);
    setLicMsg("已在这台设备上退出 Pro。订阅本身不受影响，随时可以用密钥重新激活。");
  }

  const words = countWords(essay);
  const lengthOk = words >= MIN_WORDS && words <= MAX_WORDS;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ essay, question, consent, license: license ?? undefined }),
      });
      const data = (await res.json().catch(() => null)) as
        | ({ ok: true } & GradeReply)
        | { ok: false; error: string }
        | null;
      if (!data) throw new Error("服务暂时没有响应，请稍后再试。");
      if (!data.ok) throw new Error(data.error);
      if (data.license === "inactive") {
        setPlan({ active: false, renewsAt: null });
        setLicMsg("你的 Pro 订阅已经结束或暂停，这次按免费额度批改。续订后可继续使用。");
      }
      setResult({ grade: data.grade, words: data.words, remaining: data.remaining, limit: data.limit, plan: data.plan });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "出了点问题，请稍后再试。");
    } finally {
      setBusy(false);
    }
  }

  const renderPlan = () => (
    <section className="panel wr-plan">
      {isPro ? (
        <>
          <p>
            <Sparkles size={15} /> <b>Pro 已激活</b>
            {plan?.renewsAt ? ` · 本期至 ${fmtDate(plan.renewsAt)}` : ""} · 每天 {PRO_DAILY} 次批改{" "}
            <button className="link" onClick={leavePro}>
              在本机退出
            </button>
          </p>
          <p className="muted">
            取消订阅或申请退款，请看<a href="/refund.html" target="_blank" rel="noreferrer">退款政策</a>，或发邮件到 support@wordlamp.net。
          </p>
        </>
      ) : (
        <>
          <p>
            免费版：每天 {FREE_DAILY} 次。想要每天 {PRO_DAILY} 次？ <a href="/pricing.html" target="_blank" rel="noreferrer">了解 Pro</a>
          </p>
          <details>
            <summary>已有许可证密钥？</summary>
            <div className="wr-lic">
              <input value={licInput} onChange={(e) => setLicInput(e.target.value)} placeholder="WL-XXXXX-XXXXX-XXXXX-XXXXX" aria-label="许可证密钥" autoCapitalize="characters" spellCheck={false} />
              <button className="btn btn-primary" disabled={licBusy || licInput.trim().length < 10} onClick={activate}>
                {licBusy ? "检查中…" : "激活"}
              </button>
            </div>
          </details>
        </>
      )}
      {licMsg && (
        <p className="muted" role="status">
          {licMsg}
        </p>
      )}
    </section>
  );

  if (result) {
    const g = result.grade;
    return (
      <div className="page wr">
        <p className="eyebrow">批改结果</p>
        <header className="wr-hero">
          <div className="wr-band">
            <b>{g.overall.toFixed(1)}</b>
            <span>估算总分</span>
          </div>
          <p className="lede">
            参考区间 {g.low.toFixed(1)}–{g.high.toFixed(1)}，共 {result.words} 词。这是 AI 给出的学习参考，不是官方评分，也不保证真实考试成绩。
          </p>
        </header>

        <section className="wr-grid">
          {CRITERIA.map((k) => (
            <div key={k} className="panel wr-card">
              <div className="wr-card-head">
                <h3>{NAMES[k][0]}</h3>
                <b>{g.criteria[k].score.toFixed(1)}</b>
              </div>
              <small>{NAMES[k][1]}</small>
              <p>{g.criteria[k].comment}</p>
            </div>
          ))}
        </section>

        {g.strengths.length > 0 && (
          <section className="panel wr-block">
            <h3 className="eyebrow">做得好的地方</h3>
            <ul>{g.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </section>
        )}

        {g.fixes.length > 0 && (
          <section className="panel wr-block">
            <h3 className="eyebrow">逐句修改建议</h3>
            {g.fixes.map((f, i) => (
              <div key={i} className="wr-fix">
                <p className="wr-from" lang="en">{f.original}</p>
                <p className="wr-to" lang="en">{f.better}</p>
                {f.why && <p className="muted">{f.why}</p>}
              </div>
            ))}
          </section>
        )}

        {g.nextSteps.length > 0 && (
          <section className="panel wr-block">
            <h3 className="eyebrow">下一步怎么练</h3>
            <ul>{g.nextSteps.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </section>
        )}

        <div className="wr-actions">
          <button className="btn btn-primary" onClick={() => setResult(null)}>
            再批改一篇
          </button>
          <span className="muted">
            今天还剩 {result.remaining}/{result.limit} 次{result.plan === "pro" ? "" : "免费"}批改
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="page wr">
      <p className="eyebrow">AI 写作批改</p>
      <h1 className="display">写完就批，马上知道哪里能更好。</h1>
      <p className="lede">粘贴一篇雅思大作文（Task 2），按任务回应、连贯衔接、词汇、语法四个维度给出估算分、逐句修改和练习建议。每天 {FREE_DAILY} 次免费，Pro 每天 {PRO_DAILY} 次。</p>

      {renderPlan()}

      <label className="wr-label" htmlFor="wr-q">
        作文题目（可选）
      </label>
      <textarea id="wr-q" className="wr-input wr-q" rows={2} maxLength={600} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="例如：Some people think that … To what extent do you agree or disagree?" />

      <label className="wr-label" htmlFor="wr-e">
        你的作文
      </label>
      <textarea id="wr-e" className="wr-input wr-essay" rows={14} value={essay} onChange={(e) => setEssay(e.target.value)} placeholder="把英文作文粘贴到这里……" lang="en" />
      <p className={`wr-count ${words > 0 && !lengthOk ? "is-bad" : ""}`}>
        {words} 词 · 需要 {MIN_WORDS}–{MAX_WORDS} 词
      </p>
      {lengthOk && words < 250 && <p className="wr-hint">雅思大作文建议不少于 250 词。字数不足会拉低“任务回应”的得分，批改结果会反映这一点。</p>}

      <label className="wr-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>
          <ShieldCheck size={15} /> 我同意把这篇作文发送给第三方 AI 服务（DeepSeek）进行批改。词灯不保存你的作文。详见{" "}
          <a href="/privacy.html" target="_blank" rel="noreferrer">隐私政策</a>。
        </span>
      </label>

      {error && <p className="warn-text" role="alert">{error}</p>}

      <button className="btn btn-primary btn-xl" disabled={busy || !consent || !lengthOk} onClick={submit}>
        {busy ? <Loader2 size={18} className="wr-spin" /> : <PenLine size={18} />} {busy ? "批改中，大约需要十几秒……" : "开始批改"}
      </button>
      <p className="muted wr-note">估算分仅供学习参考，不是官方雅思评分。请不要粘贴含有个人隐私的内容。</p>
    </div>
  );
}
