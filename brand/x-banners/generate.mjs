/**
 * VYRAL X/Twitter banners (1500 × 500), four art directions.
 * Every shape comes from the master symbol: five identical rhombi on one
 * lattice. The lattice vectors run along the two arms of the V, so any
 * rhombus placed on it belongs to the same geometric system as the logo.
 *
 *   node brand/x-banners/generate.mjs        -> out/*.png (1500×500 and @2x)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const out = join(here, "out");
mkdirSync(out, { recursive: true });

const W = 1500;
const H = 500;

/* ---------------------------- Symbol geometry ---------------------------- */
// Master symbol (viewBox 356.11 × 369.75): rhombus half-diagonals and lattice step.
const RW = 52.99; // half width of one unit
const RH = 84.805; // half height of one unit
const A = [62.53, 100.07]; // lattice step down the right arm
const B = [-62.53, 100.07]; // lattice step down the left arm
// Unit centres in symbol space: outer pair, inner pair, tip.
const UNITS = [
  [52.99, 84.805],
  [303.11, 84.805],
  [115.52, 184.875],
  [240.58, 184.875],
  [178.05, 284.945],
];
const SYM_W = 356.11;
const SYM_H = 369.75;

const f = (n) => Math.round(n * 100) / 100;
/** Rhombus with centre (cx, cy) at scale s. */
const rhombus = (cx, cy, s) => `M${f(cx)} ${f(cy - RH * s)}L${f(cx + RW * s)} ${f(cy)}L${f(cx)} ${f(cy + RH * s)}L${f(cx - RW * s)} ${f(cy)}Z`;
/** The symbol placed with its bounding box top-left at (x, y), height h. */
function symbol(x, y, h) {
  const s = h / SYM_H;
  return UNITS.map(([ux, uy]) => ({ cx: x + ux * s, cy: y + uy * s, s }));
}
/** Lattice points (i, j) around an origin, at scale s. */
function lattice(ox, oy, s, range, keep = () => true) {
  const pts = [];
  for (let i = -range; i <= range; i++) {
    for (let j = -range; j <= range; j++) {
      const cx = ox + (A[0] * i + B[0] * j) * s;
      const cy = oy + (A[1] * i + B[1] * j) * s;
      if (keep(cx, cy, i, j)) pts.push({ cx, cy, s, i, j });
    }
  }
  return pts;
}
const inView = (pad) => (cx, cy) => cx > -pad && cx < W + pad && cy > -pad && cy < H + pad;

/** Facets of a rhombus (top-left, top-right, bottom-right, bottom-left triangles). */
function facets(cx, cy, s) {
  const t = [cx, cy - RH * s];
  const r = [cx + RW * s, cy];
  const b = [cx, cy + RH * s];
  const l = [cx - RW * s, cy];
  const c = [cx, cy];
  const tri = (p, q) => `M${f(p[0])} ${f(p[1])}L${f(q[0])} ${f(q[1])}L${f(c[0])} ${f(c[1])}Z`;
  return { tl: tri(l, t), tr: tri(t, r), br: tri(r, b), bl: tri(b, l) };
}

/* ------------------------------- Typography ------------------------------- */
const fontData = (file) => `data:font/woff2;base64,${readFileSync(join(root, "node_modules/geist/dist/fonts", file)).toString("base64")}`;
const fontCss = `
@font-face { font-family: Geist; font-weight: 600; src: url(${fontData("geist-sans/Geist-SemiBold.woff2")}) format("woff2"); }
@font-face { font-family: GeistMono; font-weight: 400; src: url(${fontData("geist-mono/GeistMono-Regular.woff2")}) format("woff2"); }
`;
const wordmark = (x, y, size, fill = "#fff", anchor = "start") =>
  `<text x="${x}" y="${y}" fill="${fill}" font-family="Geist" font-weight="600" font-size="${size}" letter-spacing="${size * 0.16}" text-anchor="${anchor}">VYRAL</text>`;
const mono = (x, y, size, text, fill, anchor = "start", spacing = 0.08) =>
  `<text x="${x}" y="${y}" fill="${fill}" font-family="GeistMono" font-size="${size}" letter-spacing="${size * spacing}" text-anchor="${anchor}">${text}</text>`;

/* -------------------------------- Concepts -------------------------------- */
const concepts = {};

