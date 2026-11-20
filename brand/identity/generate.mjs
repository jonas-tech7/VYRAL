/**
 * VYRAL identity system: four logo directions with wordmarks, lockups, icons,
 * matching X banners, background elements and one presentation sheet each.
 *
 * Everything is built from the master symbol: five identical rhombi on one
 * lattice whose two vectors run along the arms of the V (32° from vertical).
 * Typography is Geist (Vercel), converted to outlines so every file is a pure
 * vector that reproduces exactly.
 *
 *   NODE_PATH=<dir with opentype.js> node brand/identity/generate.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// opentype.js is a build-time tool only: install it anywhere and point OPENTYPE_DIR at its node_modules parent.
const opentype = createRequire(join(process.env.OPENTYPE_DIR ?? process.cwd(), "package.json"))("opentype.js");
const { chromium } = require("playwright");

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const OUT = join(here, "out");
mkdirSync(OUT, { recursive: true });

/* ================================ Geometry ================================ */
const RW = 52.99; // unit half width
const RH = 84.805; // unit half height
const A = [62.53, 100.07]; // lattice step along the right arm (down-right)
const B = [-62.53, 100.07]; // lattice step along the left arm (down-left)
const SYM_W = 356.11;
const SYM_H = 369.75;
// Unit centres: outer pair, inner pair, tip (rank 2, 1, 0 from the tip).
const UNITS = [
  { c: [52.99, 84.805], rank: 2 },
  { c: [303.11, 84.805], rank: 2 },
  { c: [115.52, 184.875], rank: 1 },
  { c: [240.58, 184.875], rank: 1 },
  { c: [178.05, 284.945], rank: 0 },
];
const ANGLE = Math.atan2(A[0], A[1]); // 32°
const f = (n) => Math.round(n * 100) / 100;
const pts = (list) => list.map((p) => `${f(p[0])} ${f(p[1])}`).join("L");
const rhombusPts = (cx, cy, s) => [
  [cx, cy - RH * s],
  [cx + RW * s, cy],
  [cx, cy + RH * s],
  [cx - RW * s, cy],
];
const rhombus = (cx, cy, s) => `M${pts(rhombusPts(cx, cy, s))}Z`;

/* ============================== Typography ============================== */
const fontFile = (p) => join(root, "node_modules/geist/dist/fonts", p);
const FONTS = {
  regular: opentype.loadSync(fontFile("geist-sans/Geist-Regular.ttf")),
  medium: opentype.loadSync(fontFile("geist-sans/Geist-Medium.ttf")),
  semibold: opentype.loadSync(fontFile("geist-sans/Geist-SemiBold.ttf")),
  bold: opentype.loadSync(fontFile("geist-sans/Geist-Bold.ttf")),
  mono: opentype.loadSync(fontFile("geist-mono/GeistMono-Regular.ttf")),
  monoMedium: opentype.loadSync(fontFile("geist-mono/GeistMono-Medium.ttf")),
};
/** Text as outlines. tracking in em. Returns { d, width, capHeight }. */
function text(font, str, size, tracking = 0) {
  const scale = size / font.unitsPerEm;
  let x = 0;
  const parts = [];
  const glyphs = font.stringToGlyphs(str);
  glyphs.forEach((g, i) => {
    parts.push(g.getPath(x, 0, size).toPathData(2));
    x += g.advanceWidth * scale;
    if (i < glyphs.length - 1) {
      x += font.getKerningValue(g, glyphs[i + 1]) * scale;
      x += tracking * size;
    }
  });
  const capHeight = (font.tables.os2.sCapHeight || font.unitsPerEm * 0.7) * scale;
  return { d: parts.join(""), width: x, capHeight };
}
/** Placed text: (x, baseline y), anchor start|middle|end. */
function textAt(font, str, size, x, y, { tracking = 0, fill = "#fff", anchor = "start", opacity } = {}) {
  const t = text(font, str, size, tracking);
  const dx = anchor === "middle" ? -t.width / 2 : anchor === "end" ? -t.width : 0;
  return `<path transform="translate(${f(x + dx)} ${f(y)})" d="${t.d}" fill="${fill}"${opacity ? ` opacity="${opacity}"` : ""}/>`;
}

