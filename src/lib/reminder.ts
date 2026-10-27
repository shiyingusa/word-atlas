/** A daily study reminder as an .ics file: the phone's calendar does the notifying. */
const fold = (line: string) => {
  // RFC 5545: lines longer than 75 octets are folded; keep it simple and safe for CJK text.
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    if (bytes + b > 73) {
      out.push(cur);
      cur = " ";
      bytes = 1;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n");
};
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

export function normalizeTime(t: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return "20:00";
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? `${pad(h)}:${pad(min)}` : "20:00";
}

export function buildReminderIcs(time: string, perDay: number, now = new Date()): string {
  const t = normalizeTime(time);
  const [h, m] = t.split(":");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const n = Math.max(1, Math.min(50, Math.round(perDay) || 10));
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WordLamp//Study reminder//ZH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:wordlamp-daily-${h}${m}@wordlamp.net`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${date}T${h}${m}00`,
    "DURATION:PT15M",
    "RRULE:FREQ=DAILY",
    `SUMMARY:${esc(`词灯：今天点亮 ${n} 颗星`)}`,
    `DESCRIPTION:${esc("打开词灯，学 10 分钟：https://wordlamp.net/")}`,
    "URL:https://wordlamp.net/",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:PT0M",
    `DESCRIPTION:${esc("词灯学习时间到了")}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