/* 01 Architectural Minimalism: the logo as five filled cells of its own lattice. */
concepts["01-architectural-minimalism"] = () => {
  const h = 330;
  const sym = symbol(1180 - (SYM_W * h) / SYM_H / 2, (H - h) / 2 + 4, h);
  const s = sym[0].s;
  const [ox, oy] = [sym[4].cx, sym[4].cy]; // lattice anchored on the tip
  const grid = lattice(ox, oy, s, 14, inView(120));
  const isLogo = (p) => sym.some((u) => Math.hypot(u.cx - p.cx, u.cy - p.cy) < 1);
  const cells = grid
    .filter((p) => !isLogo(p))
    .map((p) => `<path d="${rhombus(p.cx, p.cy, s)}" />`)
    .join("");
  return `
  <defs>
    <linearGradient id="fade" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0.28" stop-color="#fff" stop-opacity="0"/>
      <stop offset="0.62" stop-color="#fff" stop-opacity="1"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0.55"/>
    </linearGradient>
    <mask id="m"><rect width="${W}" height="${H}" fill="url(#fade)"/></mask>
  </defs>
  <rect width="${W}" height="${H}" fill="#000"/>
  <g mask="url(#m)" fill="none" stroke="#343434" stroke-width="1">${cells}</g>
  <g fill="#fff">${sym.map((u) => `<path d="${rhombus(u.cx, u.cy, u.s)}"/>`).join("")}</g>
  ${wordmark(132, 206, 58)}
  <rect x="134" y="232" width="36" height="1" fill="#4a4a4a"/>
  ${mono(134, 266, 15, "THE VIRAL LAUNCHPAD ON SOLANA", "#8c8c8c")}`;
};

/* 02 Geometric Depth: the units as engineered slabs with real thickness, over a deeper, larger formation. */
concepts["02-geometric-depth"] = () => {
  /** A rhombus slab: top face plus the two lower side faces of its thickness (light from the top left). */
  const slab = (u, depth, c) => {
    const T = [u.cx, u.cy - RH * u.s];
    const R = [u.cx + RW * u.s, u.cy];
    const Bm = [u.cx, u.cy + RH * u.s];
    const L = [u.cx - RW * u.s, u.cy];
    const d = (p) => [p[0], p[1] + depth];
    const poly = (pts, fill) => `<path d="M${pts.map((q) => `${f(q[0])} ${f(q[1])}`).join("L")}Z" fill="${fill}"/>`;
    return poly([L, Bm, d(Bm), d(L)], c.left) + poly([Bm, R, d(R), d(Bm)], c.right) + poly([T, R, Bm, L], c.top);
  };
  const ghostH = 820;
  const ghost = symbol(1150 - (SYM_W * ghostH) / SYM_H / 2, -250, ghostH);
  const midH = 520;
  const mid = symbol(1090 - (SYM_W * midH) / SYM_H / 2, -95, midH);
  const h = 290;
  const sym = symbol(1050 - (SYM_W * h) / SYM_H / 2, (H - h) / 2 - 2, h);
  const shadow = sym.map((u) => `<path d="${rhombus(u.cx + 8, u.cy + 30, u.s)}"/>`).join("");
  return `
  <defs>
    <radialGradient id="bg" cx="0.7" cy="0.42" r="0.8">
      <stop offset="0" stop-color="#121212"/>
      <stop offset="1" stop-color="#000"/>
    </radialGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="12"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <g>${ghost.map((u) => slab(u, 34, { top: "#0c0c0c", left: "#090909", right: "#050505" })).join("")}</g>
  <g>${mid.map((u) => slab(u, 22, { top: "#181818", left: "#121212", right: "#0a0a0a" })).join("")}</g>
  <g fill="#000" opacity="0.9" filter="url(#soft)">${shadow}</g>
  <g>${sym.map((u) => slab(u, 14, { top: "#ffffff", left: "#a3a3a3", right: "#5e5e5e" })).join("")}</g>
  ${wordmark(132, 212, 54)}
  ${mono(134, 254, 15, "LAUNCH · CREATE · GET PAID", "#7d7d7d")}`;
};