/* ============================ Logo directions ============================ */
/**
 * Each direction: symbol units (centre + scale in symbol space, 0..SYM_W),
 * its bounding box, the wordmark voice and a one-line rationale.
 */
const bbox = (units) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const u of units) for (const [x, y] of rhombusPts(u.c[0], u.c[1], u.s)) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
};

// Direction 04: an emblem rhombus whose lower edges run parallel to the V's outer edges at one unit gap.
const GAP = 16.18; // perpendicular gap between neighbouring units in the master
function emblemFrame() {
  const sin = Math.sin(ANGLE);
  const bottom = [178.05, SYM_H + GAP / sin];
  // Upper-left edge of the outer-left unit, offset outward by GAP; intersect with the frame's lower-left edge.
  const n = [-RH, -RW].map((v) => v / Math.hypot(RH, RW)); // outward normal of the upper-left edge
  const p = [0 + n[0] * GAP, RH + n[1] * GAP]; // a point on the offset upper-left edge (from the unit's left vertex)
  const d1 = [RW, -RH]; // upper-left edge direction
  const d2 = [-RW, -RH]; // lower-left edge direction (from the bottom vertex)
  // Solve p + t d1 = bottom + u d2
  const det = d1[0] * -d2[1] - d1[1] * -d2[0];
  const rx = bottom[0] - p[0];
  const ry = bottom[1] - p[1];
  const t = (rx * -d2[1] - ry * -d2[0]) / det;
  const left = [p[0] + t * d1[0], p[1] + t * d1[1]];
  const hw = 178.05 - left[0];
  const hh = bottom[1] - left[1];
  return { cx: 178.05, cy: left[1], hw, hh };
}
const FRAME = emblemFrame();

const DIRECTIONS = [
  {
    id: "01",
    name: "Formation",
    line: "The master symbol, unchanged: five identical units, one lattice, one direction. Calm, exact, proven at every size.",
    units: UNITS.map((u) => ({ c: u.c, s: 1 })),
    word: { font: "semibold", tracking: 0.16 },
    banner: "architectural",
  },
  {
    id: "02",
    name: "Monolith",
    line: "The same five units, enlarged until the gaps become hairline cuts. One solid mark that reads from a billboard down to a 16 px tab.",
    units: UNITS.map((u) => ({ c: u.c, s: 1.12 })),
    word: { font: "bold", tracking: 0.06 },
    banner: "editorial",
  },
  {
    id: "03",
    name: "Signal",
    line: "The units grow from the tip outward: one post becomes many. The formation is the idea of virality itself, drawn on the same lattice.",
    units: UNITS.map((u) => ({ c: u.c, s: [0.62, 0.81, 1][u.rank] })),
    word: { font: "medium", tracking: 0.24 },
    banner: "abstract",
  },
  {
    id: "04",
    name: "Seal",
    line: "The formation set in its own outline: the frame's lower edges run parallel to the V at exactly one unit gap. A seal for apps, avatars and documents.",
    units: UNITS.map((u) => ({ c: u.c, s: 1 })),
    frame: true,
    word: { font: "monoMedium", tracking: 0.14 },
    banner: "technical",
  },
];

