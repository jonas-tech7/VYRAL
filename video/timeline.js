/**
 * VYRAL launch trailer: deterministic motion timeline (1920×1080 logical,
 * rendered at 2× = 3840×2160).
 *
 * window.renderFrame(t) poses every element for time t (seconds) and resolves
 * once the frame is painted; render.mjs screenshots each frame. Timing comes
 * from cues.json, which soundtrack.py also reads. Product scenes use real
 * captures of the VYRAL site (assets/ui, made by capture.mjs); the data shown
 * in them is illustrative and labelled as such.
 */
const CUES = await (await fetch("cues.json")).json();
// Every layout measurement below needs the real fonts.
await Promise.all(["600 100px Geist", "700 100px Geist", "500 40px \"Geist Mono\""].map((f) => document.fonts.load(f)));
const ACCENT = "#2cf59e";
const stage = document.getElementById("stage");

// ================================================================ utilities

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const E = {
  lin: (x) => x,
  inQuad: (x) => x * x,
  outQuad: (x) => 1 - (1 - x) * (1 - x),
  inCubic: (x) => x * x * x,
  outCubic: (x) => 1 - (1 - x) ** 3,
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  outQuint: (x) => 1 - (1 - x) ** 5,
  inOutQuint: (x) => (x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2),
  outExpo: (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
  inExpo: (x) => (x <= 0 ? 0 : 2 ** (10 * x - 10)),
  inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  outBack: (x) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2,
};
const tw = (t, a, b, from, to, ease = E.outCubic) => lerp(from, to, ease(prog(t, a, b)));

function hash(n) {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const SVGNS = "http://www.w3.org/2000/svg";
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "style") Object.assign(e.style, v);
    else if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k === "text") e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
}
function s(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
}
const px = (n) => `${n}px`;
function place(e, x, y, w, hgt) {
  e.style.left = px(x);
  e.style.top = px(y);
  if (w != null) e.style.width = px(w);
  if (hgt != null) e.style.height = px(hgt);
  return e;
}
function blur(e, b) {
  e.style.filter = b > 0.05 ? `blur(${b.toFixed(2)}px)` : "none";
}
/** Toggle with display (a hidden parent must never leak children that are themselves "visible"). */
function show(e, on) {
  e.style.display = on ? "" : "none";
  e.style.visibility = on ? "visible" : "hidden";
}
const abs = (style = {}, ...kids) => h("div", { class: "abs", style }, ...kids);
const fmtInt = (n) => Math.round(n).toLocaleString("en-US");
function compact(n) {
  n = Math.max(0, n);
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e4) return (n / 1e3).toFixed(1) + "K";
  return fmtInt(n);
}
/** Accent-coloured final punctuation, plus a manual kern for "TT" (Geist's T crossbars touch at tight tracking). */
const dotify = (w) => w.replace(/TT/g, 'T<span class="kern">T</span>').replace(/([.?])$/, '<span class="dot">$1</span>');
const mby = document.getElementById("mby-blur");

/** Uppercase headline whose words rise out of individual masks; the last word is set in the accent colour. */
function headline(lines, { size, weight = 700, tracking = -0.03, lh = 0.98, align = "left", accentLast = true } = {}) {
  const el = h("div", { class: "hl", style: { fontSize: px(size), fontWeight: weight, letterSpacing: `${tracking}em`, lineHeight: lh, textAlign: align } });
  const words = [];
  lines.forEach((line, li) => {
    const row = h("div", { class: "hl-row" });
    const parts = line.split(" ");
    parts.forEach((w, i) => {
      if (i) row.append(document.createTextNode(" "));
      const last = accentLast && li === lines.length - 1 && i === parts.length - 1;
      const inner = h("span", { class: last ? "hl-in acc" : "hl-in", html: dotify(w) });
      row.append(h("span", { class: "hl-mask" }, inner));
      words.push(inner);
    });
    el.append(row);
  });
  return { el, words };
}
const HIDE = 128; // % of a word's height that puts it fully below its mask
function animWords(words, t, tin, { tout = Infinity, stagger = 0.06, dur = 0.6, bl = 8, times = null, outDur = 0.32, outStagger = 0.025 } = {}) {
  words.forEach((w, i) => {
    const t0 = times ? times[i] : tin + i * stagger;
    let y;
    let b;
    if (t < tout) {
      const p = prog(t, t0, t0 + dur);
      y = (1 - E.outExpo(p)) * HIDE;
      b = (1 - E.outCubic(p)) * bl;
      w.style.opacity = t >= t0 ? 1 : 0;
    } else {
      const p = prog(t, tout + i * outStagger, tout + i * outStagger + outDur);
      y = -E.inCubic(p) * HIDE;
      b = E.inCubic(p) * bl * 0.5;
      w.style.opacity = 1;
    }
    w.style.transform = `translateY(${y.toFixed(3)}%)`;
    blur(w, b);
  });
}
function fitWidth(el, maxW) {
  const w = el.getBoundingClientRect().width;
  if (w > maxW) el.style.fontSize = px(parseFloat(el.style.fontSize) * (maxW / w));
}

// ================================================================ brand geometry (src/components/brand/logo.tsx)

const SYM_W = 356.11;
const SYM_H = 369.75;
const UNITS = [
  [[178.05, 200.14], [231.04, 284.94], [178.05, 369.75], [125.06, 284.94]],
  [[115.52, 100.07], [168.51, 184.87], [115.52, 269.68], [62.53, 184.87]],
  [[240.58, 100.07], [293.58, 184.87], [240.58, 269.68], [187.59, 184.87]],
  [[52.99, 0], [105.98, 84.8], [52.99, 169.61], [0, 84.8]],
  [[303.11, 0], [356.11, 84.8], [303.11, 169.61], [250.12, 84.8]],
];
const RANK = [0, 1, 1, 2, 2];
const unitPath = (u) => "M" + u.map(([x, y]) => `${x} ${y}`).join(" L") + "Z";
const unitCenter = (u) => [(u[1][0] + u[3][0]) / 2, (u[0][1] + u[2][1]) / 2];
const SYM_PATH = UNITS.map(unitPath).join(" ");

