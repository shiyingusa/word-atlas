// Renders legal/*.html fragments with site.config.json into public/*.html (run before build/dev).
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const cfg = JSON.parse(fs.readFileSync(path.join(root, "site.config.json"), "utf8"));
const layout = fs.readFileSync(path.join(root, "legal", "_layout.html"), "utf8");

const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fill = (s) =>
  s.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    if (!(k in cfg)) throw new Error(`Unknown placeholder ${m} in legal templates`);
    return esc(cfg[k]);
  });

let rendered = 0;
for (const file of fs.readdirSync(path.join(root, "legal"))) {
  if (file.startsWith("_") || !file.endsWith(".html")) continue;
  const raw = fs.readFileSync(path.join(root, "legal", file), "utf8");
  const title = (raw.match(/<!--title:\s*(.*?)\s*-->/) ?? [, file])[1];
  const body = raw.replace(/<!--title:.*?-->\s*/, "");
  const html = fill(layout.replace("{{__title}}", title).replace("{{__body}}", body));
  fs.writeFileSync(path.join(root, "public", file), html);
  rendered++;
}
console.log(`render-legal: wrote ${rendered} pages`);
if (/\[YOUR/.test(JSON.stringify(cfg))) console.warn("render-legal: WARNING — site.config.json still has [YOUR ...] placeholders. Fill them in before applying to Paddle.");