/** Symbol markup for a direction, fitted into a box (x, y, height). knock: colour of the knockout for the seal. */
function symbolSvg(dir, x, y, h, fill = "#fff", knock = "#000") {
  if (dir.frame) {
    const fb = { x0: FRAME.cx - FRAME.hw, y0: FRAME.cy - FRAME.hh, w: FRAME.hw * 2, h: FRAME.hh * 2 };
    const s = h / fb.h;
    const framePath = `M${pts(rhombusPts(FRAME.cx, FRAME.cy, FRAME.hw / RW))}Z`;
    const v = dir.units.map((u) => rhombus(u.c[0], u.c[1], u.s)).join("");
    // One path, even-odd: the V is cut out of the frame, so it shows whatever is behind it.
    return `<path transform="translate(${f(x - fb.x0 * s)} ${f(y - fb.y0 * s)}) scale(${f(s * 1000) / 1000})" d="${framePath}${v}" fill="${fill}" fill-rule="evenodd"/>`;
  }
  const b = bbox(dir.units);
  const s = h / b.h;
  const d = dir.units.map((u) => rhombus(u.c[0], u.c[1], u.s)).join("");
  return `<path transform="translate(${f(x - b.x0 * s)} ${f(y - b.y0 * s)}) scale(${f(s * 1000) / 1000})" d="${d}" fill="${fill}"/>`;
}
function symbolAspect(dir) {
  if (dir.frame) return FRAME.hw / FRAME.hh;
  const b = bbox(dir.units);
  return b.w / b.h;
}
/** Wordmark outlines for a direction at a cap height. Returns { svg(x, baseline, fill), width }. */
function wordmark(dir, capH) {
  const font = FONTS[dir.word.font];
  const probe = text(font, "VYRAL", 100, dir.word.tracking);
  const size = (capH / probe.capHeight) * 100;
  const t = text(font, "VYRAL", size, dir.word.tracking);
  return {
    width: t.width,
    svg: (x, y, fill = "#fff") => `<path transform="translate(${f(x)} ${f(y)})" d="${t.d}" fill="${fill}"/>`,
  };
}
/** Horizontal lockup: symbol + wordmark, cap height = 0.42 × symbol height, gap = 0.5 × symbol width. */
function lockup(dir, x, y, h, fill = "#fff", knock = "#000") {
  const symW = h * symbolAspect(dir);
  const wm = wordmark(dir, h * 0.42);
  const gap = h * 0.36;
  const baseline = y + h / 2 + (h * 0.42) / 2;
  return {
    svg: symbolSvg(dir, x, y, h, fill, knock) + wm.svg(x + symW + gap, baseline, fill),
    width: symW + gap + wm.width,
  };
}

/* ========================== Background elements ========================== */
const grain = (id, opacity = 0.06) => `
  <filter id="${id}" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 ${opacity} 0"/>
  </filter>`;
/** Fine grid: minor and major lines. */
function grid(w, h, step, major, minorC = "#0c0c0c", majorC = "#151515") {
  let d1 = "", d2 = "";
  for (let x = 0; x <= w; x += step) (x % major === 0 ? (d2 += `M${x} 0V${h}`) : (d1 += `M${x} 0V${h}`));
  for (let y = 0; y <= h; y += step) (y % major === 0 ? (d2 += `M0 ${y}H${w}`) : (d1 += `M0 ${y}H${w}`));
  return `<path d="${d1}" stroke="${minorC}" stroke-width="1" fill="none"/><path d="${d2}" stroke="${majorC}" stroke-width="1" fill="none"/>`;
}
/** Orbit arcs (concentric circles), solid or dashed. */
const orbits = (cx, cy, radii, stroke, dash) =>
  radii.map((r) => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="none" stroke="${stroke}" stroke-width="1"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`).join("");
/** Lattice of rhombus outlines or fills around (ox, oy). */
function lattice(ox, oy, s, range, keep, render) {
  let outStr = "";
  for (let i = -range; i <= range; i++) for (let j = -range; j <= range; j++) {
    const cx = ox + (A[0] * i + B[0] * j) * s;
    const cy = oy + (A[1] * i + B[1] * j) * s;
    if (keep(cx, cy, i, j)) outStr += render(cx, cy, i, j);
  }
  return outStr;
}
/** Construction lines along both arms through a point, clipped to the canvas by extent. */
function armLines(px, py, len, stroke, dash) {
  const dx = Math.sin(ANGLE) * len, dy = Math.cos(ANGLE) * len;
  return `<path d="M${f(px - dx)} ${f(py - dy)}L${f(px + dx)} ${f(py + dy)}M${f(px + dx)} ${f(py - dy)}L${f(px - dx)} ${f(py + dy)}" stroke="${stroke}" stroke-width="1"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
}