/** Every unit edge lies on a lattice line; half-lines run outward from each edge midpoint. */
const LATTICE = (() => {
  const seen = new Set();
  const out = [];
  for (const u of UNITS) {
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = u[i];
      const [bx, by] = u[(i + 1) % 4];
      let dx = bx - ax;
      let dy = by - ay;
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;
      if (dx < 0) {
        dx = -dx;
        dy = -dy;
      }
      const key = `${dy > 0 ? "a" : "b"}:${Math.round(ax * dy - ay * dx)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      out.push([mx, my, mx + dx * 1100, my + dy * 1100]);
      out.push([mx, my, mx - dx * 1100, my - dy * 1100]);
    }
  }
  return out;
})();

/**
 * The symbol as positioned SVG. `wrap` sits at the symbol's top-left corner,
 * one unit = k px; units, outline rings, lattice and light sweeps are exposed.
 */
function buildSymbol(height, { lattice = false, sweeps = false, id }) {
  const k = height / SYM_H;
  const P = 60;
  const wrap = abs({ left: "0", top: "0", width: px(SYM_W * k), height: px(SYM_H * k), transformOrigin: "0 0" });
  const svg = s("svg", {
    viewBox: `${-P} ${-P} ${SYM_W + 2 * P} ${SYM_H + 2 * P}`,
    width: (SYM_W + 2 * P) * k,
    height: (SYM_H + 2 * P) * k,
    style: `position:absolute;left:${-P * k}px;top:${-P * k}px;overflow:visible`,
  });
  const defs = s("defs");
  svg.append(defs);
  const lines = [];
  if (lattice) {
    defs.append(
      s("radialGradient", { id: `${id}-fade`, cx: SYM_W / 2, cy: SYM_H / 2, r: 900, gradientUnits: "userSpaceOnUse" },
        s("stop", { offset: 0, "stop-color": "#fff" }),
        s("stop", { offset: 0.45, "stop-color": "#fff", "stop-opacity": 0.5 }),
        s("stop", { offset: 1, "stop-color": "#fff", "stop-opacity": 0 }),
      ),
      s("mask", { id: `${id}-mask`, maskUnits: "userSpaceOnUse", x: -1400, y: -1400, width: 3200, height: 3200 },
        s("rect", { x: -1400, y: -1400, width: 3200, height: 3200, fill: `url(#${id}-fade)` }),
      ),
    );
    const g = s("g", { mask: `url(#${id}-mask)`, stroke: "#34343c", "stroke-width": 1, fill: "none" });
    for (const [x1, y1, x2, y2] of LATTICE) {
      const l = s("line", { x1, y1, x2, y2, pathLength: 1, "vector-effect": "non-scaling-stroke", "stroke-dasharray": "1 1", "stroke-dashoffset": 1 });
      g.append(l);
      lines.push(l);
    }
    svg.append(g);
  }
  const rings = UNITS.map((u) => s("path", { d: unitPath(u), fill: "none", stroke: ACCENT, "stroke-width": 1.4, "vector-effect": "non-scaling-stroke", opacity: 0 }));
  svg.append(s("g", {}, rings));
  const units = UNITS.map((u) => {
    const path = s("path", { d: unitPath(u), fill: "#fff" });
    const g = s("g", {}, path);
    svg.append(g);
    return { g, path, c: unitCenter(u) };
  });
  const sweepRects = [];
  if (sweeps) {
    const grad = (gid, color, peak) =>
      s("linearGradient", { id: gid, x1: 0, x2: 1, y1: 0, y2: 0 },
        s("stop", { offset: 0, "stop-color": color, "stop-opacity": 0 }),
        s("stop", { offset: 0.42, "stop-color": color, "stop-opacity": peak * 0.85 }),
        s("stop", { offset: 0.5, "stop-color": color === ACCENT ? "#d9ffee" : "#ffffff", "stop-opacity": peak }),
        s("stop", { offset: 0.58, "stop-color": color, "stop-opacity": peak * 0.85 }),
        s("stop", { offset: 1, "stop-color": color, "stop-opacity": 0 }),
      );
    defs.append(grad(`${id}-sg`, ACCENT, 0.95), grad(`${id}-sw`, "#9aa0a6", 0.55), s("clipPath", { id: `${id}-clip` }, s("path", { d: SYM_PATH })));
    const clipG = s("g", { "clip-path": `url(#${id}-clip)` });
    for (const gid of [`${id}-sg`, `${id}-sw`]) {
      const r = s("rect", { x: -70, y: -500, width: 140, height: 1000, fill: `url(#${gid})`, opacity: 0 });
      clipG.append(r);
      sweepRects.push(r);
    }
    svg.append(clipG);
  }
  wrap.append(svg);
  return { wrap, svg, k, units, rings, lines, sweepRects };
}
function poseUnit(u, scale, dx = 0, dy = 0) {
  const [cx, cy] = u.c;
  u.g.setAttribute("transform", `translate(${(cx + dx).toFixed(2)} ${(cy + dy).toFixed(2)}) scale(${scale.toFixed(4)}) translate(${-cx} ${-cy})`);
}
/** Unit "slam": scales down onto its place from slightly outside the formation. */
function slamUnits(sym, t, times, { from = 1.7, travel = 26, dur = 0.34 } = {}) {
  sym.units.forEach((u, i) => {
    const t0 = times[RANK[i]];
    const p = prog(t, t0, t0 + dur);
    const e = E.outExpo(p);
    const [cx, cy] = u.c;
    const dirX = cx - SYM_W / 2;
    const dirY = cy - SYM_H / 2;
    const len = Math.hypot(dirX, dirY) || 1;
    poseUnit(u, lerp(from, 1, e), ((1 - e) * travel * dirX) / len, ((1 - e) * travel * dirY) / len);
    u.path.setAttribute("opacity", t >= t0 ? clamp((t - t0) / 0.035) : 0);
    const rp = prog(t, t0, t0 + 0.7);
    const ring = sym.rings[i];
    ring.setAttribute("opacity", t >= t0 && rp < 1 ? (0.85 * (1 - rp)).toFixed(3) : 0);
    ring.setAttribute("transform", `translate(${cx} ${cy}) scale(${(1 + 0.9 * E.outCubic(rp)).toFixed(4)}) translate(${-cx} ${-cy})`);
  });
}
function mixHex(a, b, p) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(lerp(v, pb[i], p))).join(",")})`;
}

// ================================================================ scenes

const SCENES = [];
function scene(id, t0, t1, z, build) {
  const el = h("section", { class: "scene", id });
  el.style.zIndex = z;
  stage.append(el);
  SCENES.push({ el, t0, t1, upd: build(el) });
}

// ---------------------------------------------------------------- backdrop: charcoal, lit from the centre
const backdrop = abs({ left: "0", top: "0", width: "1920px", height: "1080px", zIndex: 0, background: "radial-gradient(ellipse 74% 70% at 50% 45%, #1f1f24 0%, #16161a 40%, #0d0d10 74%, #09090b 100%)" });
stage.prepend(backdrop);

// ---------------------------------------------------------------- site header logo (target of the match cut)
const HEADER = { symLeft: 384, symTop: 18, symH: 19, wordInkLeft: 412.5, wordCapTop: 21.5, wordSize: 15 };
function measureFont() {
  const c = document.createElement("canvas").getContext("2d");
  c.font = "600 1000px Geist";
  const m = c.measureText("VYRAL");
  const v = c.measureText("V");
  return { A: m.fontBoundingBoxAscent / 1000, D: m.fontBoundingBoxDescent / 1000, cap: m.actualBoundingBoxAscent / 1000, vLeft: -v.actualBoundingBoxLeft / 1000 };
}
const FONT = measureFont();

// ---------------------------------------------------------------- S1 · logo (0–3.75 s)
const C1 = CUES.s1;
scene("s1", 0, C1.exit + 0.5, 1, (root) => {
  const SYM = 250;
  const sym = buildSymbol(SYM, { lattice: true, sweeps: true, id: "s1" });
  const top = 268;
  place(sym.wrap, 960 - (SYM_W * sym.k) / 2, top);
  const cy = top + SYM / 2;
  const glow = abs({ left: px(960 - 700), top: px(cy - 700), width: "1400px", height: "1400px", background: "radial-gradient(circle, rgba(44,245,158,.14) 0%, rgba(44,245,158,.045) 30%, rgba(44,245,158,0) 60%)" });
  const word = h("div", { style: { position: "absolute", left: "0", width: "1920px", top: "566px", textAlign: "center", fontSize: "68px", fontWeight: 600, letterSpacing: "0.16em", paddingLeft: "0.16em", lineHeight: 1.3, overflow: "hidden" } });
  const letters = "VYRAL".split("").map((ch) => {
    const l = h("span", { class: "ch", text: ch });
    word.append(l);
    return l;
  });
  const tag = h("div", { class: "mono", style: { position: "absolute", left: "0", width: "1920px", top: "684px", textAlign: "center", fontSize: "21px", letterSpacing: "0.34em", paddingLeft: "0.34em", color: "#9d9da6" }, html: 'THE VIRAL LAUNCHPAD ON SOLANA<span class="dot">.</span>' });
  const group = abs({ left: "0", top: "0", width: "1920px", height: "1080px", transformOrigin: `960px ${cy}px` });
  group.append(glow, sym.wrap, word, tag);
  root.append(group);

  return (t) => {
    slamUnits(sym, t, C1.units, { from: 1.3, travel: 46, dur: 0.85 });
    sym.lines.forEach((l, i) => {
      const t0 = 0.02 + (i % 12) * 0.03;
      l.setAttribute("stroke-dashoffset", (1 - E.outCubic(prog(t, t0, t0 + 1.3))).toFixed(4));
    });
    const sw = prog(t, C1.sweep, C1.sweep + 0.9);
    sym.sweepRects[0].setAttribute("opacity", sw > 0 && sw < 1 ? 1 : 0);
    sym.sweepRects[0].setAttribute("transform", `translate(${lerp(-260, 640, E.inOutCubic(sw)).toFixed(1)} ${SYM_H / 2}) rotate(32)`);
    sym.sweepRects[1].setAttribute("opacity", 0);
    glow.style.opacity = (0.2 + 0.6 * E.outCubic(prog(t, 0, 1.0)) + 0.35 * Math.sin(Math.PI * sw)).toFixed(3);
    letters.forEach((l, i) => {
      const t0 = C1.word + i * 0.06;
      l.style.transform = `translateY(${((1 - E.outExpo(prog(t, t0, t0 + 0.7))) * 1.45).toFixed(4)}em)`;
    });
    const tp = prog(t, C1.tag, C1.tag + 0.9);
    tag.style.clipPath = `inset(0 ${((1 - E.outCubic(tp)) * 100).toFixed(2)}% 0 0)`;
    tag.style.opacity = tp > 0 ? 1 : 0;
    // Focus pull in, slow push, soft exit.
    const ex = prog(t, C1.exit, C1.exit + 0.42);
    const sc = (1.04 - 0.04 * E.outCubic(prog(t, 0, 1.2))) * (1 + 0.025 * E.inOutSine(prog(t, 1.2, C1.exit))) * (1 - 0.04 * E.inCubic(ex));
    group.style.transform = `scale(${sc.toFixed(4)})`;
    blur(group, (1 - E.outCubic(prog(t, 0, 0.5))) * 6 + E.inCubic(ex) * 14);
    group.style.opacity = (1 - E.inCubic(ex)).toFixed(3);
  };
});

// ---------------------------------------------------------------- S2 · memes are attention (3.75–7.5 s)
const C2 = CUES.s2;
scene("s2", C2.a - 0.05, C2.bOut + 0.45, 2, (root) => {
  const A = headline(["MEMES ARE", "ATTENTION."], { size: 118, align: "center", lh: 1.04 });
  const B = headline(["ATTENTION", "DRIVES TRADING."], { size: 118, align: "center", lh: 1.04 });
  for (const x of [A, B]) {
    place(x.el, 0, 408, 1920);
    x.el.style.transformOrigin = "960px 120px";
    root.append(x.el);
  }
  return (t) => {
    const opts = { stagger: 0.08, dur: 0.6, bl: 10, outDur: 0.26, outStagger: 0.03 };
    animWords(A.words, t, C2.a, { ...opts, tout: C2.aOut });
    animWords(B.words, t, C2.b, { ...opts, tout: C2.bOut });
    A.el.style.transform = `scale(${(1 + 0.035 * prog(t, C2.a, C2.b)).toFixed(4)})`;
    B.el.style.transform = `scale(${(1 + 0.035 * prog(t, C2.b, C2.bOut + 0.3)).toFixed(4)})`;
  };
});

// ---------------------------------------------------------------- S3 · compete for trading fee rewards (7.5–11.25 s)
const C3 = CUES.s3;
scene("s3", C3.start - 0.05, C3.moveEnd + 0.15, 4, (root) => {
  const head = headline(["COMPETE FOR", "TRADING FEE REWARDS."], { size: 88, align: "center", lh: 1.04 });
  place(head.el, 0, 132, 1920);
  const sub = h("div", { class: "mono", style: { position: "absolute", left: "0", width: "1920px", top: "352px", textAlign: "center", fontSize: "21px", letterSpacing: "0.16em", paddingLeft: "0.16em", color: "#a1a1aa" }, html: 'WHILE MAKING THE COIN EVEN MORE <span class="acc">VIRAL</span><span class="dot">.</span>' });
  // Diagram: trading fees → VYRAL → top creators.
  const Y = 676;
  const AX = 540;
  const BX = 960;
  const CX = 1390;
  const svg = s("svg", { width: 1920, height: 1080, style: "position:absolute;left:0;top:0;overflow:visible" });
  const AB = [AX + 72, BX - 88];
  const lineAB = s("line", { x1: AB[0], y1: Y, x2: AB[1], y2: Y, stroke: "#3a3a42", "stroke-width": 1.5, pathLength: 1, "stroke-dasharray": "1 1", "stroke-dashoffset": 1 });
  svg.append(lineAB);
  const DOTS = [[0, 0]];
  for (let i = 0; i < 6; i++) DOTS.push([36 * Math.cos((i * Math.PI) / 3), 36 * Math.sin((i * Math.PI) / 3)]);
  for (let i = 0; i < 12; i++) DOTS.push([72 * Math.cos((i * Math.PI) / 6 + Math.PI / 12), 72 * Math.sin((i * Math.PI) / 6 + Math.PI / 12)]);
  const TARGETS = [10, 11, 12, 4, 13, 14, 15];
  const bez = (q, u) => {
    const v = 1 - u;
    return [0, 1].map((k) => v * v * v * q[0][k] + 3 * v * v * u * q[1][k] + 3 * v * u * u * q[2][k] + u * u * u * q[3][k]);
  };
  const fans = TARGETS.map((di) => {
    const [dx, dy] = DOTS[di];
    const p0 = [BX + 88, Y];
    const p3 = [CX + dx - 10, Y + dy];
    const q = [p0, [p0[0] + 150, Y], [p3[0] - 170, p3[1]], p3];
    const path = s("path", { d: `M${q[0]} C${q[1]} ${q[2]} ${q[3]}`, fill: "none", stroke: "#3a3a42", "stroke-width": 1.4, pathLength: 1, "stroke-dasharray": "1 1", "stroke-dashoffset": 1 });
    svg.append(path);
    return { path, q, di };
  });
  const dots = DOTS.map(([dx, dy]) => {
    const c = s("circle", { cx: CX + dx, cy: Y + dy, r: 8, fill: "#2c2c33", opacity: 0 });
    svg.append(c);
    return c;
  });
  const particle = () => {
    const c = s("circle", { r: 3.4, fill: ACCENT, opacity: 0 });
    svg.append(c);
    return c;
  };
  const abParticles = Array.from({ length: 5 }, particle);
  const fanParticles = fans.map(() => [particle(), particle()]);
  const tile = (x, size, inner, border) => {
    const e = place(abs({ borderRadius: px(size * 0.24), background: "#111114", border: `1px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "center" }), x - size / 2, Y - size / 2, size, size);
    if (inner) e.append(inner);
    return e;
  };
  const chart = s("svg", { width: 54, height: 40, viewBox: "0 0 54 40" }, s("path", { d: "M3 33 L14 25 L22 28 L33 15 L41 18 L51 6", fill: "none", stroke: ACCENT, "stroke-width": 3, "stroke-linecap": "round", "stroke-linejoin": "round" }), s("circle", { cx: 51, cy: 6, r: 3.5, fill: ACCENT }));
  const nodeA = tile(AX, 112, chart, "#2a2a31");
  const nodeB = tile(BX, 140, null, "rgba(44,245,158,.55)");
  nodeB.style.boxShadow = "0 0 60px rgba(44,245,158,.14)";
  const label = (x, title, subText) =>
    abs({ left: px(x - 200), width: "400px", top: px(Y + 104), textAlign: "center" }, h("div", { style: { fontSize: "21px", fontWeight: 500, color: "#e4e4e7" }, text: title }), h("div", { style: { fontSize: "15px", color: "#71717a", marginTop: "6px" }, text: subText }));
  const labA = label(AX, "Trading fees", "from every trade");
  const labC = label(CX, "Top creators", "highest Viral Scores");
  // The VYRAL node's symbol and name fly into the site header (match cut into the product).
  const BSYM = 60;
  const bsym = buildSymbol(BSYM, { id: "s3b" });
  const bk = bsym.k;
  const bLeft = BX - (SYM_W * bk) / 2;
  const bTop = Y - BSYM / 2;
  place(bsym.wrap, bLeft, bTop);
  const WORD = 22;
  const PAD = 0.18;
  const word = abs({ left: "0", top: "0", fontSize: px(WORD), fontWeight: 600, letterSpacing: "0.16em", lineHeight: 1, whiteSpace: "nowrap", padding: `${PAD}em 0`, transformOrigin: "0 0" });
  word.textContent = "VYRAL";
  root.append(svg, nodeA, nodeB, labA, labC, head.el, sub, bsym.wrap, word);
  const wordW = word.getBoundingClientRect().width;
  const wordLeft0 = BX - (wordW - 0.16 * WORD) / 2;
  const wordTop0 = Y + 96;
  place(word, wordLeft0, wordTop0);
  const capOff = (F) => F * (PAD + (1 + FONT.A - FONT.D) / 2 - FONT.cap);
  const wordEnd = { x: HEADER.wordInkLeft - FONT.vLeft * HEADER.wordSize, y: HEADER.wordCapTop - capOff(HEADER.wordSize), F: HEADER.wordSize };
  const symEnd = { x: HEADER.symLeft, y: HEADER.symTop, k: HEADER.symH / SYM_H };

  return (t) => {
    const fadeOut = 1 - prog(t, C3.out, C3.out + 0.25);
    animWords(head.words, t, C3.start, { tout: C3.out, stagger: 0.07, dur: 0.6, outDur: 0.28 });
    const sp = prog(t, C3.sub, C3.sub + 0.7);
    sub.style.opacity = (E.outCubic(sp) * fadeOut).toFixed(3);
    sub.style.clipPath = `inset(0 ${((1 - E.outCubic(sp)) * 100).toFixed(2)}% 0 0)`;
    const nodeIn = (el, t0, fade = fadeOut) => {
      const p = prog(t, t0, t0 + 0.55);
      el.style.opacity = (E.outCubic(p) * fade).toFixed(3);
      el.style.transform = `translateY(${((1 - E.outExpo(p)) * 16).toFixed(2)}px) scale(${lerp(0.94, 1, E.outExpo(p)).toFixed(4)})`;
    };
    nodeIn(nodeA, C3.nodes[0]);
    nodeIn(labA, C3.nodes[0] + 0.05);
    nodeIn(nodeB, C3.nodes[1], 1 - prog(t, C3.out + 0.05, C3.out + 0.3));
    nodeIn(labC, C3.nodes[2] + 0.05);
    dots.forEach((d, i) => d.setAttribute("opacity", (E.outCubic(prog(t, C3.nodes[2] + i * 0.015, C3.nodes[2] + i * 0.015 + 0.4)) * fadeOut).toFixed(3)));
    TARGETS.forEach((di, k) => {
      const tl = C3.light + k * 0.12;
      const lp = prog(t, tl, tl + 0.35);
      dots[di].setAttribute("fill", t >= tl ? ACCENT : "#2c2c33");
      dots[di].setAttribute("r", (8 + 3 * Math.sin(Math.PI * lp)).toFixed(2));
    });
    lineAB.setAttribute("stroke-dashoffset", (1 - E.inOutCubic(prog(t, C3.flow - 0.25, C3.flow + 0.15))).toFixed(4));
    lineAB.setAttribute("opacity", fadeOut.toFixed(3));
    fans.forEach((f, j) => {
      const t0 = C3.fan + j * 0.04;
      f.path.setAttribute("stroke-dashoffset", (1 - E.inOutCubic(prog(t, t0, t0 + 0.5))).toFixed(4));
      f.path.setAttribute("opacity", fadeOut.toFixed(3));
    });
    // Particles carry the fees along the lines.
    const flowOn = clamp((t - C3.flow) / 0.2) * fadeOut;
    abParticles.forEach((c, j) => {
      const ph = ((((t - C3.flow) * 1.25 + j / 5) % 1) + 1) % 1;
      c.setAttribute("cx", lerp(AB[0], AB[1], ph).toFixed(2));
      c.setAttribute("cy", Y);
      c.setAttribute("opacity", (Math.sin(Math.PI * ph) * flowOn).toFixed(3));
    });
    const fanOn = clamp((t - C3.fan - 0.35) / 0.2) * fadeOut;
    fanParticles.forEach((pair, j) =>
      pair.forEach((c, m) => {
        const ph = ((((t - C3.fan) * 0.95 + m / 2 + j * 0.07) % 1) + 1) % 1;
        const [x, y] = bez(fans[j].q, ph);
        c.setAttribute("cx", x.toFixed(2));
        c.setAttribute("cy", y.toFixed(2));
        c.setAttribute("opacity", (Math.sin(Math.PI * ph) * fanOn).toFixed(3));
      }),
    );
    // VYRAL symbol and name: arrive with the node, then the match cut.
    const pb = prog(t, C3.nodes[1], C3.nodes[1] + 0.55);
    const fade = 1 - prog(t, C3.moveEnd - 0.05, C3.moveEnd + 0.1);
    if (t < C3.move) {
      const dy = (1 - E.outExpo(pb)) * 16;
      bsym.wrap.style.transform = `translateY(${dy.toFixed(2)}px)`;
      word.style.transform = `translateY(${dy.toFixed(2)}px)`;
      bsym.wrap.style.opacity = E.outCubic(pb).toFixed(3);
      word.style.opacity = E.outCubic(prog(t, C3.nodes[1] + 0.1, C3.nodes[1] + 0.6)).toFixed(3);
    } else {
      const p = E.inOutCubic(prog(t, C3.move, C3.moveEnd));
      const ks = lerp(bk, symEnd.k, p);
      bsym.wrap.style.transform = `translate(${(lerp(bLeft, symEnd.x, p) - bLeft).toFixed(3)}px, ${(lerp(bTop, symEnd.y, p) - bTop).toFixed(3)}px) scale(${(ks / bk).toFixed(5)})`;
      const F = lerp(WORD, wordEnd.F, p);
      word.style.transform = `translate(${(lerp(wordLeft0, wordEnd.x, p) - wordLeft0).toFixed(3)}px, ${(lerp(wordTop0, wordEnd.y, p) - wordTop0).toFixed(3)}px) scale(${(F / WORD).toFixed(5)})`;
      bsym.wrap.style.opacity = fade.toFixed(3);
      word.style.opacity = fade.toFixed(3);
    }
  };
});

