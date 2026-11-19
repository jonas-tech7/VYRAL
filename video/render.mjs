/**
 * Renders the VYRAL launch trailer.
 *
 *   python3 video/soundtrack.py video/out/soundtrack.wav
 *   node video/render.mjs                    # all frames (4K) + MP4s
 *   node video/render.mjs --stills 0.9,17.6  # review stills (1080p PNG)
 *   node video/render.mjs --prores           # also a ProRes 422 HQ master
 *
 * Frames come from timeline.html (served locally, rendered in Chromium at
 * 1920×1080 with deviceScaleFactor 2 → 3840×2160), then ffmpeg encodes
 * H.264 (Rec.709, 4K and 1080p) with the 48 kHz stereo soundtrack.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(DIR, "..");
const OUT = path.join(DIR, "out");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};
const cues = JSON.parse(await readFile(path.join(DIR, "cues.json"), "utf8"));
const FPS = cues.fps;
const TOTAL = Math.round(cues.duration * FPS);

// ---------------------------------------------------------------- static server
const FONTS = {
  "/fonts/Geist-Variable.woff2": "node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2",
  "/fonts/GeistMono-Variable.woff2": "node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2",
};
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = FONTS[urlPath] ? path.join(REPO, FONTS[urlPath]) : path.join(DIR, urlPath === "/" ? "timeline.html" : urlPath);
  if (!file.startsWith(DIR) && !FONTS[urlPath]) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none"] });
async function openPage(scale) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.renderFrame === "function", null, { timeout: 60_000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
  });
  return page;
}
async function frameTo(page, t, file, type) {
  await page.evaluate((tt) => window.renderFrame(tt), t);
  await page.screenshot({ path: file, type, ...(type === "jpeg" ? { quality: 95 } : {}) });
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
}

try {
  const stills = arg("stills");
  if (stills) {
    const dir = path.join(OUT, "stills");
    await mkdir(dir, { recursive: true });
    const scale = Number(arg("scale", 1));
    const page = await openPage(scale);
    for (const t of String(stills).split(",").map(Number)) {
      const file = path.join(dir, `t${t.toFixed(2).padStart(5, "0")}.png`);
      await frameTo(page, t, file, "png");
      console.log("still", file);
    }
  } else {
    const frames = path.join(OUT, "frames");
    const from = Math.round(Number(arg("from", 0)) * FPS);
    const to = Math.min(TOTAL, Math.round(Number(arg("to", cues.duration)) * FPS));
    if (!arg("encode-only")) {
      if (from === 0 && !arg("keep")) await rm(frames, { recursive: true, force: true });
      await mkdir(frames, { recursive: true });
      const workers = Number(arg("workers", 4));
      let next = from;
      let done = 0;
      const started = Date.now();
      await Promise.all(
        Array.from({ length: workers }, async () => {
          const page = await openPage(2);
          for (;;) {
            const f = next++;
            if (f >= to) break;
            await frameTo(page, f / FPS, path.join(frames, `f${String(f).padStart(5, "0")}.jpg`), "jpeg");
            if (++done % 60 === 0) console.log(`frames ${done}/${to - from} · ${((Date.now() - started) / done).toFixed(0)} ms/frame`);
          }
        }),
      );
      console.log(`rendered ${done} frames in ${((Date.now() - started) / 1000).toFixed(0)} s`);
    }

    if (arg("encode-only") || (arg("encode", true) !== "false" && from === 0 && to === TOTAL)) {
      const audio = path.join(OUT, "soundtrack.wav");
      if (!existsSync(audio)) throw new Error("Missing out/soundtrack.wav: run python3 video/soundtrack.py video/out/soundtrack.wav");
      // JPEG frames are full-range BT.601 YCbCr. Go through RGB with accurate rounding, then to
      // broadcast-range Rec.709 (a direct YUV→YUV scale shifts chroma and crushes blacks).
      const F = "accurate_rnd+full_chroma_int+full_chroma_inp";
      const rgb = `scale=in_range=full:in_color_matrix=bt601:flags=${F},format=gbrp`;
      const rec709 = (fmt) => `scale=out_color_matrix=bt709:out_range=tv:flags=${F},format=${fmt}`;
      const tags = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv"];
      const input = ["-framerate", String(FPS), "-i", path.join(frames, "f%05d.jpg"), "-i", audio];
      const aac = ["-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-ac", "2"];
      const h264 = (crf) => ["-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-profile:v", "high", "-tune", "film", ...tags, ...aac, "-movflags", "+faststart", "-shortest"];
      await ffmpeg([...input, "-vf", `${rgb},${rec709("yuv420p")}`, ...h264(18), path.join(OUT, "vyral-launch-4k.mp4")]);
      console.log("encoded out/vyral-launch-4k.mp4");
      await ffmpeg([...input, "-vf", `${rgb},scale=1920:1080:flags=lanczos+${F},${rec709("yuv420p")}`, ...h264(17), path.join(OUT, "vyral-launch-1080p.mp4")]);
      console.log("encoded out/vyral-launch-1080p.mp4");
      if (arg("prores")) {
        await ffmpeg([...input, "-vf", `${rgb},${rec709("yuv422p10le")}`, "-c:v", "prores_ks", "-profile:v", "3", "-vendor", "apl0", ...tags, "-c:a", "pcm_s24le", "-ar", "48000", "-shortest", path.join(OUT, "vyral-launch-master-prores422hq.mov")]);
        console.log("encoded out/vyral-launch-master-prores422hq.mov");
      }
    }
  }
} finally {
  await browser.close();
  server.close();
}