/* ================================ Banners ================================ */
const W = 1500, H = 500;
const banners = {};

/* A · Architectural: a horizon, the V's arms extended into the sky, the mark rising on a lattice trail. */
banners.architectural = (dir) => {
  const hcx = 1060, hR = 1500, hcy = 470 + hR; // horizon apex at (1060, 470)
  const symH = 210, symW = symH * symbolAspect(dir);
  const sx = hcx - symW / 2, sy = 95;
  const tip = [hcx, sy + symH];
  // Trail: lattice units below the tip, shrinking toward the horizon.
  let trail = "";
  const s0 = symH / SYM_H;
  for (let k = 1; k <= 3; k++) {
    const cy = tip[1] - RH * s0 + k * A[1] * s0 * 1.0;
    const sc = s0 * (1 - k * 0.24);
    trail += `<path d="${rhombus(hcx, cy, sc)}" fill="#fff" opacity="${f(0.5 - k * 0.13)}"/>`;
  }
  return `
  <defs>
    ${grain("g", 0.05)}
    <radialGradient id="sky" cx="0.707" cy="0.96" r="0.55">
      <stop offset="0" stop-color="#3a3a3a"/>
      <stop offset="0.35" stop-color="#141414"/>
      <stop offset="1" stop-color="#000"/>
    </radialGradient>
    <radialGradient id="atmo" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fff" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rim" x1="0" x2="1">
      <stop offset="0.25" stop-color="#fff" stop-opacity="0"/>
      <stop offset="0.707" stop-color="#fff" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0.1"/>
    </linearGradient>
    <linearGradient id="fadeL" x1="0" x2="1"><stop offset="0.35" stop-color="#fff" stop-opacity="0"/><stop offset="0.7" stop-color="#fff"/></linearGradient>
    <mask id="mL"><rect width="${W}" height="${H}" fill="url(#fadeL)"/></mask>
    <clipPath id="sky"><rect width="${W}" height="${H}"/></clipPath>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <g mask="url(#mL)">
    ${armLines(tip[0], tip[1], 900, "#262626")}
    ${armLines(tip[0], tip[1] - 2 * A[1] * s0, 900, "#1a1a1a", "2 6")}
    ${lattice(hcx, tip[1] - RH * s0, s0, 9, (cx, cy) => cy < 470 && cy > -60 && Math.abs(cx - hcx) < 520, (cx, cy) => `<path d="${rhombus(cx, cy, s0)}" fill="none" stroke="#161616"/>`)}
  </g>
  <ellipse cx="${hcx}" cy="470" rx="520" ry="60" fill="url(#atmo)"/>
  <circle cx="${hcx}" cy="${hcy}" r="${hR}" fill="#020202"/>
  <circle cx="${hcx}" cy="${hcy}" r="${hR}" fill="none" stroke="url(#rim)" stroke-width="2.5"/>
  <circle cx="${hcx}" cy="${hcy}" r="${hR - 26}" fill="none" stroke="#141414" stroke-width="1"/>
  <!--fg-->${trail}
  ${symbolSvg(dir, sx, sy, symH)}
  ${wordmark(dir, 40).svg(132, 214)}
  ${textAt(FONTS.mono, "THE VIRAL LAUNCHPAD ON SOLANA", 14, 134, 256, { tracking: 0.12, fill: "#8a8a8a" })}<!--/fg-->
  <rect width="${W}" height="${H}" filter="url(#g)"/>`;
};