// ---------------------------------------------------------------- S5 · the product (21–29 s)
const CHROME = 52;
scene("s5", CUES.s3.move, CUES.s5.zoom + 0.5, 3, (root) => {
  const C = CUES.s5;
  const MINT = "B92FjGyuVmqne4R8Vp8S8h8GxKx87CferCPrTfgba4Pg";
  const tLaunchScroll = C.toLaunch + 0.3;
  const PAGES = [
    { id: "home", from: -1, url: "makevyral.com", scroll: () => 0 },
    { id: "launch", from: C.toLaunch, url: "makevyral.com/launch", scroll: (t) => tw(t, tLaunchScroll, tLaunchScroll + 0.43, 0, 494, E.inOutCubic) },
    { id: "token", from: C.toToken, url: `makevyral.com/token/${MINT}`, scroll: () => 0 },
    { id: "competition", from: C.toCompetition, url: `makevyral.com/competitions/${MINT}`, scroll: (t) => tw(t, C.scroll, C.scroll + 0.75, 0, 1040, E.inOutCubic) },
    { id: "submit", from: C.toSubmit, url: `makevyral.com/competitions/${MINT}/submit`, scroll: () => 380 },
  ];
  const SLIDE = 0.3;
  const cam = abs({ left: "0", top: "0", transformOrigin: "0 0" });
  const win = abs({ left: "0", top: "0", width: "1920px", height: px(1080 + CHROME), overflow: "hidden", background: "#0b0b0d", boxShadow: "0 0 0 1px #202026, 0 60px 160px rgba(0,0,0,.7)" });
  const urlText = h("span", { class: "mono", style: { fontSize: "17px", color: "#a1a1aa" } });
  const lock = s("svg", { width: 14, height: 16, viewBox: "0 0 14 16" }, s("rect", { x: 1, y: 7, width: 12, height: 8.5, rx: 2, fill: "#71717a" }), s("path", { d: "M3.8 7V4.9a3.2 3.2 0 0 1 6.4 0V7", fill: "none", stroke: "#71717a", "stroke-width": 1.6 }));
  const chrome = abs(
    { left: "0", top: "0", width: "1920px", height: px(CHROME), background: "#0e0e11", borderBottom: "1px solid #1c1c21" },
    ...[28, 52, 76].map((x) => abs({ left: px(x - 7), top: px(CHROME / 2 - 7), width: "14px", height: "14px", borderRadius: "50%", background: "#2a2a30" })),
    abs({ left: px(960 - 450), top: px(CHROME / 2 - 18), width: "900px", height: "36px", borderRadius: "18px", background: "#16161a", display: "flex", alignItems: "center", justifyContent: "center", gap: "12px" }, lock, urlText),
  );
  const view = abs({ left: "0", top: px(CHROME), width: "1920px", height: "1080px", overflow: "hidden", background: "#050505" });
  win.append(chrome, view);
  cam.append(win);
  const pageEls = {};
  for (const pg of PAGES) {
    const el = abs({ left: "0", top: "0", width: "1920px" }, h("img", { src: `assets/ui/${pg.id}.jpg`, decoding: "sync", style: { display: "block", width: "1920px" } }));
    view.append(el);
    pageEls[pg.id] = el;
  }
  // Click feedback on real buttons (page coordinates measured on the captures).
  const flashes = [];
  const pressAt = (pageId, [x0, y0, x1, y1], tc, radius = 8) => {
    const f = place(abs({ background: "#fff", borderRadius: px(radius), mixBlendMode: "screen", opacity: 0 }), x0, y0, x1 - x0, y1 - y0);
    pageEls[pageId].append(f);
    flashes.push({ f, tc });
  };
  pressAt("home", [384, 463, 519, 506], C.clickHome);
  pressAt("launch", [1177.5, 1172, 1515, 1216.5], C.clickLaunch);
  pressAt("token", [1425, 151.5, 1534.5, 186], C.clickToken);
  pressAt("submit", [1063.5, 556.5, 1174.5, 592.5], C.clickCheck);
  pressAt("submit", [384, 1302, 547.5, 1345.5], C.clickSubmit);
  // Token page: chart draws in from the left.
  const chartMask = place(abs({ background: "#050505" }), 384, 330, 1112 - 384, 640 - 330);
  pageEls.token.append(chartMask);
  // Submit page: typed URL, eligibility checks revealed one by one, CA row highlighted.
  const sub = pageEls.submit;
  const typeMask = place(abs({ background: "rgb(11,11,13)" }), 440, 558, 1049 - 440, 36);
  const caret = place(abs({ background: "#f4f4f5" }), 442, 564, 2, 24);
  const eligCover = place(abs({ background: "#050505" }), 376, 640, 806, 624);
  const ROWS = [[807, 852], [852, 897], [897, 942], [942, 1008], [1008, 1074], [1074, 1140], [1140, 1206], [1206, 1252]];
  const rowCovers = ROWS.map(([a, b]) => place(abs({ background: "#050507" }), 436, a + 1, 1172 - 436, b - a - 2));
  const pops = ROWS.map(([a, b]) => place(abs({ border: `1.5px solid ${ACCENT}`, borderRadius: "50%", opacity: 0 }), 453 - 11, (a + b) / 2 - 11, 22, 22));
  const caBox = place(abs({ border: `2px solid ${ACCENT}`, borderRadius: "10px", boxShadow: "0 0 0 6px rgba(44,245,158,.10)", opacity: 0 }), 432, 1010, 1172 - 432, 1072 - 1010);
  sub.append(typeMask, caret, eligCover, ...rowCovers, ...pops, caBox);
  // Glyph boundaries of the typed URL, read from the capture so each keystroke reveals whole characters.
  const typeStops = [];
  const readStops = () => {
    const img = sub.querySelector("img");
    if (!img.complete || !img.naturalWidth) return;
    const cv = document.createElement("canvas");
    cv.width = 900;
    cv.height = 40;
    const cx = cv.getContext("2d");
    cx.drawImage(img, 860, 1124, 900, 40, 0, 0, 900, 40);
    const data = cx.getImageData(0, 0, 900, 40).data;
    const ink = [];
    for (let x = 0; x < 900; x++) {
      let any = false;
      for (let y = 0; y < 40; y++) if (data[(y * 900 + x) * 4] > 80) any = true;
      ink.push(any);
    }
    for (let x = 1; x < 900; x++) if (ink[x - 1] && !ink[x]) typeStops.push(430 + x / 2 + 0.5);
  };
  const cursor = abs({ left: "0", top: "0", width: "30px", height: "34px", filter: "drop-shadow(0 2px 4px rgba(0,0,0,.6))" });
  cursor.append(s("svg", { width: 30, height: 34, viewBox: "0 0 30 34" }, s("path", { d: "M2 2 L2 26 L8.2 20.3 L12.4 30 L16.6 28.2 L12.5 18.8 L21 18.8 Z", fill: "#fff", stroke: "#111", "stroke-width": 1.6, "stroke-linejoin": "round" })));
  const ripple = abs({ border: `2px solid ${ACCENT}`, borderRadius: "50%" });
  view.append(ripple, cursor);
  // Headlines and label above the window.
  const scrim = abs({ left: "0", top: "0", width: "1920px", height: "300px", background: "linear-gradient(#0c0c0e 0%, rgba(12,12,14,.9) 48%, rgba(12,12,14,0) 100%)" });
  const H = ["LAUNCH A COIN.", "GET YOUR OWN COMPETITION.", "SUBMIT YOUR VIDEOS."].map((txt) => {
    const hl = headline([txt], { size: 84 });
    place(hl.el, 192, 92);
    return hl;
  });
  const label = h("div", { class: "mono", style: { position: "absolute", right: "44px", bottom: "40px", fontSize: "14px", letterSpacing: "0.2em", color: "#8b8b94", background: "rgba(5,5,6,.86)", border: "1px solid #1d1d21", borderRadius: "8px", padding: "9px 14px 9px 17px" }, text: "PRODUCT UI · ILLUSTRATIVE DATA" });
  const domainTag = h("div", { class: "mono", style: { position: "absolute", left: "194px", top: "190px", fontSize: "18px", letterSpacing: "0.06em", color: "#8b8b94" }, text: "makevyral.com" });
  root.append(cam, scrim, ...H.map((x) => x.el), label, domainTag);
  for (const x of H) fitWidth(x.el, 1520);

  const FULL = { vx: 0, vy: 0, s: 1 };
  const FR = { vx: 192, vy: 236 + CHROME * 0.8, s: 0.8 };
  const F = (pxx, py, scroll, sc, sx, sy) => ({ vx: sx - sc * pxx, vy: sy - sc * (py - scroll), s: sc });
  const CAM = [
    [C.start, FULL],
    [C.start + 0.62, FR],
    [C.toLaunch + 0.38, FR],
    [C.clickLaunch - 0.09, F(1346, 1194, 494, 0.96, 1180, 730)],
    [C.toToken - 0.03, F(1346, 1194, 494, 0.96, 1180, 730)],
    [C.toToken + 0.27, FR],
    [C.h2 + 0.12, FR],
    [C.h2 + 0.6, F(960, 282, 0, 1.0, 960, 560)],
    [C.scroll, F(960, 282, 0, 1.0, 960, 560)],
    [C.scroll + 0.7, FR],
    [C.h3 + 0.07, FR],
    [C.typeStart + 0.17, F(740, 575, 380, 1.0, 960, 600)],
    [C.clickCheck - 0.07, F(740, 575, 380, 1.0, 960, 600)],
    [C.checks[0] + 0.04, F(800, 1030, 380, 0.8, 960, 760)],
    [C.caHighlight - 0.07, F(800, 1030, 380, 0.8, 960, 760)],
    [C.caHighlight + 0.17, F(800, 1041, 380, 0.98, 960, 760)],
    [C.caHighlight + 0.31, F(800, 1041, 380, 0.98, 960, 760)],
    [C.clickSubmit + 0.01, F(466, 1324, 380, 1.0, 860, 760)],
    [C.zoom, F(466, 1324, 380, 1.0, 860, 760)],
    [C.zoom + 0.38, F(466, 1324, 380, 6.0, 860, 760), E.inExpo],
  ];
  const camAt = (t) => {
    if (t <= CAM[0][0]) return CAM[0][1];
    for (let i = 1; i < CAM.length; i++) {
      const [t1, s1, ease = E.inOutCubic] = CAM[i];
      if (t <= t1) {
        const [t0, s0] = CAM[i - 1];
        const p = ease(prog(t, t0, t1));
        return { vx: lerp(s0.vx, s1.vx, p), vy: lerp(s0.vy, s1.vy, p), s: lerp(s0.s, s1.s, p) };
      }
    }
    return CAM[CAM.length - 1][1];
  };
  const CUR = [
    [C.h1 + 0.05, [1240, 770]],
    [C.clickHome - 0.07, [452, 485]],
    [C.toLaunch + 0.45, [452, 485]],
    [C.clickLaunch - 0.07, [1346, 700]],
    [C.toToken + 0.3, [1346, 700]],
    [C.clickToken - 0.05, [1480, 169]],
    [C.clickSubmitLink - 0.3, [1480, 169]],
    [C.clickSubmitLink - 0.05, [1491, 68]],
    [C.toSubmit + 0.1, [1491, 68]],
    [C.typeStart - 0.1, [720, 195]],
    [C.typeStart + 0.05, [720, 195]],
    [C.typeEnd - 0.3, [800, 262]],
    [C.clickCheck - 0.05, [1119, 195]],
    [C.clickCheck + 0.15, [1119, 195]],
    [C.clickCheck + 0.55, [1250, 430]],
    [C.clickSubmit - 0.35, [1250, 430]],
    [C.clickSubmit - 0.06, [466, 944]],
  ];
  const curAt = (t) => {
    if (t <= CUR[0][0]) return CUR[0][1];
    for (let i = 1; i < CUR.length; i++) {
      const [t1, p1] = CUR[i];
      if (t <= t1) {
        const [t0, p0] = CUR[i - 1];
        const p = E.inOutCubic(prog(t, t0, t1));
        return [lerp(p0[0], p1[0], p), lerp(p0[1], p1[1], p)];
      }
    }
    return CUR[CUR.length - 1][1];
  };
  const CLICKS = [
    [C.clickHome, [452, 485]],
    [C.clickLaunch, [1346, 700]],
    [C.clickToken, [1480, 169]],
    [C.clickSubmitLink, [1491, 68]],
    [C.typeStart - 0.08, [720, 195]],
    [C.clickCheck, [1119, 195]],
    [C.clickSubmit, [466, 944]],
  ];

  return (t) => {
    // Window: full-bleed after the match cut, then pulled back into a browser frame.
    const c = camAt(t);
    cam.style.transform = `translate(${c.vx.toFixed(2)}px, ${(c.vy - CHROME * c.s).toFixed(2)}px) scale(${c.s.toFixed(5)})`;
    win.style.borderRadius = px(tw(t, C.start, C.start + 0.4, 0, 18));
    // The window floats in with a slight 3D tilt while it is pulled back.
    const tilt = Math.sin(Math.PI * prog(t, C.start, C.start + 0.9));
    win.style.transformOrigin = "50% 50%";
    win.style.transform = tilt > 0.001 ? `perspective(2600px) rotateX(${(5 * tilt).toFixed(3)}deg) rotateY(${(-7 * tilt).toFixed(3)}deg)` : "none";
    root.style.opacity = t < C.start ? E.inOutCubic(prog(t, CUES.s3.move + 0.15, CUES.s3.moveEnd)) : 1 - prog(t, C.zoom + 0.26, C.zoom + 0.4);
    blur(root, E.inCubic(prog(t, C.zoom + 0.1, C.zoom + 0.4)) * 22);
    if (t < C.start) cam.style.transform = `translate(0px, ${-CHROME}px) scale(1)`;
    // Pages: slide transitions with vertical motion blur.
    let current = PAGES[0];
    let blurY = 0;
    PAGES.forEach((pg, i) => {
      const el = pageEls[pg.id];
      const next = PAGES[i + 1];
      const visible = t >= pg.from && (!next || t < next.from + SLIDE);
      el.style.opacity = visible ? 1 : 0;
      if (!visible) return;
      let y = -pg.scroll(t);
      if (t < pg.from + SLIDE && i > 0) {
        const p = prog(t, pg.from, pg.from + SLIDE);
        y += 1080 * (1 - E.inOutCubic(p));
        blurY = Math.max(blurY, Math.sin(Math.PI * p) * 20);
      }
      if (next && t >= next.from) y -= 1080 * E.inOutCubic(prog(t, next.from, next.from + SLIDE));
      el.style.transform = `translateY(${y.toFixed(2)}px)`;
      if (t >= pg.from) current = pg;
    });
    mby.setAttribute("stdDeviation", `0 ${blurY.toFixed(2)}`);
    view.style.filter = blurY > 0.3 ? "url(#mby)" : "none";
    if (urlText.textContent !== current.url) urlText.textContent = current.url;
    // Button presses.
    for (const { f, tc } of flashes) f.style.opacity = (0.32 * Math.sin(Math.PI * prog(t, tc - 0.03, tc + 0.22))).toFixed(3);
    chartMask.style.left = px(lerp(384, 1112, E.outCubic(prog(t, C.toToken + 0.28, C.toToken + 0.9))));
    chartMask.style.width = px(Math.max(0, 1112 - parseFloat(chartMask.style.left)));
    // Typing.
    if (!typeStops.length) readStops();
    const typed = Math.floor(prog(t, C.typeStart, C.typeEnd) * typeStops.length + 1e-6);
    const tx = typed > 0 ? typeStops[Math.min(typed, typeStops.length) - 1] : 441;
    typeMask.style.left = px(tx);
    typeMask.style.width = px(Math.max(0, 1049 - tx));
    caret.style.left = px(tx + 1);
    show(caret, t >= C.typeStart - 0.08 && t < C.clickCheck && (t < C.typeEnd || Math.floor((t - C.typeEnd) * 2.4) % 2 === 1));
    // Eligibility checks.
    eligCover.style.opacity = 1 - prog(t, C.clickCheck + 0.07, C.clickCheck + 0.2);
    ROWS.forEach((_, i) => {
      const tc = C.checks[i];
      rowCovers[i].style.opacity = 1 - prog(t, tc, tc + 0.08);
      const pp = prog(t, tc, tc + 0.4);
      pops[i].style.opacity = pp > 0 && pp < 1 ? (0.9 * (1 - pp)).toFixed(3) : 0;
      pops[i].style.transform = `scale(${lerp(0.7, 1.7, E.outCubic(pp)).toFixed(3)})`;
    });
    caBox.style.opacity = E.outCubic(prog(t, C.caHighlight, C.caHighlight + 0.15));
    // Cursor and click ripples (viewport coordinates).
    const [cx, cy] = curAt(t);
    const pressed = CLICKS.some(([tc]) => t >= tc - 0.04 && t < tc + 0.08);
    cursor.style.transform = `translate(${(cx - 2).toFixed(1)}px, ${(cy - 2).toFixed(1)}px) scale(${pressed ? 0.86 : 1})`;
    cursor.style.opacity = prog(t, C.h1 - 0.05, C.h1 + 0.1);
    const rc = CLICKS.find(([tc]) => t >= tc && t < tc + 0.45);
    show(ripple, Boolean(rc));
    if (rc) {
      const rp = prog(t, rc[0], rc[0] + 0.45);
      const rr = lerp(8, 46, E.outCubic(rp));
      place(ripple, rc[1][0] - rr, rc[1][1] - rr, rr * 2, rr * 2);
      ripple.style.opacity = (1 - rp).toFixed(3);
    }
    // Headlines.
    animWords(H[0].words, t, C.h1, { tout: C.toCompetition - 0.06, stagger: 0.07 });
    animWords(H[1].words, t, C.h2, { tout: C.toSubmit - 0.02, stagger: 0.07 });
    animWords(H[2].words, t, C.h3, { tout: C.zoom + 0.02, stagger: 0.07 });
    scrim.style.opacity = prog(t, C.start + 0.2, C.start + 0.5);
    label.style.opacity = prog(t, C.start + 0.5, C.start + 0.8) * (1 - prog(t, C.zoom, C.zoom + 0.15));
    domainTag.style.opacity = prog(t, C.h1 + 0.3, C.h1 + 0.7) * (1 - prog(t, C.zoom, C.zoom + 0.15));
  };
});

