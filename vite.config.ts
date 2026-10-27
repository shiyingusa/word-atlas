import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
// Local-only content is never copied into dist or the public archive.
function localMedia(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) {
  const route = (req.url || "").split("?")[0];
  const root = path.resolve(".local");
  if (route === "/local/catalog.json") {
    const file = path.join(root, "catalog.json");
    if (!fs.existsSync(file)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    fs.createReadStream(file).pipe(res);
    return;
  }
  const match = route.match(
    /^\/local\/media\/(image|uk|us|sentence)\/(\d{1,5})$/,
  );
  if (!match) {
    next();
    return;
  }
  try {
    const map = JSON.parse(
      fs.readFileSync(path.join(root, "media-map.json"), "utf8"),
    );
    const stored = map[match[2]]?.[match[1]];
    const file =
      typeof stored === "string"
        ? path.isAbsolute(stored)
          ? stored
          : path.resolve(root, stored)
        : undefined;
    if (!file || !fs.existsSync(file)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const types: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".wav": "audio/wav",
      ".mp3": "audio/mpeg",
      ".m4a": "audio/mp4",
    };
    res.setHeader("Content-Type", types[ext] || "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Accept-Ranges", "bytes");
    const size = fs.statSync(file).size;
    const range = req.headers.range;
    if (range) {
      const r = range.match(/^bytes=(\d+)-(\d*)$/);
      const start = r ? Number(r[1]) : -1;
      const end = r && r[2] ? Math.min(Number(r[2]), size - 1) : size - 1;
      if (start < 0 || start > end || start >= size) {
        res.statusCode = 416;
        res.setHeader("Content-Range", `bytes */${size}`);
        res.end();
        return;
      }
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      res.setHeader("Content-Length", end - start + 1);
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.setHeader("Content-Length", size);
      fs.createReadStream(file).pipe(res);
    }
  } catch {
    res.statusCode = 404;
    res.end();
  }
}
export default defineConfig({
  // Deploy under a sub-path with ATLAS_BASE=/words/ npm run build
  base: process.env.ATLAS_BASE || "/",
  plugins: [
    react(),
    {
      // Crawlers that do not run scripts only see this: brand, policy links and contact details.
      // React replaces it as soon as the app mounts.
      name: "static-home-fallback",
      transformIndexHtml(html: string) {
        let cfg: Record<string, string> = {};
        try {
          cfg = JSON.parse(fs.readFileSync(path.resolve("site.config.json"), "utf8"));
        } catch {
          /* fall back to defaults below */
        }
        const esc = (v: unknown) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        const email = esc(cfg.supportEmail ?? "support@wordlamp.net");
        const block =
          `<main id="static-home" style="max-width:640px;margin:48px auto;padding:0 20px;line-height:1.7">` +
          `<h1>词灯 WordLamp</h1>` +
          `<p>Illustrated IELTS vocabulary with spaced-repetition practice and AI writing feedback. 一词一画的雅思词汇学习，含 AI 写作批改。</p>` +
          `<p><a href="/pricing.html">Pricing</a> · <a href="/terms.html">Terms of Service</a> · <a href="/privacy.html">Privacy Policy</a> · <a href="/refund.html">Refund Policy</a></p>` +
          `<p>Contact: <a href="mailto:${email}">${email}</a>${cfg.legalName ? ` · Operated by ${esc(cfg.legalName)}` : ""}</p>` +
          `</main>`;
        return html.replace('<div id="root"></div>', `<div id="root">${block}</div>`);
      },
    },
    {
      name: "private-local-library",
      configureServer(server) {
        server.middlewares.use(localMedia);
      },
      configurePreviewServer(server) {
        server.middlewares.use(localMedia);
      },
    },
  ],
  server: { port: 5188, strictPort: true },
  preview: { port: 5188, strictPort: true },
  build: { chunkSizeWarningLimit: 600 },
});