/* B · Abstract geometric: three lattices at three scales, layered; the formation spreads out of them. */
banners.abstract = (dir) => {
  const symH = 230, symW = symH * symbolAspect(dir);
  const sx = 1080 - symW / 2, sy = (H - symH) / 2 - 4;
  const o = [1080, sy + symH * 0.77];
  const layer = (s, fill, stroke, keep) => lattice(o[0], o[1], s, 12, keep, (cx, cy) => `<path d="${rhombus(cx, cy, s * 0.98)}" fill="${fill}" stroke="${stroke}"/>`);
  const inView = (pad) => (cx, cy) => cx > 380 - pad && cx < W + pad && cy > -pad && cy < H + pad;
  return `
  <defs>
    ${grain("g", 0.06)}
    <linearGradient id="fadeL" x1="0" x2="1"><stop offset="0.25" stop-color="#fff" stop-opacity="0"/><stop offset="0.62" stop-color="#fff"/></linearGradient>
    <mask id="mL"><rect width="${W}" height="${H}" fill="url(#fadeL)"/></mask>
    <radialGradient id="pool" cx="0.72" cy="0.55" r="0.5"><stop offset="0" stop-color="#1b1b1b"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#000"/>
  <rect width="${W}" height="${H}" fill="url(#pool)"/>
  <g mask="url(#mL)">
    ${layer(2.6, "#070707", "#0f0f0f", inView(400))}
    ${layer(1.3, "none", "#191919", inView(200))}
    ${layer(0.65, "none", "#202020", (cx, cy, i, j) => inView(100)(cx, cy) && (i + j) % 2 === 0)}
    ${orbits(1080, 250, [300, 420], "#262626", "1 7")}
  </g>
  <!--fg-->${symbolSvg(dir, sx, sy, symH)}
  ${wordmark(dir, 38).svg(132, 212)}
  ${textAt(FONTS.mono, "LAUNCH · CREATE · COMPETE", 14, 134, 254, { tracking: 0.12, fill: "#8a8a8a" })}<!--/fg-->
  <rect width="${W}" height="${H}" filter="url(#g)"/>`;
};

/* C · Technical / financial: grid, orbits around the seal, checkpoint timeline, the scoring formula. */
banners.technical = (dir) => {
  const symH = 250, symW = symH * symbolAspect(dir);
  const cx = 1110, cy = 238;
  const sx = cx - symW / 2, sy = cy - symH / 2;
  const radii = [178, 232, 300, 380];
  // Markers on the orbits: small rhombi at fixed angles, each with a label.
  const marker = (r, deg, label, anchor = "start") => {
    const a = (deg * Math.PI) / 180;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    const lx = x + (anchor === "start" ? 14 : -14);
    return `<path d="${rhombus(x, y, 0.06)}" fill="#d0d0d0"/>${textAt(FONTS.mono, label, 11, lx, y + 4, { tracking: 0.1, fill: "#6e6e6e", anchor })}`;
  };
  // Checkpoint timeline along the bottom right: 24 h, a tick each hour, longer every 6 h.
  let ticks = "";
  const t0 = 610, t1 = 1410, ty = 452;
  for (let hgt = 0; hgt <= 24; hgt++) {
    const x = t0 + ((t1 - t0) * hgt) / 24;
    const long = hgt % 6 === 0;
    ticks += `<path d="M${f(x)} ${ty}v${long ? -12 : -5}" stroke="${long ? "#5c5c5c" : "#2c2c2c"}"/>`;
    if (long) ticks += textAt(FONTS.mono, `${String(hgt).padStart(2, "0")}:00`, 10, x, ty + 16, { fill: "#555", anchor: "middle", tracking: 0.08 });
  }
  return `
  <defs>
    ${grain("g", 0.04)}
    <radialGradient id="floor" cx="0.74" cy="1.25" r="0.75"><stop offset="0" stop-color="#262626"/><stop offset="0.55" stop-color="#0a0a0a"/><stop offset="1" stop-color="#000"/></radialGradient>
    <linearGradient id="fadeL" x1="0" x2="1"><stop offset="0.3" stop-color="#fff" stop-opacity="0"/><stop offset="0.6" stop-color="#fff"/></linearGradient>
    <mask id="mL"><rect width="${W}" height="${H}" fill="url(#fadeL)"/></mask>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#floor)"/>
  <g mask="url(#mL)">
    ${grid(W, H, 20, 100, "#0b0b0b", "#141414")}
    ${orbits(cx, cy, radii, "#2a2a2a", null)}
    ${orbits(cx, cy, [205, 265, 340], "#1f1f1f", "2 6")}
  </g>
  <!--fg-->${marker(232, -55, "CHECKPOINT · EVERY 6 H")}
  ${marker(300, 200, "VERIFIED VIEWS ≥ 500", "end")}
  ${marker(380, 160, "50 / 50 · LOCKED ON-CHAIN", "end")}
  ${symbolSvg(dir, sx, sy, symH, "#fff", "#000")}
  <path d="M${t0} ${ty}H${t1}" stroke="#2c2c2c"/>${ticks}
  ${wordmark(dir, 36).svg(132, 206)}
  ${textAt(FONTS.mono, "C(x) = 100 × log10(1 + x) / log10(1 + ceiling)", 13, 134, 246, { tracking: 0.04, fill: "#7c7c7c" })}<!--/fg-->
  <rect width="${W}" height="${H}" filter="url(#g)"/>`;
};