// ---------------------------------------------------------------- formula · one viral score (20.6–24.4 s)
const CF = CUES.formula;
scene("formula", CF.start - 0.05, CF.out + 0.45, 5, (root) => {
  const head = headline(["ONE VIRAL SCORE."], { size: 84, align: "center" });
  place(head.el, 0, 118, 1920);
  const W = 1420;
  const card = place(abs({ borderRadius: "22px", background: "rgba(9,9,11,.72)", border: "1px solid #232329", overflow: "hidden" }), 250, 270, W, 620);
  const bar = abs({ left: "0", top: "0", width: px(W), height: "52px", borderBottom: "1px solid #1f1f25", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 26px", fontSize: "15px", color: "#71717a" });
  bar.className = "abs mono";
  bar.innerHTML = `<span>model viral-score-v1</span><span style="display:flex;align-items:center;gap:9px"><span style="width:7px;height:7px;border-radius:50%;background:${ACCENT};display:inline-block"></span>live config</span>`;
  const OP = "#6b6b74";
  const WT = "#a1a1aa";
  const sp = (text, color) => h("span", { style: { color } }, text);
  const term = (sym, label, color = "#f4f4f5") => {
    const e = h("span", { style: { position: "relative", display: "inline-block", color } }, sym);
    e.append(h("span", { style: { position: "absolute", left: "50%", top: "100%", marginTop: "20px", transform: "translateX(-50%)", fontFamily: "Geist", fontSize: "19px", letterSpacing: "0", color: "#71717a", whiteSpace: "nowrap", fontWeight: 400 }, text: label }));
    return e;
  };
  const group = (...parts) => h("span", { style: { display: "inline-block" } }, ...parts);
  // Line 1, same notation as the site: S = 0.50·V + 0.25·L + 0.25·C
  const groups1 = [
    group(term("S", "score", ACCENT), sp(" = ", OP)),
    group(sp("0.50", WT), sp("·", OP), term("V", "views")),
    group(sp(" + ", OP), sp("0.25", WT), sp("·", OP), term("L", "likes")),
    group(sp(" + ", OP), sp("0.25", WT), sp("·", OP), term("C", "comments")),
  ];
  const line1 = h("div", { class: "mono", style: { position: "absolute", left: "0", width: px(W), top: "108px", textAlign: "center", fontSize: "80px", fontWeight: 500, letterSpacing: "-0.04em", whiteSpace: "pre", lineHeight: 1 } }, ...groups1);
  // Line 2: each metric on a log scale against its reference value.
  const sub_ = (txt) => h("sub", { style: { fontSize: "0.58em", verticalAlign: "-0.28em", color: "#8b8b94", letterSpacing: "0" } }, txt);
  const num = h("span", { style: { display: "block", padding: "0 12px 12px" } }, "log", sub_("10"), "(1 + x · m", sub_("platform"), ")");
  const fbar = h("span", { style: { display: "block", alignSelf: "stretch", height: "3px", background: "#a1a1aa", transformOrigin: "50% 50%" } });
  const den = h("span", { style: { display: "block", padding: "14px 12px 0" } }, "log", sub_("10"), "(1 + x", sub_("ref"), ")");
  const frac = h("span", { style: { display: "inline-flex", flexDirection: "column", alignItems: "center", verticalAlign: "middle" } }, num, fbar, den);
  const g2 = group(sp("X", "#f4f4f5"), sp(" = ", OP), sp("100", ACCENT), sp(" · ", OP));
  const line2 = h("div", { class: "mono", style: { position: "absolute", left: "0", width: px(W), top: "292px", textAlign: "center", fontSize: "56px", fontWeight: 500, letterSpacing: "-0.03em", whiteSpace: "pre", lineHeight: 1.1 } }, g2, frac);
  const note = h("div", { style: { position: "absolute", left: "0", width: px(W), top: "520px", textAlign: "center", fontSize: "20px", lineHeight: 1.6, color: "#8b8b94" }, html: "Every metric is adjusted per platform and scored on a log scale.<br>10M views, 1M likes or 50K comments = 100 points." });
  card.append(bar, line1, line2, note);
  root.append(head.el, card);

  return (t) => {
    const pin = prog(t, CF.start, CF.start + 0.45);
    const pout = prog(t, CF.out, CF.out + 0.38);
    root.style.opacity = (E.outCubic(pin) * (1 - E.inCubic(pout))).toFixed(3);
    blur(root, (1 - E.outCubic(pin)) * 14 + E.inCubic(pout) * 12);
    root.style.transform = `scale(${(lerp(1.05, 1, E.outExpo(pin)) * (1 - 0.02 * pout)).toFixed(4)})`;
    animWords(head.words, t, CF.head, { stagger: 0.07 });
    const appear = (el, t0, dy = 18) => {
      const p = prog(t, t0, t0 + 0.5);
      el.style.opacity = E.outCubic(p).toFixed(3);
      el.style.transform = `translateY(${((1 - E.outExpo(p)) * dy).toFixed(2)}px)`;
      blur(el, (1 - E.outCubic(p)) * 6);
    };
    groups1.forEach((g, i) => appear(g, CF.terms[i]));
    appear(g2, CF.log[0]);
    appear(num, CF.log[1], 12);
    fbar.style.transform = `scaleX(${E.inOutCubic(prog(t, CF.log[1] - 0.05, CF.log[1] + 0.35)).toFixed(4)})`;
    appear(den, CF.log[2], -12);
    appear(note, CF.note, 10);
  };
});

// ---------------------------------------------------------------- S6 · the viral score (29–36 s)
const MULT = { tiktok: [1, 1, 1], youtube: [2.49, 3.53, 2.24], instagram: [1.19, 1.2, 1], x: [1.19, 1.2, 1] };
const logC = (x, c) => (100 * Math.log10(1 + Math.max(0, x))) / Math.log10(1 + c);
/** viral-score-v1 with the live default config (src/lib/scoring/viral-score.ts). */
function viralScore([v, l, c], platform) {
  const [mv, ml, mc] = MULT[platform];
  const va = v * mv;
  const la = Math.min(l * ml, va * 0.35);
  const ca = Math.min(c * mc, va * 0.05);
  return (50 * logC(va, 1e7) + 25 * logC(la, 1e6) + 25 * logC(ca, 5e4)) / 100;
}
const LB = [
  { handle: "orbitclips61", platform: "instagram", label: "Instagram", ago: "Published 2h ago", s: [1236246, 90245, 2372], e: [1302000, 94600, 2470] },
  { handle: "vectortv70", platform: "instagram", label: "Instagram", ago: "Published 3h ago", s: [1153638, 56098, 3442], e: [1209000, 58700, 3560] },
  { handle: "mintmedia28", platform: "x", label: "X", ago: "Published 3h ago", s: [2228482, 18680, 3217], e: [2301000, 19200, 3290] },
  { handle: "minttv89", platform: "tiktok", label: "TikTok", ago: "Published 1h ago", s: [697586, 73731, 2617], e: [731000, 77000, 2700] },
  { handle: "lumencuts70", platform: "youtube", label: "YouTube", ago: "Published 4h ago", s: [177914, 4603, 239], e: [184600, 4790, 248] },
  { handle: "novaclips", platform: "tiktok", label: "TikTok", ago: "Published just now", s: [21, 2, 0], e: [1620000, 148000, 5120], hero: true },
];
const C6 = CUES.s6;
const ROUND = [C6.start + 0.2, C6.checkpoint];
function metricsAt(row, t) {
  if (!row.hero) {
    const p = prog(t, ROUND[0], ROUND[1]);
    return row.s.map((a, i) => lerp(a, row.e[i], p));
  }
  return heroMetrics(heroP(t));
}
const heroMetrics = (p) => LB[5].s.map((a, i) => Math.expm1(lerp(Math.log1p(a), Math.log1p(LB[5].e[i]), p)));
const heroScoreAt = (p) => viralScore(heroMetrics(p), "tiktok");
// Hero's score path: overtakes rank 5, 4, 3, 2, 1 at the cue times.
const HERO_KEYS = (() => {
  const sc = (i, t) => viralScore(metricsAt(LB[i], t), LB[i].platform);
  const P = C6.passes;
  return [
    [ROUND[0], heroScoreAt(0)],
    [ROUND[0] + 0.35, heroScoreAt(0)],
    [ROUND[0] + 1.3, 52],
    [P[0], sc(4, P[0]) + 0.05],
    [P[1], sc(3, P[1]) + 0.05],
    [P[2], sc(2, P[2]) + 0.04],
    [P[3], sc(1, P[3]) + 0.04],
    [P[4], sc(0, P[4]) + 0.04],
    [ROUND[1], heroScoreAt(1)],
  ];
})();
function heroP(t) {
  let target = HERO_KEYS[HERO_KEYS.length - 1][1];
  if (t <= HERO_KEYS[0][0]) target = HERO_KEYS[0][1];
  for (let i = 1; i < HERO_KEYS.length; i++) {
    const [t0, s0] = HERO_KEYS[i - 1];
    const [t1, s1] = HERO_KEYS[i];
    if (t >= t0 && t <= t1) {
      target = lerp(s0, s1, E.inOutSine(prog(t, t0, t1)));
      break;
    }
  }
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (heroScoreAt(mid) < target) lo = mid;
    else hi = mid;
  }
  return lo;
}
const scoresAt = (t) => LB.map((r) => viralScore(metricsAt(r, t), r.platform));
function ranksAt(t) {
  const sc = scoresAt(t);
  const order = LB.map((_, i) => i).sort((a, b) => sc[b] - sc[a]);
  const ranks = [];
  order.forEach((ri, k) => (ranks[ri] = k));
  return ranks;
}
// Smooth slot positions: each rank change starts a short glide (precomputed, deterministic).
const SLOT_MOVES = (() => {
  const moves = LB.map(() => []);
  const slotAt = (i, t) => {
    let m = moves[i][0];
    for (const mv of moves[i]) if (mv.t <= t) m = mv;
    return lerp(m.from, m.to, E.inOutCubic(prog(t, m.t, m.t + 0.38)));
  };
  let prev = null;
  for (let t = C6.start - 0.2; t <= C6.expand + 0.8; t += 1 / 240) {
    const r = ranksAt(t);
    r.forEach((rk, i) => {
      if (!prev) moves[i].push({ t: -1, from: rk, to: rk });
      else if (rk !== prev[i]) moves[i].push({ t, from: slotAt(i, t), to: rk });
    });
    prev = r;
  }
  return { slotAt };
})();

const PANEL = { x: 700, y: 170, w: 1120, h: 740, row0: 156, rowH: 84 };
scene("s6", C6.start - 0.05, CUES.s7.impact + 0.35, 6, (root) => {
  const C = C6;
  const P = PANEL;
  const panel = place(abs({ background: "#09090b", border: "1px solid #1d1d21", borderRadius: "16px", overflow: "hidden", transformOrigin: "960px 540px" }), P.x, P.y, P.w, P.h);
  const title = abs({ left: "32px", top: "30px" }, h("div", { style: { fontSize: "26px", fontWeight: 600, letterSpacing: "-0.02em" }, text: "Leaderboard" }), h("div", { style: { fontSize: "16px", color: "#71717a", marginTop: "6px" }, text: "Ranked by Viral Score · Glacier Cat $GLCAT" }));
  const chipText = h("span", { class: "mono tnum", style: { fontSize: "16px" } });
  const chipDot = h("span", { style: { width: "8px", height: "8px", borderRadius: "50%", background: ACCENT, display: "inline-block" } });
  const chip = abs({ right: "32px", top: "34px", display: "flex", alignItems: "center", gap: "10px", border: "1px solid #26262c", borderRadius: "999px", padding: "8px 16px", color: "#a1a1aa" }, chipDot, chipText);
  panel.append(title, chip);
  const COLS = [
    { key: 0, label: "Views", right: 600 },
    { key: 1, label: "Likes", right: 724 },
    { key: 2, label: "Comments", right: 862 },
    { key: 3, label: "Viral Score", right: 1000 },
  ];
  const head = abs({ left: "0", top: "118px", width: px(P.w), height: "30px", fontSize: "14px", color: "#71717a" });
  head.append(abs({ left: "32px", top: "0" }, "#"), abs({ left: "76px", top: "0" }, "Video"), abs({ left: "1030px", top: "0" }, "Status"));
  const colHead = COLS.map((c) => {
    const lab = abs({ right: px(P.w - c.right), top: "0", textAlign: "right" }, c.label);
    const ul = abs({ right: px(P.w - c.right), top: "24px", height: "2px", background: ACCENT, width: "0" });
    head.append(lab, ul);
    return { lab, ul };
  });
  panel.append(head, place(abs({ background: "#1a1a1f" }), 0, P.row0 - 1, P.w, 1));
  const rows = LB.map((r) => {
    const el = place(abs({ borderBottom: "1px solid #141418", background: "#09090b" }), 0, 0, P.w, P.rowH);
    const bg = place(abs({ background: "rgba(44,245,158,.07)", opacity: 0 }), 0, 0, P.w, P.rowH);
    const bar = place(abs({ background: ACCENT, opacity: 0 }), 0, 0, 3, P.rowH);
    const rank = abs({ left: "32px", top: "30px", fontSize: "17px", color: "#71717a" });
    rank.className = "abs mono";
    const video = abs({ left: "76px", top: "0", height: px(P.rowH), display: "flex", alignItems: "center", gap: "14px" }, h("span", { class: "chip", text: r.label }), h("div", {}, h("div", { style: { fontSize: "20px", fontWeight: 500 }, text: `@${r.handle}` }), h("div", { style: { fontSize: "14px", color: "#71717a", marginTop: "3px" }, text: r.ago })));
    const cells = COLS.map((c) => {
      const cell = abs({ right: px(P.w - c.right), top: "0", height: px(P.rowH), display: "flex", alignItems: "center", fontSize: c.key === 3 ? "22px" : "20px", fontWeight: c.key === 3 ? 600 : 400 });
      cell.classList.add("tnum");
      el.append(cell);
      return cell;
    });
    const status = abs({ left: "1030px", top: "0", height: px(P.rowH), display: "flex", alignItems: "center", gap: "8px", fontSize: "15px", color: "#a1a1aa" }, h("span", { style: { width: "7px", height: "7px", borderRadius: "50%", background: ACCENT, display: "inline-block" } }), "Verified");
    el.prepend(bg, bar);
    el.append(rank, video, status);
    panel.append(el);
    return { el, bg, bar, rank, cells, video, status, hero: r.hero };
  });
  const foot = abs({ left: "32px", bottom: "28px", fontSize: "13px", color: "#52525b", letterSpacing: "0.04em" });
  foot.className = "abs mono";
  foot.textContent = "ILLUSTRATIVE DATA · TIME-LAPSE OF ONE 6-HOUR ROUND";
  panel.append(foot);
  const words = ["VIEWS.", "LIKES.", "COMMENTS."].map((w, i) => {
    const hl = headline([w], { size: 92, accentLast: false });
    place(hl.el, 120, 300 + i * 106);
    return hl;
  });
  const one = headline(["CLIMB", "TO #1."], { size: 92, lh: 1.12 });
  place(one.el, 120, 300);
  root.append(panel, ...words.map((w) => w.el), one.el);
  for (const w of [...words, one]) fitWidth(w.el, 540);

  return (t) => {
    // Entry from the zoom transition.
    const pin = prog(t, C.start, C.start + 0.42);
    panel.style.transform = `scale(${lerp(1.22, 1, E.outExpo(pin)).toFixed(4)})`;
    blur(panel, (1 - E.outCubic(pin)) * 18);
    const out = prog(t, C.expand - 0.05, C.expand + 0.2);
    panel.style.opacity = prog(t, C.start, C.start + 0.15);
    // Values and ranks.
    const ms = LB.map((r) => metricsAt(r, t));
    const sc = LB.map((r, i) => viralScore(ms[i], r.platform));
    const first = t >= C.passes[4];
    const hlCol = t < C.words[0] ? null : t < C.words[1] ? [0] : t < C.words[2] ? [1] : t < C.words[2] + 0.6 ? [2] : t < C.climb ? [0, 1, 2] : [3];
    rows.forEach((rw, i) => {
      const slot = SLOT_MOVES.slotAt(i, t);
      rw.el.style.top = px(P.row0 + slot * P.rowH);
      rw.el.style.zIndex = rw.hero ? 2 : 1;
      rw.rank.textContent = String(Math.round(slot) + 1);
      rw.cells[0].textContent = compact(ms[i][0]);
      rw.cells[1].textContent = compact(ms[i][1]);
      rw.cells[2].textContent = fmtInt(ms[i][2]);
      rw.cells[3].textContent = sc[i].toFixed(2);
      rw.cells.forEach((cell, k) => {
        cell.style.opacity = !hlCol || hlCol.includes(k) ? 1 : 0.38;
        cell.style.color = k === 3 && rw.hero && first ? ACCENT : "#f4f4f5";
      });
      const lit = rw.hero && first ? E.outCubic(prog(t, C.passes[4], C.passes[4] + 0.3)) : 0;
      rw.bg.style.opacity = lit;
      rw.bar.style.opacity = lit;
      const keep = rw.hero ? 1 - prog(t, C.expand, C.expand + 0.18) : 1 - out;
      rw.el.style.opacity = keep;
    });
    for (const x of [title, chip, head, foot]) x.style.opacity = 1 - out;
    panel.style.borderColor = `rgba(29,29,33,${(1 - out).toFixed(3)})`;
    panel.style.background = `rgba(9,9,11,${(1 - out).toFixed(3)})`;
    colHead.forEach((ch, k) => {
      const on = hlCol && hlCol.includes(k);
      ch.lab.style.color = on ? "#f4f4f5" : "#71717a";
      ch.ul.style.width = on ? px(ch.lab.getBoundingClientRect().width / (panel.getBoundingClientRect().width / P.w || 1)) : "0";
    });
    // Checkpoint countdown (time-lapse of one 6-hour round).
    const remain = Math.max(0, Math.round(lerp(6 * 3600 - 2, 0, prog(t, ROUND[0], C.checkpoint))));
    if (t < C.checkpoint) {
      const hh = String(Math.floor(remain / 3600)).padStart(2, "0");
      const mm = String(Math.floor((remain % 3600) / 60)).padStart(2, "0");
      const ss = String(remain % 60).padStart(2, "0");
      chipText.textContent = `Checkpoint in ${hh}:${mm}:${ss}`;
      chip.style.color = "#a1a1aa";
      chip.style.borderColor = "#26262c";
    } else {
      chipText.textContent = "Checkpoint reached";
      chip.style.color = ACCENT;
      chip.style.borderColor = "rgba(44,245,158,.45)";
    }
    // Left column: the three metrics, then one score.
    words.forEach((w, i) => animWords(w.words, t, C.words[i], { tout: C.climb - 0.42 + i * 0.05, dur: 0.5, outDur: 0.28 }));
    animWords(one.words, t, C.climb, { tout: C.expand - 0.1, stagger: 0.08 });
  };
});

// ---------------------------------------------------------------- S7 · the rewards (36–41 s)
const CARD = { x: 880, y: 170, w: 940, h: 740 };
const S8_SYM_H = 104;
const S8_SYM_TOP = 270;
const S8_K = S8_SYM_H / SYM_H;
const S8_UNIT0 = [960 - (SYM_W * S8_K) / 2 + unitCenter(UNITS[0])[0] * S8_K, S8_SYM_TOP + unitCenter(UNITS[0])[1] * S8_K];
scene("s7", CUES.s6.expand - 0.1, CUES.s8.impact + 0.3, 7, (root) => {
  const C = CUES.s7;
  const P = PANEL;
  const rect = abs({ borderRadius: "16px", border: "1px solid #232329", background: "#0b0b0d", overflow: "hidden" });
  const tint = abs({ left: "0", top: "0", width: "100%", height: "100%", background: "rgba(44,245,158,.07)" });
  rect.append(tint);
  const card = place(abs({}), CARD.x, CARD.y, CARD.w, CARD.h);
  const L = 44;
  const R = CARD.w - 44;
  const t_ = (x, y, style, content) => {
    const e = abs({ left: px(x), top: px(y), ...style });
    if (typeof content === "string") e.innerHTML = content;
    else if (content) e.append(content);
    return e;
  };
  const right = (y, style, content) => {
    const e = abs({ right: px(CARD.w - R), top: px(y), textAlign: "right", ...style });
    e.innerHTML = content;
    return e;
  };
  const tick = s("svg", { width: 16, height: 16, viewBox: "0 0 16 16" }, s("path", { d: "M3.5 8.4 6.6 11.3 12.6 4.9", fill: "none", stroke: "#03140c", "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round" }));
  const amount = h("span", { class: "tnum" });
  const sections = [
    [t_(L, 40, { fontSize: "15px", letterSpacing: "0.14em", color: ACCENT, fontFamily: "Geist Mono" }, "● CHECKPOINT REACHED"), right(40, { fontSize: "15px", letterSpacing: "0.1em", color: "#71717a", fontFamily: "Geist Mono" }, "GLACIER CAT · $GLCAT")],
    [
      t_(L, 100, { fontSize: "16px", color: "#71717a" }, "Top video this round"),
      t_(L, 132, { display: "flex", alignItems: "center", gap: "16px" }, h("div", { style: { display: "flex", alignItems: "center", gap: "16px" } }, h("span", { class: "chip", style: { fontSize: "15px" }, text: "TikTok" }), h("span", { style: { fontSize: "50px", fontWeight: 600, letterSpacing: "-0.03em" }, text: "@novaclips" }))),
      right(100, { fontSize: "16px", color: "#71717a" }, "Viral Score · #1"),
      right(128, { fontSize: "46px", fontWeight: 600, color: ACCENT, letterSpacing: "-0.02em" }, `<span class="tnum">${heroScoreAt(1).toFixed(2)}</span>`),
    ],
    [
      place(abs({ background: "#1d1d21", height: "1px" }), L, 222, R - L),
      t_(L, 252, { fontSize: "16px", color: "#71717a" }, "Reward"),
      right(250, { fontSize: "12px", letterSpacing: "0.16em", color: "#71717a", fontFamily: "Geist Mono", border: "1px solid #2e2e35", borderRadius: "6px", padding: "5px 9px" }, "ILLUSTRATIVE"),
      t_(L, 278, { display: "flex", alignItems: "baseline", gap: "14px" }, h("div", { style: { display: "flex", alignItems: "baseline", gap: "14px" } }, h("span", { style: { fontSize: "100px", fontWeight: 600, letterSpacing: "-0.035em", lineHeight: 1 } }, amount), h("span", { style: { fontSize: "40px", color: "#a1a1aa", fontWeight: 500 }, text: "SOL" }))),
      t_(L, 398, { fontSize: "17px", color: "#8b8b94", width: px(R - L) }, "Paid from this coin's trading fees, straight to the creator's wallet."),
    ],
  ];
  // Transfer: reward vault → creator wallet.
  const nodeBox = (inner) => h("div", { style: { width: "64px", height: "64px", borderRadius: "16px", background: "#111114", border: "1px solid #26262c", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 64px" } }, inner);
  const vaultIcon = s("svg", { width: 26, height: 27, viewBox: `0 0 ${SYM_W} ${SYM_H}` }, s("path", { d: SYM_PATH, fill: ACCENT }));
  const walletIcon = s("svg", { width: 28, height: 28, viewBox: "0 0 24 24" }, s("path", { d: "M4 6.5A2.5 2.5 0 0 1 6.5 4H18v3H6.5a.5.5 0 0 0 0 1H20v10.5a1.5 1.5 0 0 1-1.5 1.5h-12A2.5 2.5 0 0 1 4 17.5Z", fill: "#e4e4e7" }), s("circle", { cx: 16.5, cy: 13.5, r: 1.4, fill: "#111114" }));
  const nodeB = nodeBox(walletIcon);
  const transfer = [
    place(abs({ background: "#1d1d21", height: "1px" }), L, 452, R - L),
    t_(L, 484, { display: "flex", alignItems: "center", gap: "16px" }, h("div", { style: { display: "flex", alignItems: "center", gap: "16px" } }, nodeBox(vaultIcon), h("div", {}, h("div", { style: { fontSize: "19px", fontWeight: 500 }, text: "Reward vault" }), h("div", { style: { fontSize: "14px", color: "#71717a", marginTop: "4px" }, text: "Trading fees" })))),
    abs({ right: px(CARD.w - R), top: "484px", display: "flex", alignItems: "center", gap: "16px", textAlign: "right" }, h("div", {}, h("div", { class: "mono", style: { fontSize: "18px" }, text: "BXq9…KKHb" }), h("div", { style: { fontSize: "14px", color: "#71717a", marginTop: "4px" }, text: "@novaclips" })), nodeB),
  ];
  const track = place(abs({ background: "#2a2a30", height: "2px" }), 310, 515, 300);
  const packet = abs({ top: "510px", width: "12px", height: "12px", borderRadius: "50%", background: ACCENT, boxShadow: "0 0 14px 3px rgba(44,245,158,.6)" });
  const trail = abs({ top: "515px", height: "2px", background: `linear-gradient(90deg, rgba(44,245,158,0), ${ACCENT})` });
  // Status steps.
  const STEPS = ["Pending", "Submitted", "Confirmed"];
  const stepX = [L + 110, CARD.w / 2, R - 110];
  const stepEls = STEPS.map((name, i) => {
    const dot = place(abs({ borderRadius: "50%", border: "2px solid #3f3f46", background: "#0b0b0d" }), stepX[i] - 9, 592, 18, 18);
    const lab = abs({ left: px(stepX[i] - 80), width: "160px", top: "620px", textAlign: "center", fontSize: "16px", color: "#71717a" }, name);
    return { dot, lab };
  });
  const links = [0, 1].map((i) => place(abs({ background: "#2a2a30", height: "2px" }), stepX[i] + 14, 600, stepX[i + 1] - stepX[i] - 28));
  const linkFill = [0, 1].map((i) => place(abs({ background: ACCENT, height: "2px", width: "0" }), stepX[i] + 14, 600));
  // Confirmation.
  const check = abs({ width: "30px", height: "30px", borderRadius: "50%", background: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", transformOrigin: "50% 50%" }, tick);
  const checkHome = [CARD.x + L + 15, CARD.y + 678 + 15];
  const confirmText = t_(L + 46, 680, { fontSize: "19px", fontWeight: 500 }, "Confirmed on Solana");
  const sig = right(684, { fontSize: "14px", color: "#71717a", fontFamily: "Geist Mono" }, "Signature 5uKX…f7Qe · illustrative");
  card.append(...sections.flat(), ...transfer, track, trail, packet, ...links, ...linkFill, ...stepEls.flatMap((x) => [x.dot, x.lab]), confirmText, sig);
  const head = headline(["THE TOP VIDEO", "GETS PAID."], { size: 92, lh: 1.08 });
  place(head.el, 120, 330);
  const second = h("div", { class: "mono", style: { position: "absolute", left: "120px", top: "590px", fontSize: "19px", letterSpacing: "0.12em", lineHeight: 1.65, color: "#a1a1aa" }, html: 'REWARDS FROM THE COIN’S<br>TRADING FEES<span class="dot">.</span>' });
  root.append(rect, card, head.el, second, check);
  fitWidth(head.el, 700);
  const cardParts = [...sections.flat(), ...transfer, track, ...links, ...linkFill, ...stepEls.flatMap((x) => [x.dot, x.lab]), confirmText, sig];

  return (t) => {
    // Expand from the winning leaderboard row into the reward card.
    const ep = E.inOutCubic(prog(t, C.impact - 0.45, C.impact + 0.05));
    const from = { x: P.x, y: P.y + P.row0, w: P.w, h: P.rowH };
    place(rect, lerp(from.x, CARD.x, ep), lerp(from.y, CARD.y, ep), lerp(from.w, CARD.w, ep), lerp(from.h, CARD.h, ep));
    rect.style.borderRadius = px(lerp(0, 16, ep));
    rect.style.borderColor = mixHex("#1f8f60", "#232329", ep);
    tint.style.opacity = 1 - ep;
    const outP = prog(t, C.out, C.out + 0.25);
    rect.style.opacity = 1 - outP;
    cardParts.forEach((e, i) => {
      const p = prog(t, C.impact + 0.02 + i * 0.012, C.impact + 0.42 + i * 0.012);
      e.style.opacity = E.outCubic(p) * (1 - outP);
      e.style.transform = `translateY(${((1 - E.outExpo(p)) * 14).toFixed(2)}px)`;
    });
    amount.textContent = lerp(0, 0.165, E.outExpo(prog(t, C.impact + 0.3, C.impact + 1.2))).toFixed(3);
    // Transfer packet and status.
    const tp = E.inOutCubic(prog(t, C.transfer[0], C.transfer[1]));
    const x0 = 296;
    const x1 = 640;
    const px_ = lerp(x0, x1, tp);
    const moving = t >= C.transfer[0] && t < C.transfer[1] + 0.1;
    show(packet, moving);
    show(trail, moving);
    packet.style.left = px(px_ - 6);
    trail.style.left = px(Math.max(x0, px_ - 120));
    trail.style.width = px(Math.max(0, px_ - Math.max(x0, px_ - 120)));
    place(track, x0, 515, x1 - x0);
    const stTimes = [C.pending, C.submitted, C.confirmed];
    stepEls.forEach((st, i) => {
      const done = t >= stTimes[i];
      const isLast = i === 2;
      st.dot.style.background = done ? (isLast ? ACCENT : "#f4f4f5") : "#0b0b0d";
      st.dot.style.borderColor = done ? (isLast ? ACCENT : "#f4f4f5") : "#3f3f46";
      st.lab.style.color = done ? (isLast ? ACCENT : "#f4f4f5") : "#71717a";
      const pop = prog(t, stTimes[i], stTimes[i] + 0.3);
      st.dot.style.transform = `scale(${(1 + 0.5 * Math.sin(Math.PI * pop)).toFixed(3)})`;
    });
    linkFill.forEach((lf, i) => (lf.style.width = px((stepX[i + 1] - stepX[i] - 28) * E.inOutCubic(prog(t, stTimes[i] + 0.05, stTimes[i + 1])))));
    const arrive = prog(t, C.transfer[1], C.transfer[1] + 0.5);
    nodeB.style.borderColor = arrive > 0 && arrive < 1 ? mixHex(ACCENT, "#26262c", arrive) : "#26262c";
    const cp = prog(t, C.confirmed, C.confirmed + 0.45);
    confirmText.style.opacity = (t >= C.confirmed ? E.outCubic(cp) : 0) * (1 - outP);
    sig.style.opacity = (t >= C.confirmed ? E.outCubic(prog(t, C.confirmed + 0.15, C.confirmed + 0.6)) : 0) * (1 - outP);
    // The confirmation check: pops in, then flies to the end card's symbol.
    const mv = E.inOutCubic(prog(t, C.out + 0.1, C.out + 0.6));
    const sz = t < C.out + 0.1 ? 30 * E.outBack(cp) : lerp(30, 12, mv);
    const cx = lerp(checkHome[0], S8_UNIT0[0], mv);
    const cy = lerp(checkHome[1], S8_UNIT0[1], mv);
    place(check, cx - 15, cy - 15);
    check.style.transform = `scale(${(sz / 30).toFixed(4)})`;
    check.style.opacity = t >= C.confirmed ? 1 - prog(t, C.out + 0.58, C.out + 0.7) : 0;
    // Left column.
    animWords(head.words, t, C.headline, { tout: C.out, stagger: 0.07 });
    const sp = prog(t, C.secondary, C.secondary + 0.6);
    second.style.opacity = E.outCubic(sp) * (1 - prog(t, C.out, C.out + 0.25));
    second.style.clipPath = `inset(0 ${((1 - E.outCubic(sp)) * 100).toFixed(2)}% 0 0)`;
  };
});

// ---------------------------------------------------------------- S8 · end card (37.5–45 s)
scene("s8", CUES.s7.out - 0.05, 45.01, 8, (root) => {
  const C = CUES.s8;
  const sym = buildSymbol(S8_SYM_H, { id: "s8" });
  place(sym.wrap, 960 - (SYM_W * S8_K) / 2, S8_SYM_TOP);
  const cy = S8_SYM_TOP + S8_SYM_H / 2;
  const glow = abs({ left: px(960 - 560), top: px(cy - 560), width: "1120px", height: "1120px", background: "radial-gradient(circle, rgba(44,245,158,.16) 0%, rgba(44,245,158,.05) 30%, rgba(44,245,158,0) 60%)", opacity: 0 });
  const word = h("div", { style: { position: "absolute", left: "0", width: "1920px", top: "392px", textAlign: "center", fontSize: "38px", fontWeight: 600, letterSpacing: "0.18em", paddingLeft: "0.18em", lineHeight: 1.3, overflow: "hidden" } });
  const letters = "VYRAL".split("").map((ch) => {
    const l = h("span", { class: "ch", text: ch });
    word.append(l);
    return l;
  });
  const domainMask = h("div", { style: { position: "absolute", left: "0", width: "1920px", top: "462px", textAlign: "center", overflow: "hidden", padding: "0.06em 0 0.18em", lineHeight: 1, whiteSpace: "nowrap" } });
  const domain = h("span", {
    style: {
      display: "inline-block",
      fontSize: "128px",
      fontWeight: 700,
      letterSpacing: "-0.045em",
      backgroundImage: `linear-gradient(100deg, #f4f4f5 0%, #f4f4f5 42%, #c9ffe6 47%, ${ACCENT} 50%, #c9ffe6 53%, #f4f4f5 58%, #f4f4f5 100%)`,
      backgroundSize: "260% 100%",
      backgroundPosition: "100% 0",
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
    },
    text: "makevyral.com",
  });
  domainMask.append(domain);
  const slogan = headline(["LAUNCH. CREATE. COMPETE. GET PAID."], { size: 28, weight: 600, tracking: 0.06, align: "center", accentLast: false });
  place(slogan.el, 0, 668, 1920);
  slogan.el.style.color = "#d4d4d8";
  const solana = h("div", { class: "mono", style: { position: "absolute", left: "0", width: "1920px", top: "722px", textAlign: "center", fontSize: "17px", letterSpacing: "0.34em", paddingLeft: "0.34em", color: "#8b8b94" }, html: 'BUILT ON SOLANA<span class="dot">.</span>' });
  root.append(glow, sym.wrap, word, domainMask, slogan.el, solana);
  const sTimes = [0, 0.12, 0.24, 0.36, 0.4].map((d) => C.slogan + d);

  return (t) => {
    // Units: the tip forms out of the payment confirmation, then the formation completes.
    const tip = CUES.s7.out + 0.6;
    slamUnits(sym, t, [tip, C.impact, C.impact + 0.07], { from: 1.4, travel: 30, dur: 0.5 });
    let glowI = 0;
    sym.units.forEach((u, i) => {
      let I = 0;
      for (const pt of C.pulses) {
        const q = prog(t, pt + RANK[i] * 0.09, pt + RANK[i] * 0.09 + 0.6);
        I = Math.max(I, Math.sin(Math.PI * q));
      }
      glowI = Math.max(glowI, I);
      u.path.setAttribute("fill", I > 0.001 ? mixHex("#ffffff", ACCENT, I) : "#fff");
    });
    glow.style.opacity = (0.25 * prog(t, C.impact, C.impact + 0.6) + 0.6 * glowI).toFixed(3);
    letters.forEach((l, i) => {
      const t0 = C.impact + 0.12 + i * 0.05;
      l.style.transform = `translateY(${((1 - E.outExpo(prog(t, t0, t0 + 0.6))) * 1.4).toFixed(4)}em)`;
    });
    const dp = prog(t, C.domain, C.domain + 0.75);
    domain.style.transform = `translateY(${((1 - E.outExpo(dp)) * 112).toFixed(3)}%)`;
    domain.style.opacity = dp > 0 ? 1 : 0;
    blur(domain, (1 - E.outCubic(dp)) * 8);
    domain.style.backgroundPosition = `${lerp(100, 0, E.inOutCubic(prog(t, C.sheen, C.sheen + 1.2))).toFixed(2)}% 0`;
    animWords(slogan.words, t, 0, { times: sTimes, dur: 0.55, bl: 5 });
    const sp = prog(t, C.solana, C.solana + 0.7);
    solana.style.opacity = E.outCubic(sp).toFixed(3);
    solana.style.letterSpacing = `${lerp(0.6, 0.34, E.outExpo(sp)).toFixed(4)}em`;
    root.style.opacity = (1 - prog(t, C.fade, 45.0)).toFixed(3);
  };
});

// ================================================================ film grain

const grain = abs({});
grain.id = "grain";
{
  const cv = document.createElement("canvas");
  cv.width = 512;
  cv.height = 512;
  const cx = cv.getContext("2d");
  const img = cx.createImageData(512, 512);
  const r = rng(99);
  for (let i = 0; i < 512 * 512; i++) {
    const g = 128 + (r() + r() + r() - 1.5) * 70;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = g;
    img.data[i * 4 + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  grain.style.backgroundImage = `url(${cv.toDataURL()})`;
  grain.style.backgroundSize = "256px 256px";
  grain.style.mixBlendMode = "overlay";
}
stage.append(grain);
function updGrain(t) {
  const f = Math.round(t * CUES.fps);
  grain.style.transform = `translate(${Math.floor(hash(f * 3) * 128)}px, ${Math.floor(hash(f * 7 + 1) * 128)}px)`;
  grain.style.opacity = (0.26 * (1 - prog(t, CUES.s8.fade, CUES.duration))).toFixed(3);
}

// ================================================================ frame API

window.renderFrame = (t) => {
  for (const sc of SCENES) {
    const on = t >= sc.t0 && t < sc.t1;
    show(sc.el, on);
    if (on) sc.upd(t);
  }
  updGrain(t);
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
};
window.DURATION = CUES.duration;
window.FPS = CUES.fps;