/* 03 Abstract Technical System: the construction of the mark as a technical drawing. */
concepts["03-technical-system"] = () => {
  const h = 290;
  const symX = 1110 - (SYM_W * h) / SYM_H / 2;
  const symY = (H - h) / 2 + 8;
  const sym = symbol(symX, symY, h);
  const s = sym[0].s;
  const angle = Math.atan2(A[0], A[1]); // 32° from vertical
  const tan = Math.tan(angle);
  // Construction lines through every unit edge, running along both arms across the banner.
  const lines = new Set();
  for (const u of sym) {
    for (const [px, py] of [
      [u.cx, u.cy - RH * s],
      [u.cx, u.cy + RH * s],
    ]) {
      for (const dir of [1, -1]) {
        const x0 = px - dir * tan * py;
        const x1 = px + dir * tan * (H - py);
        lines.add(`M${f(x0)} 0L${f(x1)} ${H}`);
      }
    }
  }
  // Lattice nodes (unit centres) across the right half, as a quiet field.
  const nodes = lattice(sym[4].cx, sym[4].cy, s, 12, (cx, cy) => cx > 560 && cx < W - 40 && cy > 40 && cy < H - 40)
    .map((p) => `<rect x="${f(p.cx - 1.5)}" y="${f(p.cy - 1.5)}" width="3" height="3" fill="#4a4a4a" transform="rotate(45 ${f(p.cx)} ${f(p.cy)})"/>`)
    .join("");
  const outline = lattice(sym[4].cx, sym[4].cy, s, 3)
    .filter((p) => !sym.some((u) => Math.hypot(u.cx - p.cx, u.cy - p.cy) < 1))
    .filter((p) => Math.abs(p.cx - 1110) < 330 && p.cy > -60 && p.cy < H + 60)
    .map((p) => `<path d="${rhombus(p.cx, p.cy, s)}"/>`)
    .join("");
  // Dimension line under the mark: real proportions of the master.
  const dimY = symY + h + 26;
  const x0 = symX;
  const x1 = symX + SYM_W * s;
  return `
  <defs>
    <linearGradient id="fade" x1="0" x2="1">
      <stop offset="0.3" stop-color="#fff" stop-opacity="0"/>
      <stop offset="0.6" stop-color="#fff" stop-opacity="1"/>
    </linearGradient>
    <mask id="m"><rect width="${W}" height="${H}" fill="url(#fade)"/></mask>
  </defs>
  <rect width="${W}" height="${H}" fill="#000"/>
  <g mask="url(#m)">
    <g stroke="#262626" stroke-width="1" fill="none">${[...lines].join("")}</g>
    ${nodes}
    <g stroke="#3a3a3a" stroke-width="1" fill="none" stroke-dasharray="3 5">${outline}</g>
  </g>
  <g fill="#fff">${sym.map((u) => `<path d="${rhombus(u.cx, u.cy, u.s)}"/>`).join("")}</g>
  <g stroke="#5a5a5a" stroke-width="1">
    <path d="M${f(x0)} ${f(dimY)}H${f(x1)}"/><path d="M${f(x0)} ${f(dimY - 5)}v10"/><path d="M${f(x1)} ${f(dimY - 5)}v10"/>
  </g>
  ${mono((x0 + x1) / 2, dimY + 22, 12, "356 × 370", "#6f6f6f", "middle")}
  ${(() => {
    // Angle mark at the top vertex of the right outer unit: its right edge, extended upward, sits 32° from vertical.
    const T = [sym[1].cx, sym[1].cy - RH * s];
    const len = Math.hypot(A[0], A[1]);
    const up = [-A[0] / len, -A[1] / len]; // the edge continued up and to the left
    const r = 38;
    const ext = [T[0] + up[0] * 74, T[1] + up[1] * 74];
    const a0 = [T[0], T[1] - r];
    const a1 = [T[0] + up[0] * r, T[1] + up[1] * r];
    const mid = -Math.PI / 2 - Math.atan2(A[0], A[1]) / 2; // halfway between vertical and the edge
    const lp = [T[0] + Math.cos(mid) * (r + 18), T[1] + Math.sin(mid) * (r + 18)];
    return `<g stroke="#5a5a5a" stroke-width="1" fill="none">
      <path d="M${f(T[0])} ${f(T[1])}V${f(T[1] - 74)}" stroke-dasharray="2 4"/>
      <path d="M${f(T[0])} ${f(T[1])}L${f(ext[0])} ${f(ext[1])}" stroke-dasharray="2 4"/>
      <path d="M${f(a0[0])} ${f(a0[1])}A${r} ${r} 0 0 0 ${f(a1[0])} ${f(a1[1])}"/>
    </g>${mono(f(lp[0]), f(lp[1] + 4), 12, "32°", "#7a7a7a", "middle", 0.02)}`;
  })()}
  ${wordmark(132, 210, 56)}
  ${mono(134, 252, 15, "ONE UNIT · ONE SYSTEM · ONE DIRECTION", "#7a7a7a")}`;
};

/* 04 Bold Brand Statement: the mark at monumental scale, split across black and white. */
concepts["04-bold-statement"] = () => {
  const h = 720;
  const symW = (SYM_W * h) / SYM_H;
  const sym = symbol(750 - symW / 2, H - 36 - h, h);
  const units = sym.map((u) => `<path d="${rhombus(u.cx, u.cy, u.s)}"/>`).join("");
  return `
  <defs>
    <clipPath id="left"><rect width="750" height="${H}"/></clipPath>
    <clipPath id="right"><rect x="750" width="750" height="${H}"/></clipPath>
  </defs>
  <rect width="750" height="${H}" fill="#fff"/>
  <rect x="750" width="750" height="${H}" fill="#000"/>
  <g clip-path="url(#left)" fill="#000">${units}</g>
  <g clip-path="url(#right)" fill="#fff">${units}</g>
  ${wordmark(1368, 84, 30, "#fff", "end")}
  ${mono(1368, 112, 12, "THE VIRAL LAUNCHPAD", "#8a8a8a", "end")}`;
};

/* --------------------------------- Render --------------------------------- */
const { chromium } = require("playwright");
const browser = await chromium.launch();
for (const [name, build] of Object.entries(concepts)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${build()}</svg>`;
  writeFileSync(join(out, `${name}.svg`), svg);
  const html = `<!doctype html><html><head><style>${fontCss} html,body{margin:0;background:#000}</style></head><body>${svg}</body></html>`;
  for (const scale of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(out, `vyral-x-banner-${name}${scale === 2 ? "@2x" : ""}.png`), clip: { x: 0, y: 0, width: W, height: H } });
    await page.close();
  }
  console.log("rendered", name);
}
await browser.close();