/* D · Editorial: an oversized cropped mark, a headline in the brand voice, print marks. */
banners.editorial = (dir) => {
  const symH = 640, symW = symH * symbolAspect(dir);
  const sx = 1230 - symW / 2, sy = -70;
  const head = (str, y) => textAt(FONTS.bold, str, 58, 130, y, { tracking: -0.02 });
  return `
  <defs>
    ${grain("g", 0.07)}
    <linearGradient id="tone" x1="0" x2="1"><stop offset="0" stop-color="#050505"/><stop offset="1" stop-color="#101010"/></linearGradient>
    <linearGradient id="fadeE" x1="0" x2="1"><stop offset="0.2" stop-color="#fff" stop-opacity="0"/><stop offset="0.6" stop-color="#fff"/></linearGradient>
    <mask id="mE"><rect width="${W}" height="${H}" fill="url(#fadeE)"/></mask>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#tone)"/>
  <g mask="url(#mE)">${(() => {
    // The oversized mark's own lattice, continued across the page as hairlines.
    const b = bbox(dir.units);
    const sc = (symH / b.h) * dir.units[0].s;
    const ox = sx - b.x0 * (symH / b.h) + 178.05 * (symH / b.h);
    const oy = sy - b.y0 * (symH / b.h) + 284.945 * (symH / b.h);
    return lattice(ox, oy, symH / b.h, 6, (cx, cy) => cy > -400 && cy < H + 400, (cx, cy) => `<path d="${rhombus(cx, cy, sc)}" fill="none" stroke="#1b1b1b" stroke-width="1.2"/>`);
  })()}</g>
  <!--fg-->${symbolSvg(dir, sx, sy, symH)}<!--/fg-->
  <path d="M60 40h24M60 40v24M${W - 60} ${H - 40}h-24M${W - 60} ${H - 40}v-24" stroke="#3a3a3a" stroke-width="1.5" fill="none"/>
  <!--fg-->${textAt(FONTS.monoMedium, "VYRAL — 001", 12, 130, 92, { tracking: 0.16, fill: "#7a7a7a" })}
  ${head("Launch.", 166)}${head("Create.", 230)}${head("Compete.", 294)}
  ${textAt(FONTS.mono, "THE VIRAL LAUNCHPAD ON SOLANA", 12, 820, 92, { tracking: 0.16, fill: "#5e5e5e", anchor: "end" })}<!--/fg-->
  <rect width="${W}" height="${H}" filter="url(#g)"/>`;
};

