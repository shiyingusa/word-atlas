import { CalendarPlus } from "lucide-react";
import { useState } from "react";
import { buildReminderIcs, normalizeTime } from "../lib/reminder";
import { useStore } from "../store/store";
import { toast } from "./Toast";
import "../styles/engage.css";

const KEY = "wordlamp:reminder-time";

export function ReminderPanel() {
  const dailyNew = useStore((s) => s.settings.dailyNew);
  const [time, setTime] = useState(() => {
    try {
      return normalizeTime(localStorage.getItem(KEY) ?? "20:00");
    } catch {
      return "20:00";
    }
  });

  function add() {
    const t = normalizeTime(time);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* storage can be blocked */
    }
    const blob = new Blob([buildReminderIcs(t, dailyNew)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "wordlamp-reminder.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast("已生成提醒文件，打开后选择“添加到日历”", "ok");
  }

  return (
    <section className="panel reminder" aria-label="每日提醒">
      <h3 className="eyebrow">每日提醒</h3>
      <p className="muted">网页自己没办法在后台提醒你，所以我们把提醒放进你手机的日历：每天这个时间响一次，点开就能学。</p>
      <div className="reminder-row">
        <label>
          每天{" "}
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="提醒时间" />
        </label>
        <button className="btn btn-primary" onClick={add}>
          <CalendarPlus size={16} /> 添加到日历
        </button>
      </div>
    </section>
  );
}