/* ============================ Presentation sheet ============================ */
function sheet(dir) {
  const SW = 2400, SH = 1700;
  const pad = 80;
  const tile = (x, y, w, h, bg, inner, label, labelC = "#7a7a7a") =>
    `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bg}"/>${inner}${textAt(FONTS.mono, label, 14, x, y + h + 30, { tracking: 0.1, fill: labelC })}</g>`;
  // Row 1: symbol black / symbol white / profile icon / scale test.
  const r1y = 250, r1h = 520, tw = 500;
  const symIn = (x, y, w, h, fill, knock) => {
    const sh = h * 0.5, swd = sh * symbolAspect(dir);
    return symbolSvg(dir, x + (w - swd) / 2, y + (h - sh) / 2, sh, fill, knock);
  };
  const icon = (() => {
    const x = pad + 2 * (tw + 40), y = r1y;
    const r = tw / 2 - 30;
    const sh = r * 0.95, swd = sh * symbolAspect(dir);
    return `<rect x="${x}" y="${y}" width="${tw}" height="${r1h}" fill="#0d0d0d"/><circle cx="${x + tw / 2}" cy="${y + r1h / 2}" r="${r}" fill="#000"/>${symbolSvg(dir, x + tw / 2 - swd / 2, y + r1h / 2 - sh / 2 + sh * 0.03, sh)}`;
  })();
  let scale = "";
  {
    const x0 = pad + 3 * (tw + 40), w = SW - pad - x0;
    scale += `<rect x="${x0}" y="${r1y}" width="${w}" height="${r1h}" fill="#000"/>`;
    let cx = x0 + 60;
    for (const s of [160, 64, 32, 24, 16]) {
      const swd = s * symbolAspect(dir);
      scale += symbolSvg(dir, cx, r1y + r1h / 2 - s / 2, s);
      scale += textAt(FONTS.mono, `${s}px`, 12, cx + swd / 2, r1y + r1h / 2 + 110, { fill: "#5a5a5a", anchor: "middle" });
      cx += swd + 52;
    }
  }
  // Row 2: lockup on black, lockup on white.
  const r2y = 850, r2h = 260, lw = (SW - pad * 2 - 40) / 2;
  const lockBlack = lockup(dir, 0, 0, 92);
  const lockWhite = lockup(dir, 0, 0, 92, "#000", "#fff");
  const lockIn = (x, l, fill, knock) => lockup(dir, x + (lw - l.width) / 2, r2y + (r2h - 92) / 2, 92, fill, knock).svg;
  // Row 3: banner + background element swatch.
  const r3y = 1190, bw = 1500 * 0.92, bh = 500 * 0.92;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SW}" height="${SH}" viewBox="0 0 ${SW} ${SH}">
  <rect width="${SW}" height="${SH}" fill="#080808"/>
  ${textAt(FONTS.mono, `DIRECTION ${dir.id}`, 16, pad, 100, { tracking: 0.2, fill: "#6a6a6a" })}
  ${textAt(FONTS.semibold, dir.name, 54, pad, 168, { tracking: -0.01 })}
  ${textAt(FONTS.regular, dir.line, 21, pad + 520, 160, { fill: "#9a9a9a" })}
  ${tile(pad, r1y, tw, r1h, "#000", symIn(pad, r1y, tw, r1h, "#fff", "#000"), "SYMBOL · WHITE ON BLACK")}
  ${tile(pad + tw + 40, r1y, tw, r1h, "#fff", symIn(pad + tw + 40, r1y, tw, r1h, "#000", "#fff"), "SYMBOL · BLACK ON WHITE")}
  ${icon}${textAt(FONTS.mono, "PROFILE ICON", 14, pad + 2 * (tw + 40), r1y + r1h + 30, { tracking: 0.1, fill: "#7a7a7a" })}
  ${scale}${textAt(FONTS.mono, "SCALE · 160 → 16 PX", 14, pad + 3 * (tw + 40), r1y + r1h + 30, { tracking: 0.1, fill: "#7a7a7a" })}
  ${tile(pad, r2y, lw, r2h, "#000", lockIn(pad, lockBlack, "#fff", "#000"), "HORIZONTAL LOCKUP · ON BLACK")}
  ${tile(pad + lw + 40, r2y, lw, r2h, "#fff", lockIn(pad + lw + 40, lockWhite, "#000", "#fff"), "HORIZONTAL LOCKUP · ON WHITE")}
  <image x="${pad}" y="${r3y}" width="${bw}" height="${bh}" href="BANNER"/>
  ${textAt(FONTS.mono, `X BANNER · ${dir.banner.toUpperCase()}`, 14, pad, r3y + bh + 30, { tracking: 0.1, fill: "#7a7a7a" })}
  <image x="${pad + bw + 40}" y="${r3y}" width="${SW - pad * 2 - bw - 40}" height="${bh}" href="SWATCH" preserveAspectRatio="xMidYMid slice"/>
  ${textAt(FONTS.mono, "BACKGROUND ELEMENT", 14, pad + bw + 40, r3y + bh + 30, { tracking: 0.1, fill: "#7a7a7a" })}
</svg>`;
}

/* ================================= Output ================================= */
const svgDoc = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const browser = await chromium.launch();
async function png(svg, w, h, file, scale = 1) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`, { waitUntil: "load" });
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: w, height: h }, omitBackground: true });
  await page.close();
}
const dataUri = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;

for (const dir of DIRECTIONS) {
  const d = join(OUT, `direction-${dir.id}-${dir.name.toLowerCase()}`);
  mkdirSync(d, { recursive: true });
  const asp = symbolAspect(dir);
  // Symbol (transparent background), white and black.
  const symH = 1000, symW = Math.round(symH * asp);
  for (const [name, fill, knock] of [["white", "#fff", "#000"], ["black", "#000", "#fff"]]) {
    void knock;
    const svg = svgDoc(symW, symH, symbolSvg(dir, 0, 0, symH, fill));
    writeFileSync(join(d, `symbol-${name}.svg`), svg);
    await png(svg, symW, symH, join(d, `symbol-${name}.png`));
  }
  // Wordmark and lockups.
  for (const [name, fill, knock, bg] of [["white", "#fff", "#000", "#000"], ["black", "#000", "#fff", "#fff"]]) {
    const wm = wordmark(dir, 120);
    const wsvg = svgDoc(Math.ceil(wm.width) + 2, 124, wm.svg(1, 122, fill));
    writeFileSync(join(d, `wordmark-${name}.svg`), wsvg);
    const l = lockup(dir, 0, 0, 200, fill, knock);
    const lw = Math.ceil(l.width) + 4;
    const lsvg = svgDoc(lw, 200, lockup(dir, 2, 0, 200, fill, knock).svg);
    writeFileSync(join(d, `lockup-${name}.svg`), lsvg);
    await png(svgDoc(lw + 160, 360, `<rect width="${lw + 160}" height="360" fill="${bg}"/>${lockup(dir, 80, 80, 200, fill, knock).svg}`), lw + 160, 360, join(d, `lockup-on-${name === "white" ? "black" : "white"}.png`));
  }
  // Profile icon (X crops to a circle).
  {
    const S = 1000, sh = 600, swd = sh * asp;
    const isvg = svgDoc(S, S, `<rect width="${S}" height="${S}" fill="#000"/>${symbolSvg(dir, (S - swd) / 2, (S - sh) / 2 + sh * 0.03, sh)}`);
    writeFileSync(join(d, "profile-icon.svg"), isvg);
    await png(isvg, S, S, join(d, "profile-icon-1000.png"));
  }
  // Banner.
  const bsvg = svgDoc(W, H, banners[dir.banner](dir));
  writeFileSync(join(d, `x-banner-${dir.banner}.svg`), bsvg);
  await png(bsvg, W, H, join(d, `x-banner-${dir.banner}.png`));
  await png(bsvg, W, H, join(d, `x-banner-${dir.banner}@2x.png`), 2);
  // Background element swatch: the banner's background without logo and type.
  const swatch = bsvg.replace(/<!--fg-->[\s\S]*?<!--\/fg-->/g, "");
  await png(swatch, W, H, join(d, "background-element.png"));
  // Presentation sheet.
  const sheetSvg = sheet(dir).replace("BANNER", dataUri(join(d, `x-banner-${dir.banner}@2x.png`))).replace("SWATCH", dataUri(join(d, "background-element.png")));
  await png(sheetSvg, 2400, 1700, join(d, `presentation-direction-${dir.id}.png`));
  console.log("direction", dir.id, dir.name, "done");
}
await browser.close();
