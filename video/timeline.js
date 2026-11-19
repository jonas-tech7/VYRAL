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
const ACCENT = "#2cf59e";
const BG = "#050506";
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
const mbx = document.getElementById("mbx-blur");
const mby = document.getElementById("mby-blur");

/** Uppercase headline whose words rise out of individual masks. */
function headline(lines, { size, weight = 700, tracking = -0.03, lh = 0.98, align = "left" } = {}) {
  const el = h("div", { class: "hl", style: { fontSize: px(size), fontWeight: weight, letterSpacing: `${tracking}em`, lineHeight: lh, textAlign: align } });
  const words = [];
  for (const line of lines) {
    const row = h("div", { class: "hl-row" });
    line.split(" ").forEach((w, i) => {
      if (i) row.append(document.createTextNode(" "));
      const inner = h("span", { class: "hl-in", html: dotify(w) });
      row.append(h("span", { class: "hl-mask" }, inner));
      words.push(inner);
    });
    el.append(row);
  }
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

// ---------------------------------------------------------------- S1 · the hook (0–5 s)
scene("s1", 0, 5.3, 1, (root) => {
  const C = CUES.s1;
  const wrap = abs({ left: "0", top: "0", width: "1920px", height: "1080px", transformOrigin: "960px 540px" });
  const mkLines = (animated) => {
    const box = abs({ left: "0", top: "0", width: "1920px", height: "1080px" });
    const style = { position: "absolute", left: "0", width: "1920px", textAlign: "center", fontSize: "172px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, whiteSpace: "nowrap" };
    const l1 = h("div", { style: { ...style, top: "373px" }, html: dotify("ATTENTION IS") });
    const l2 = h("div", { style: { ...style, top: "551px" } });
    const chars = [];
    for (const ch of "THE NEW CURRENCY.") {
      const c = h("span", { class: "ch" + (ch === "." ? " dot" : ""), text: ch });
      l2.append(c);
      chars.push(c);
    }
    box.append(l1, l2);
    return { box, l1, l2, chars, animated };
  };
  const base = mkLines(true);
  const fitTo = 1680;
  const masks = [abs({ background: BG }), abs({ background: BG })];
  const g1 = mkLines(false);
  const g2 = mkLines(false);
  g1.box.style.color = ACCENT;
  g1.box.style.opacity = 0.9;
  wrap.append(base.box, ...masks, g1.box, g2.box);
  root.append(wrap);
  // Shrink both lines together if the longer one is too wide.
  for (const L of [base, g1, g2]) {
    const width = L.l2.scrollWidth;
    if (width > fitTo) for (const l of [L.l1, L.l2]) l.style.fontSize = px(172 * (fitTo / width));
  }

  return (t) => {
    // Line 1: impact with tracking-in and motion blur.
    const p1 = prog(t, C.line1, C.line1 + 0.6);
    base.l1.style.opacity = clamp((t - C.line1) / 0.05);
    base.l1.style.transform = `scale(${lerp(1.24, 1, E.outExpo(p1)).toFixed(4)})`;
    base.l1.style.letterSpacing = `${lerp(0.03, -0.03, E.outExpo(p1)).toFixed(4)}em`;
    blur(base.l1, (1 - E.outCubic(prog(t, C.line1, C.line1 + 0.32))) * 16);
    // Line 2: characters cascade in.
    base.chars.forEach((c, i) => {
      const t0 = C.line2 + i * 0.022;
      const p = prog(t, t0, t0 + 0.55);
      c.style.opacity = clamp((t - t0) / 0.05);
      c.style.transform = `translateY(${((1 - E.outExpo(p)) * 0.2).toFixed(4)}em) scale(${lerp(1.4, 1, E.outExpo(p)).toFixed(4)})`;
      blur(c, (1 - E.outCubic(prog(t, t0, t0 + 0.3))) * 12);
    });
    // Slow push-in, then a horizontal stretch into the flash.
    const push = 1 + 0.055 * E.inOutSine(prog(t, C.line1, C.exit));
    const pe = prog(t, C.exit, C.exit + 0.33);
    wrap.style.transform = `scale(${push.toFixed(4)}) scaleX(${lerp(1, 1.4, E.inExpo(pe)).toFixed(4)})`;
    wrap.style.opacity = 1 - prog(t, C.exit + 0.16, C.exit + 0.34);
    blur(wrap, E.inCubic(pe) * 12);
    // Digital distortion: two-frame slice displacement on the glitch hits.
    const gi = C.glitches.findIndex((g) => t >= g - 1e-6 && t < g + 2 / 30 - 1e-6);
    const on = gi >= 0;
    for (const e of [g1.box, g2.box, ...masks]) show(e, on);
    if (on) {
      const seed = gi * 17 + Math.floor((t - C.glitches[gi]) * 30 + 1e-6);
      const bands = [0, 1].map((j) => {
        const y = 400 + hash(seed * 5 + j) * 300;
        const hh = j ? 10 + hash(seed * 7 + j) * 26 : 18 + hash(seed * 11 + j) * 44;
        return [y, hh, (hash(seed * 13 + j) - 0.5) * (j ? 90 : 60)];
      });
      [g1.box, g2.box].forEach((box, j) => {
        const [y, hh, dx] = bands[j];
        box.style.clipPath = `inset(${y}px 0 ${1080 - y - hh}px 0)`;
        box.style.transform = `translateX(${dx}px)`;
        place(masks[j], 0, y, 1920, hh);
      });
      base.box.style.transform = `translateX(${((hash(seed * 19) - 0.5) * 12).toFixed(1)}px)`;
    } else base.box.style.transform = "none";
  };
});

// ---------------------------------------------------------------- flash (S1 → S2)
const flash = abs({});
flash.id = "flash";
stage.append(flash);
function updFlash(t) {
  const f = CUES.s1.flash;
  const a = f - 0.33;
  const b = f - 0.22;
  const d = f + 0.36;
  if (t < a || t >= d) return show(flash, false);
  show(flash, true);
  let w = 1920;
  let hh;
  let op = 1;
  if (t < b) {
    w = 1920 * E.outExpo(prog(t, a, b));
    hh = 2;
  } else if (t < f) hh = lerp(2, 1500, E.inExpo(prog(t, b, f)));
  else {
    hh = 1500;
    op = 1 - E.outCubic(prog(t, f, d));
  }
  place(flash, 960 - w / 2, 540 - hh / 2, w, hh);
  flash.style.opacity = op;
}

// ---------------------------------------------------------------- S2 · the crypto world (5–10.8 s)
const TICKERS = ["GLCAT", "ORBF", "LUNLL", "VGOOSE", "EMBR", "COYO", "MMAM", "PIGEON", "DDOLPH", "SLOTH", "GGOAT", "MINK", "STSHRK", "MOOSE", "TSNAIL", "HERON", "FROST", "KOI", "OTTR", "MOTH", "OWLZ", "CRAB", "YAKK", "LYNX", "BISON", "FINCH", "TAPIR", "ORCA", "NEWT", "DINGO", "KIWI", "IBEX", "QUOKA", "LEMUR", "PUFFN", "WOMBT", "GECKO", "MANTA", "RAVN", "BEAVR"];
const HANDLES = ["minttv89", "orbitclips61", "lumencuts70", "vectortv70", "mintmedia28", "signalstudio24", "novaclips", "driftdaily51"];

function camTransform(el, sc, fx, fy, rot = 0) {
  el.style.transform = `translate(${(960 - fx * sc).toFixed(2)}px, ${(540 - fy * sc).toFixed(2)}px) scale(${sc.toFixed(4)})` + (rot ? ` rotate(${rot}deg)` : "");
}

function chartShot(cfg) {
  const el = h("div", { class: "shot" });
  const cam = abs({ left: "0", top: "0", width: "1920px", height: "1080px", transformOrigin: "0 0" });
  el.append(cam);
  const n = cfg.n ?? 150;
  const r = rng(cfg.seed);
  const vals = [];
  let v = 0;
  for (let i = 0; i < n; i++) {
    v += (cfg.drift ?? 0.32) + (r() - 0.5) * 2.4 + (i > n * 0.6 ? 0.35 : 0);
    vals.push(v);
  }
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const X0 = 110;
  const X1 = 1690;
  const Y0 = 860;
  const Y1 = 270;
  const pts = vals.map((vv, i) => [X0 + (i / (n - 1)) * (X1 - X0), Y0 - ((vv - lo) / (hi - lo)) * (Y0 - Y1)]);
  const price = (y) => cfg.price * (1 + ((Y0 - y) / (Y0 - Y1)) * cfg.mult);
  const svg = s("svg", { width: 1920, height: 1080, viewBox: "0 0 1920 1080", style: "position:absolute;left:0;top:0;overflow:visible" });
  const gid = `cg${cfg.seed}`;
  svg.append(
    s("defs", {}, s("linearGradient", { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 }, s("stop", { offset: 0, "stop-color": ACCENT, "stop-opacity": 0.2 }), s("stop", { offset: 1, "stop-color": ACCENT, "stop-opacity": 0 }))),
  );
  const grid = s("g", { stroke: "#16161b", "stroke-width": 1 });
  for (let y = 196; y <= 900; y += 88) grid.append(s("line", { x1: -400, x2: 2400, y1: y, y2: y }));
  for (let x = X0; x <= 2400; x += 198) grid.append(s("line", { x1: x, x2: x, y1: 150, y2: 1010, stroke: "#101014" }));
  svg.append(grid);
  const axis = s("g", { "font-family": "Geist Mono", "font-size": 16, fill: "#52525b" });
  for (let y = 196; y <= 900; y += 88) axis.append(s("text", { x: 1835, y: y + 5, "text-anchor": "end" }, document.createTextNode(price(y).toFixed(6))));
  svg.append(axis);
  const vols = s("g");
  const volBars = pts.map(([x]) => {
    const hh = 10 + r() * 60;
    const b = s("rect", { x: x - 3.5, y: 1000 - hh, width: 7, height: hh, fill: "#202027" });
    vols.append(b);
    return b;
  });
  const area = s("path", { fill: `url(#${gid})` });
  const line = s("path", { fill: "none", stroke: ACCENT, "stroke-width": 3.2, "stroke-linejoin": "round", "stroke-linecap": "round" });
  const candles = s("g");
  const candleEls = [];
  if (cfg.mode === "candles") {
    const per = 3;
    for (let c = 0; c * per < n - 1; c++) {
      const seg = pts.slice(c * per, c * per + per + 1);
      const o = seg[0][1];
      const cl = seg[seg.length - 1][1];
      const top = Math.min(...seg.map((q) => q[1])) - 6 - r() * 10;
      const bot = Math.max(...seg.map((q) => q[1])) + 6 + r() * 10;
      const x = seg[0][0];
      const up = cl < o;
      const wick = s("line", { x1: x + 8, x2: x + 8, y1: top, y2: bot, stroke: up ? ACCENT : "#5a5a63", "stroke-width": 2 });
      const body = s("rect", { x, y: Math.min(o, cl), width: 16, height: Math.max(3, Math.abs(cl - o)), fill: up ? ACCENT : "#0d0d10", stroke: up ? ACCENT : "#5a5a63", "stroke-width": 2 });
      const g = s("g", {}, wick, body);
      candles.append(g);
      candleEls.push({ g, x });
    }
  }
  const priceLine = s("line", { stroke: ACCENT, "stroke-opacity": 0.5, "stroke-dasharray": "6 8", "stroke-width": 1.5 });
  const halo = s("circle", { r: 20, fill: ACCENT, opacity: 0.16 });
  const head = s("circle", { r: 7.5, fill: ACCENT });
  const tagRect = s("rect", { width: 152, height: 40, rx: 8, fill: ACCENT });
  const tagText = s("text", { x: 76, y: 27, "text-anchor": "middle", "font-family": "Geist Mono", "font-size": 19, "font-weight": 600, fill: "#03140c" });
  const tag = s("g", {}, tagRect, tagText);
  svg.append(vols, area, cfg.mode === "candles" ? candles : line, priceLine, halo, head, tag);
  cam.append(svg);
  const priceEl = h("div", { class: "tnum", style: { fontSize: "80px", fontWeight: 600, letterSpacing: "-0.035em", lineHeight: 1 } });
  const chgEl = h("div", { class: "mono", style: { fontSize: "30px", color: ACCENT } });
  const hdr = abs(
    { left: "110px", top: "64px" },
    h("div", { class: "mono", style: { fontSize: "20px", color: "#71717a", letterSpacing: "0.06em" }, text: `$${cfg.ticker} / SOL · ${cfg.mode === "candles" ? "1M" : "5M"}` }),
    h("div", { style: { display: "flex", alignItems: "baseline", gap: "22px", marginTop: "12px" } }, priceEl, chgEl),
  );
  if (cfg.header !== false) el.append(hdr);
  const startPrice = price(pts[0][1]);
  return {
    el,
    upd(lt, dur) {
      const p = lerp(cfg.p0 ?? 0.3, 1, E.outCubic(clamp(lt / (dur * (cfg.drawFrac ?? 1)))));
      const kf = p * (n - 1);
      const i = Math.min(n - 2, Math.floor(kf));
      const f = kf - i;
      const hp = [lerp(pts[i][0], pts[i + 1][0], f), lerp(pts[i][1], pts[i + 1][1], f)];
      const d = "M" + pts.slice(0, i + 1).map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(" L") + ` L${hp[0].toFixed(1)} ${hp[1].toFixed(1)}`;
      line.setAttribute("d", d);
      area.setAttribute("d", `${d} L${hp[0].toFixed(1)} 1000 L${X0} 1000 Z`);
      volBars.forEach((b, j) => b.setAttribute("opacity", j <= kf ? 1 : 0));
      volBars.forEach((b, j) => b.setAttribute("fill", j > kf - 6 ? "#2b6b4f" : "#202027"));
      candleEls.forEach((c) => c.g.setAttribute("opacity", c.x <= hp[0] ? 1 : 0));
      head.setAttribute("cx", hp[0]);
      head.setAttribute("cy", hp[1]);
      halo.setAttribute("cx", hp[0]);
      halo.setAttribute("cy", hp[1]);
      halo.setAttribute("r", (16 + 8 * Math.abs(Math.sin(lt * 9))).toFixed(2));
      priceLine.setAttribute("x1", hp[0]);
      priceLine.setAttribute("x2", 1700);
      priceLine.setAttribute("y1", hp[1]);
      priceLine.setAttribute("y2", hp[1]);
      tag.setAttribute("transform", `translate(1700 ${(hp[1] - 20).toFixed(1)})`);
      const pr = price(hp[1]);
      tagText.textContent = pr.toFixed(6);
      priceEl.textContent = `$${pr.toFixed(6)}`;
      chgEl.textContent = `+${((pr / startPrice - 1) * 100).toFixed(1)}%`;
      const c = cfg.cam(lt, dur, hp);
      camTransform(cam, c.s, c.fx, c.fy, c.rot ?? 0);
    },
  };
}

function counterShot(cfg) {
  const el = h("div", { class: "shot" });
  const cam = abs({ left: "0", top: "0", width: "1920px", height: "1080px", transformOrigin: "0 0" });
  const label = h("div", { class: "mono", style: { position: "absolute", left: "0", width: "1920px", top: "300px", textAlign: "center", fontSize: "24px", letterSpacing: "0.34em", color: "#8b8b94" } });
  label.innerHTML = `<span style="color:${ACCENT}">●</span>&nbsp;&nbsp;${cfg.label}`;
  const num = h("div", { class: "tnum", style: { position: "absolute", left: "0", width: "1920px", top: "352px", textAlign: "center", fontSize: "250px", fontWeight: 700, letterSpacing: "-0.05em", lineHeight: 1 } });
  const sub = h("div", { class: "mono tnum", style: { position: "absolute", left: "0", width: "1920px", top: "650px", textAlign: "center", fontSize: "28px", letterSpacing: "0.12em", color: "#a1a1aa" } });
  cam.append(label, num, sub);
  el.append(cam);
  return {
    el,
    upd(lt, dur) {
      const p = E.outExpo(clamp(lt / (dur * 0.95)));
      num.textContent = fmtInt(lerp(cfg.from, cfg.to, p));
      sub.textContent = `LIKES ${fmtInt(lerp(cfg.likes[0], cfg.likes[1], p))}   ·   COMMENTS ${fmtInt(lerp(cfg.comments[0], cfg.comments[1], p))}`;
      camTransform(cam, lerp(cfg.s0, cfg.s1, E.outCubic(clamp(lt / dur))), 960, 520);
    },
  };
}

function tickerShot(cfg) {
  const el = h("div", { class: "shot" });
  const cam = abs({ left: "0", top: "0", width: "1920px", height: "1080px", transformOrigin: "0 0" });
  const r = rng(cfg.seed);
  const rows = [0, 1, 2].map((row) => {
    const strip = abs({ left: "0", top: px(110 + row * 330), whiteSpace: "nowrap", display: "flex", alignItems: "baseline", filter: "url(#mbx)" });
    for (let i = 0; i < 16; i++) {
      const tk = TICKERS[(row * 7 + i * 3 + cfg.seed) % TICKERS.length];
      const up = r() > 0.28;
      const chg = (up ? "+" : "−") + (up ? 4 + r() * 320 : 1 + r() * 18).toFixed(1) + "%";
      strip.append(
        h("span", { style: { fontSize: "170px", fontWeight: 700, letterSpacing: "-0.05em" }, text: `$${tk}` }),
        h("span", { class: "mono", style: { fontSize: "62px", marginLeft: "28px", color: up ? ACCENT : "#6b6b74" }, text: chg }),
        h("span", { style: { display: "inline-block", width: "18px", height: "18px", background: up ? ACCENT : "#3f3f46", margin: "0 72px", transform: "translateY(-30px)" } }),
      );
    }
    cam.append(strip);
    return { strip, dir: row % 2 ? 1 : -1, off: -400 - r() * 1600 };
  });
  el.append(cam);
  return {
    el,
    upd(lt) {
      rows.forEach((rw, i) => {
        rw.strip.style.transform = `translateX(${(rw.off + rw.dir * cfg.speed * (1 + i * 0.12) * lt - (rw.dir > 0 ? 3000 : 0)).toFixed(1)}px)`;
      });
      camTransform(cam, cfg.scale, 960, 540, cfg.rot);
    },
    blurX: cfg.blur,
  };
}

const ICON = {
  heart: "M12 20.6 4.6 13.4a4.7 4.7 0 0 1 6.7-6.6l.7.7.7-.7a4.7 4.7 0 0 1 6.7 6.6Z",
  bubble: "M4 4.5h16a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H10l-5 4v-4H4A1.5 1.5 0 0 1 2.5 16V6A1.5 1.5 0 0 1 4 4.5Z",
  share: "M13.5 4.5 21 12l-7.5 7.5v-4.2c-5.1 0-8.4 1.4-10.5 4.7.6-6.3 3.8-10.1 10.5-10.8Z",
};
const iconSvg = (d, color) => {
  const e = s("svg", { width: 40, height: 40, viewBox: "0 0 24 24" }, s("path", { d, fill: color }));
  return e;
};
function feedCard(type, idx) {
  const light = type === "img";
  const ink = light ? "#0b0b0e" : "#f4f4f5";
  const card = h("div", { class: "card", style: { background: "#0b0b0e" } });
  const handle = HANDLES[idx % HANDLES.length];
  if (type === "img") {
    card.style.background = "#cfeafb";
    card.append(h("img", { src: "assets/glacier-cat.png", decoding: "sync", style: { position: "absolute", left: "40px", top: "150px", width: "340px", height: "340px" } }));
  } else if (type === "chart") {
    const r = rng(idx + 11);
    let v = 0;
    const pts = [];
    for (let i = 0; i < 40; i++) {
      v += 0.6 + (r() - 0.45) * 3;
      pts.push(v);
    }
    const lo = Math.min(...pts);
    const hi = Math.max(...pts);
    const d = pts.map((q, i) => `${i ? "L" : "M"}${(20 + i * 9.5).toFixed(1)} ${(420 - ((q - lo) / (hi - lo)) * 230).toFixed(1)}`).join(" ");
    card.append(
      s("svg", { width: 420, height: 746, style: "position:absolute;left:0;top:0" }, s("path", { d, fill: "none", stroke: ACCENT, "stroke-width": 4, "stroke-linejoin": "round" })),
      abs({ left: "30px", top: "460px", fontSize: "84px", fontWeight: 700, letterSpacing: "-0.04em", color: ACCENT }, "+312%"),
      abs({ left: "34px", top: "560px", fontSize: "26px", fontWeight: 600, color: "#a1a1aa" }, "$ORBF"),
    );
  } else if (type === "caption") {
    card.append(abs({ left: "34px", top: "170px", width: "352px", fontSize: "54px", fontWeight: 700, lineHeight: 1.02, letterSpacing: "-0.035em", textTransform: "uppercase" }, "POV: you found it at $4K market cap"));
  } else if (type === "ticker") {
    card.style.background = "linear-gradient(165deg, #0e2a1d 0%, #07120d 45%, #050506 80%)";
    card.append(
      abs({ left: "0", width: "420px", top: "250px", textAlign: "center", fontSize: "92px", fontWeight: 700, letterSpacing: "-0.05em" }, "$GLCAT"),
      abs({ left: "0", width: "420px", top: "360px", textAlign: "center", fontSize: "26px", color: "#a1a1aa" }, "is everywhere right now"),
    );
  } else if (type === "wave") {
    const bars = s("g", { fill: ACCENT });
    const r = rng(idx * 3 + 5);
    for (let i = 0; i < 26; i++) {
      const hh = 20 + r() * 150 * Math.sin((i / 25) * Math.PI) + 10;
      bars.append(s("rect", { x: 42 + i * 13.5, y: 330 - hh / 2, width: 7, height: hh, rx: 3.5, opacity: 0.35 + 0.65 * r() }));
    }
    card.append(s("svg", { width: 420, height: 746, style: "position:absolute;left:0;top:0" }, bars), abs({ left: "0", width: "420px", top: "460px", textAlign: "center", fontSize: "18px", color: "#71717a" }, h("span", { class: "mono", text: `original sound · @${handle}` })));
  }
  const avatar = abs({ position: "relative", width: "36px", height: "36px", borderRadius: "50%", background: light ? "#0b0b0e" : "#26262c", color: light ? "#cfeafb" : "#e4e4e7", fontSize: "13px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }, handle.slice(0, 2).toUpperCase());
  avatar.style.position = "relative";
  card.append(abs({ left: "22px", top: "22px", display: "flex", alignItems: "center", gap: "10px", fontSize: "17px", fontWeight: 600, color: ink }, avatar, `@${handle}`, h("span", { style: { fontWeight: 400, opacity: 0.6 }, text: "· 2h" })));
  const counts = [];
  const side = abs({ right: "18px", top: "430px", display: "flex", flexDirection: "column", alignItems: "center", gap: "20px", color: ink });
  for (const [k, base] of [["heart", 48200 + idx * 7300], ["bubble", 1204 + idx * 311], ["share", 3118 + idx * 503]]) {
    const c = h("div", { class: "mono", style: { fontSize: "15px", marginTop: "2px" } });
    side.append(h("div", { style: { display: "flex", flexDirection: "column", alignItems: "center" } }, iconSvg(ICON[k], ink), c));
    counts.push({ c, base });
  }
  card.append(side);
  const caption = {
    img: "the coldest cat on solana",
    chart: "this chart is unreal rn",
    caption: "watch till the end",
    ticker: "everyone is posting about it",
    wave: "this sound is everywhere",
  }[type];
  card.append(abs({ left: "22px", bottom: "40px", width: "300px", fontSize: "18px", fontWeight: 500, color: ink, lineHeight: 1.3 }, caption));
  const bar = abs({ left: "0", bottom: "0", height: "4px", background: light ? "#0b0b0e" : "#f4f4f5", opacity: 0.75 });
  card.append(abs({ left: "0", bottom: "0", width: "420px", height: "4px", background: light ? "rgba(0,0,0,.15)" : "rgba(255,255,255,.15)" }), bar);
  return {
    card,
    upd(lt, rate = 1) {
      counts.forEach(({ c, base }) => (c.textContent = compact(base * (1 + 0.6 * rate * lt))));
      bar.style.width = px(420 * ((0.15 + 0.35 * idx + lt * 0.5 * rate) % 1));
    },
  };
}
function feedShot(cfg) {
  const el = h("div", { class: "shot" });
  const cam = abs({ left: "0", top: "0", width: "1920px", height: "1080px", transformOrigin: "0 0" });
  el.append(cam);
  const TYPES = ["ticker", "img", "caption", "chart", "wave"];
  const cols = [-1040, -520, 0, 520, 1040].map((dx, ci) => {
    const col = abs({ left: px(960 + dx - 210), top: "0", width: "420px", height: "1080px", opacity: [0.35, 0.7, 1, 0.7, 0.35][ci] });
    const cards = [0, 1, 2, 3].map((j) => {
      const fc = feedCard(TYPES[(ci * 2 + j + cfg.seed) % TYPES.length], ci * 4 + j);
      col.append(fc.card);
      return fc;
    });
    cam.append(col);
    return { col, cards, speed: cfg.speed * (ci % 2 ? -0.62 : 1), phase: (ci * 311) % 782 };
  });
  return {
    el,
    upd(lt, dur) {
      for (const c of cols) {
        const period = 4 * 782;
        c.cards.forEach((fc, j) => {
          let y = (j * 782 + c.phase - c.speed * lt) % period;
          if (y < 0) y += period;
          fc.card.style.top = px(y - 900);
          fc.upd(lt, cfg.rate ?? 1);
        });
        c.col.style.filter = cfg.blurY ? "url(#mby)" : "none";
      }
      const cm = cfg.cam(lt, dur);
      camTransform(cam, cm.s, cm.fx, cm.fy, cm.rot ?? 0);
    },
    blurY: cfg.blurY,
  };
}

function heatShot(cfg) {
  const el = h("div", { class: "shot" });
  const cam = abs({ left: "0", top: "0", width: "1920px", height: "1080px", transformOrigin: "0 0" });
  el.append(cam);
  const COLS = 8;
  const ROWS = 5;
  const G = 6;
  const tw_ = (1920 - G * (COLS + 1)) / COLS;
  const th = (1080 - G * (ROWS + 1)) / ROWS;
  const r = rng(cfg.seed);
  const tiles = [];
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const idx = j * COLS + i;
      const tile = place(abs({ borderRadius: "10px", border: "1px solid transparent", padding: "22px 24px", overflow: "hidden" }), G + i * (tw_ + G), G + j * (th + G), tw_, th);
      const name = h("div", { style: { fontSize: "32px", fontWeight: 700, letterSpacing: "-0.03em" }, text: `$${TICKERS[(idx + cfg.seed) % TICKERS.length]}` });
      const pct = h("div", { class: "mono tnum", style: { fontSize: "25px", marginTop: "8px" } });
      const mc = h("div", { class: "mono", style: { position: "absolute", left: "24px", bottom: "20px", fontSize: "15px", color: "#71717a" }, text: `MC $${(8 + r() * 180).toFixed(1)}K` });
      tile.append(name, pct, mc);
      cam.append(tile);
      tiles.push({ tile, pct, base: -12 + r() * 150, amp: 6 + r() * 30, w: 3 + r() * 9, ph: r() * 6.28 });
    }
  }
  return {
    el,
    upd(lt, dur, t) {
      const step = Math.floor(t / 0.1);
      tiles.forEach((tl, i) => {
        const jump = hash(step * 131 + i) < 0.18 ? (hash(step * 977 + i) - 0.4) * 60 : 0;
        const v = tl.base + tl.amp * Math.sin(tl.ph + tl.w * t) + jump;
        const up = v >= 0;
        tl.pct.textContent = `${up ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
        tl.pct.style.color = up ? "#e4fff2" : "#71717a";
        tl.tile.style.background = up ? `rgba(44,245,158,${(0.07 + 0.45 * clamp(v / 140)).toFixed(3)})` : "#101013";
        tl.tile.style.borderColor = jump ? "rgba(44,245,158,.9)" : "transparent";
      });
      const cm = cfg.cam(lt, dur);
      camTransform(cam, cm.s, cm.fx, cm.fy);
    },
  };
}

const NOTES = [
  ["MT", "@minttv89 posted a new video", "$GLCAT · 12.4K views in the first hour"],
  ["OR", "$ORBF is up 41% in 5 minutes", "Market cap $96.2K"],
  ["LC", "@lumencuts70 is trending", "Your video passed 100K views"],
  ["EM", "$EMBR hit a new all-time high", "+128% today"],
  ["OC", "@orbitclips61 mentioned $GLCAT", "Instagram · 2.1K likes"],
  ["VG", "$VGOOSE volume is spiking", "$184K in the last hour"],
  ["MM", "@mintmedia28 went viral", "1.02M views · 84K likes"],
  ["LU", "$LUNLL holders are growing", "+1,204 wallets today"],
  ["SS", "@signalstudio24 posted a video", "Shorts · 31K views"],
  ["CO", "$COYO is breaking out", "+62% in 15 minutes"],
];
function notifyShot(cfg) {
  const el = h("div", { class: "shot" });
  const cam = abs({ left: "0", top: "0", width: "1920px", height: "1080px", transformOrigin: "0 0" });
  el.append(cam);
  const grid = s("svg", { width: 1920, height: 1080, style: "position:absolute;left:0;top:0" });
  for (let y = 60; y < 1080; y += 90) grid.append(s("line", { x1: 0, x2: 1920, y1: y, y2: y, stroke: "#0f0f13" }));
  cam.append(grid);
  const N = 14;
  const toasts = [];
  for (let k = 0; k < N; k++) {
    const [ini, title, sub] = NOTES[(k + cfg.offset) % NOTES.length];
    const accent = title.startsWith("$");
    const icon = h("div", {
      style: { width: "54px", height: "54px", flex: "0 0 54px", borderRadius: "50%", background: accent ? "rgba(44,245,158,.14)" : "#1c1c21", color: accent ? ACCENT : "#e4e4e7", fontSize: "17px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" },
      text: ini,
    });
    const text = h("div", { style: { flex: "1" } }, h("div", { style: { fontSize: "24px", fontWeight: 600, letterSpacing: "-0.01em" }, text: title }), h("div", { style: { fontSize: "18px", color: "#8b8b94", marginTop: "4px" }, text: sub }));
    const t = h("div", { class: "toast" }, icon, text, h("div", { class: "mono", style: { fontSize: "15px", color: "#71717a" }, text: "now" }));
    t.style.left = "550px";
    cam.append(t);
    toasts.push({ t, at: k * cfg.every });
  }
  return {
    el,
    upd(lt, dur) {
      toasts.forEach((ts, k) => {
        if (lt < ts.at) return show(ts.t, false);
        show(ts.t, true);
        let shift = 0;
        for (let j = k + 1; j < N; j++) if (lt >= toasts[j].at) shift += E.outExpo(prog(lt, toasts[j].at, toasts[j].at + 0.2));
        const p = prog(lt, ts.at, ts.at + 0.2);
        const y = 130 + shift * 116 - (1 - E.outExpo(p)) * 30;
        ts.t.style.top = px(y);
        ts.t.style.opacity = E.outCubic(p) * clamp(1.25 - shift * 0.11);
        ts.t.style.transform = `scale(${lerp(0.96, 1, E.outExpo(p)).toFixed(4)})`;
      });
      const cm = cfg.cam(lt, dur);
      camTransform(cam, cm.s, cm.fx, cm.fy);
    },
  };
}

scene("s2", 5.0, 10.8, 2, (root) => {
  const C = CUES.s2;
  const shotDefs = [
    chartShot({ seed: 7, ticker: "ORBF", price: 0.00098, mult: 3.6, p0: 0.28, cam: (lt, dur) => ({ s: lerp(1.08, 1, E.outCubic(lt / dur)), fx: lerp(900, 980, lt / dur), fy: lerp(560, 520, lt / dur) }) }),
    counterShot({ label: "VIEWS", from: 912400, to: 1284906, likes: [61200, 96210], comments: [2100, 3412], s0: 1.06, s1: 1 }),
    tickerShot({ seed: 3, speed: 2100, scale: 1.16, rot: -6, blur: 6 }),
    feedShot({ seed: 0, speed: 1350, rate: 1, blurY: 0, cam: (lt, dur) => ({ s: lerp(1.02, 0.97, lt / dur), fx: 960, fy: 540 }) }),
    heatShot({ seed: 0, cam: (lt, dur) => ({ s: lerp(1.12, 1.03, E.outCubic(lt / dur)), fx: 940, fy: 520 }) }),
    notifyShot({ offset: 0, every: 0.085, cam: (lt, dur) => ({ s: lerp(1.04, 1, lt / dur), fx: 960, fy: 520 }) }),
    chartShot({ seed: 19, ticker: "EMBR", mode: "candles", n: 120, price: 0.0021, mult: 2.4, p0: 0.7, header: true, cam: (lt, dur, hp) => ({ s: 1.55, fx: lerp(hp[0] - 260, hp[0] - 200, lt / dur), fy: hp[1] + 60 }) }),
    feedShot({ seed: 1, speed: 160, rate: 3, cam: (lt, dur) => ({ s: lerp(1.5, 1.42, lt / dur), fx: 960, fy: 560, rot: lerp(1.2, 0, lt / dur) }) }),
    heatShot({ seed: 9, cam: (lt, dur) => ({ s: lerp(1.95, 1.85, lt / dur), fx: 520, fy: 330 }) }),
    notifyShot({ offset: 4, every: 0.06, cam: (lt, dur) => ({ s: lerp(1.7, 1.6, lt / dur), fx: 960, fy: 260 }) }),
    chartShot({ seed: 23, ticker: "COYO", mode: "candles", n: 120, price: 0.0034, mult: 2.8, p0: 0.8, header: false, cam: (lt, dur, hp) => ({ s: 2.1, fx: hp[0] - 120, fy: hp[1] + 30 }) }),
    chartShot({ seed: 31, ticker: "VGOOSE", price: 0.0006, mult: 4.2, p0: 0.75, header: false, cam: (lt, dur, hp) => ({ s: 2.3, fx: hp[0] + 60, fy: hp[1] }) }),
    feedShot({ seed: 2, speed: 3200, rate: 2, blurY: 14, cam: () => ({ s: 1.0, fx: 960, fy: 540 }) }),
    tickerShot({ seed: 11, speed: 3600, scale: 1.3, rot: 5, blur: 11 }),
    heatShot({ seed: 21, cam: () => ({ s: 1.5, fx: 1350, fy: 760 }) }),
    feedShot({ seed: 3, speed: 90, rate: 4, cam: () => ({ s: 1.6, fx: 960, fy: 600, rot: -1.5 }) }),
    chartShot({ seed: 7, ticker: "ORBF", price: 0.00098, mult: 3.6, p0: 0.93, header: true, cam: (lt, dur, hp) => ({ s: 1.45, fx: hp[0] - 360, fy: hp[1] + 150 }) }),
  ];
  const shots = shotDefs.map((sd, i) => ({ ...sd, t0: C.cuts[i], t1: C.cuts[i + 1] ?? C.freeze }));
  const holder = abs({ left: "0", top: "0", width: "1920px", height: "1080px" });
  shots.forEach((sh) => holder.append(sh.el));
  const vignette = abs({ left: "0", top: "0", width: "1920px", height: "1080px", background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,.55) 100%)" });
  const scrim = abs({ left: "0", top: "0", width: "1920px", height: "1080px", background: "#000" });
  const head = headline(["EVERYTHING MOVES", "ON ATTENTION."], { size: 138, align: "center", lh: 1.06 });
  place(head.el, 0, 400, 1920);
  root.append(holder, vignette, scrim, head.el);
  fitWidth(head.el.firstChild, 1700);

  return (t) => {
    const te = Math.min(t, C.freeze);
    let active = null;
    for (const sh of shots) {
      const on = te >= sh.t0 && te < sh.t1 + (sh.t1 === C.freeze ? 1 : 0);
      show(sh.el, on);
      if (on) active = sh;
    }
    if (active) {
      active.upd(te - active.t0, active.t1 - active.t0, te);
      mbx.setAttribute("stdDeviation", `${active.blurX ?? 0} 0`);
      mby.setAttribute("stdDeviation", `0 ${active.blurY ?? 0}`);
    }
    const dimStart = C.words[0] - 0.15;
    scrim.style.opacity = tw(te, dimStart, dimStart + 0.25, 0, 0.6);
    holder.style.filter = te > dimStart ? `blur(${tw(te, dimStart, dimStart + 0.25, 0, 2.5).toFixed(2)}px)` : "none";
    animWords(head.words, te, 0, { times: C.words, dur: 0.5, bl: 10 });
    const push = 1 + 0.045 * E.inOutSine(prog(te, C.words[0], C.freeze));
    head.el.style.transform = `scale(${push.toFixed(4)})`;
    head.el.style.transformOrigin = "960px 130px";
  };
});

// ---------------------------------------------------------------- S3 · the opportunity (11–16.5 s)
const LINE_Y = 560;
const SPLIT = { top: LINE_Y, bottom: LINE_Y };
scene("s3", 11.3, 16.6, 5, (root) => {
  const C = CUES.s3;
  const cam = abs({ left: "0", top: "0", width: "1920px", height: "1080px", transformOrigin: "960px 540px" });
  const mask = abs({ left: "0", top: "360px", width: "1920px", height: px(LINE_Y - 8 - 360), overflow: "hidden" });
  const text = h("div", { style: { position: "absolute", left: "0", width: "1920px", top: px(LINE_Y - 8 - 360 - 150), textAlign: "center", fontSize: "124px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, whiteSpace: "nowrap", textTransform: "uppercase" } });
  const chars = [];
  for (const ch of "SO WHY NOT COMPETE FOR IT?") {
    const c = h("span", { class: "ch" + (ch === "?" ? " dot" : ""), text: ch });
    text.append(c);
    chars.push(c);
  }
  mask.append(text);
  const line = abs({ height: "2px", background: ACCENT, boxShadow: "0 0 14px rgba(44,245,158,.55)" });
  const headDot = abs({ width: "12px", height: "12px", borderRadius: "50%", background: "#eafff5", boxShadow: "0 0 18px 6px rgba(44,245,158,.75)" });
  const top = abs({ height: "2px", left: "0", width: "1920px", background: ACCENT, boxShadow: "0 0 16px rgba(44,245,158,.6)" });
  const bot = abs({ height: "2px", left: "0", width: "1920px", background: ACCENT, boxShadow: "0 0 16px rgba(44,245,158,.6)" });
  cam.append(mask, line, headDot);
  root.append(cam, top, bot);
  if (text.scrollWidth > 1660) text.style.fontSize = px(124 * (1660 / text.scrollWidth));
  const headX = (t) => 1920 * E.outCubic(prog(t, C.line, C.lineEnd));
  const charT = chars.map((c) => {
    const r = c.getBoundingClientRect();
    const x = clamp((r.left + r.width / 2 - 40) / 1920, 0, 0.999);
    return C.line + (1 - Math.cbrt(1 - x)) * (C.lineEnd - C.line);
  });

  return (t) => {
    // Text rises out of the line as its head passes, sinks back before the reveal.
    chars.forEach((c, i) => {
      let y;
      if (t < C.textOut) y = (1 - E.outExpo(prog(t, charT[i], charT[i] + 0.55))) * 140;
      else y = E.inCubic(prog(t, C.textOut + i * 0.006, C.textOut + i * 0.006 + 0.28)) * 140;
      c.style.transform = `translateY(${y.toFixed(2)}px)`;
      blur(c, t < C.textOut ? (1 - E.outCubic(prog(t, charT[i], charT[i] + 0.3))) * 6 : 0);
    });
    cam.style.transform = `scale(${(1 + 0.035 * E.inOutSine(prog(t, C.lineEnd, C.contract))).toFixed(4)})`;
    let x0 = 0;
    let x1 = headX(t);
    let thick = 2;
    if (t >= C.contract) {
      const p = E.inExpo(prog(t, C.contract, C.reveal - 0.04));
      x0 = lerp(0, 900, p);
      x1 = lerp(1920, 1020, p);
      thick = lerp(2, 3, p);
    }
    const drawing = t < C.reveal;
    show(line, drawing && t >= C.line);
    place(line, x0, LINE_Y - thick / 2, Math.max(0, x1 - x0), thick);
    show(headDot, t >= C.line && t < C.lineEnd + 0.05);
    place(headDot, x1 - 6, LINE_Y - 6);
    // The line snaps across and splits, opening onto the logo (S4 is clipped to the gap).
    const sp = E.outExpo(prog(t, C.reveal, C.reveal + 0.5));
    const d = sp * 640;
    SPLIT.top = LINE_Y - d;
    SPLIT.bottom = LINE_Y + d;
    const on = t >= C.reveal;
    show(top, on);
    show(bot, on);
    const op = 1 - prog(t, C.reveal + 0.22, C.reveal + 0.5);
    top.style.top = px(SPLIT.top - 1);
    bot.style.top = px(SPLIT.bottom - 1);
    top.style.opacity = op;
    bot.style.opacity = op;
  };
});

// ---------------------------------------------------------------- S4 · the reveal (16–21 s)
const HEADER = { symLeft: 384, symTop: 18, symH: 19, wordInkLeft: 412.5, wordCapTop: 21.5, wordSize: 15 };
let fontMetrics;
function measureFont() {
  const c = document.createElement("canvas").getContext("2d");
  c.font = "600 1000px Geist";
  const m = c.measureText("VYRAL");
  const v = c.measureText("V");
  return { A: m.fontBoundingBoxAscent / 1000, D: m.fontBoundingBoxDescent / 1000, cap: m.actualBoundingBoxAscent / 1000, vLeft: -v.actualBoundingBoxLeft / 1000 };
}
scene("s4", 16.0, 21.1, 4, (root) => {
  const C = CUES.s4;
  fontMetrics = measureFont();
  const SYM_HGT = 330;
  const sym = buildSymbol(SYM_HGT, { lattice: true, sweeps: true, id: "s4" });
  const k0 = sym.k;
  const symLeft0 = 960 - (SYM_W * k0) / 2;
  const symTop0 = 265;
  const cam = abs({ left: "0", top: "0", width: "1920px", height: "1080px", transformOrigin: "960px 540px" });
  const glow = abs({ left: px(960 - 700), top: px(430 - 700), width: "1400px", height: "1400px", background: "radial-gradient(circle, rgba(44,245,158,.16) 0%, rgba(44,245,158,.05) 30%, rgba(44,245,158,0) 62%)" });
  place(sym.wrap, symLeft0, symTop0);
  // Wordmark: clipped letters on one baseline (same type settings as the site header).
  const WORD = 96;
  const PAD = 0.18;
  const word = abs({ top: "0", left: "0", fontSize: px(WORD), fontWeight: 600, letterSpacing: "0.16em", lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", padding: `${PAD}em 0`, transformOrigin: "0 0" });
  const letters = "VYRAL".split("").map((ch) => {
    const l = h("span", { class: "ch", text: ch });
    word.append(l);
    return l;
  });
  const tag = h("div", { class: "mono", style: { position: "absolute", left: "0", width: "1920px", top: "778px", textAlign: "center", fontSize: "22px", letterSpacing: "0.34em", paddingLeft: "0.34em", color: "#8b8b94" }, html: 'THE VIRAL LAUNCHPAD ON SOLANA<span class="dot">.</span>' });
  cam.append(glow, sym.wrap, word, tag);
  root.append(cam);
  const wordW = word.getBoundingClientRect().width;
  const wordLeft0 = 960 - (wordW - 0.16 * WORD) / 2;
  const wordTop0 = 638;
  place(word, wordLeft0, wordTop0);
  // Cap-top offset of the wordmark box (line-height 1 plus vertical padding).
  const capOff = (F) => F * (PAD + (1 + fontMetrics.A - fontMetrics.D) / 2 - fontMetrics.cap);
  const word0 = { x: wordLeft0, y: wordTop0, F: WORD };
  const wordEnd = { x: HEADER.wordInkLeft - fontMetrics.vLeft * HEADER.wordSize, y: HEADER.wordCapTop - capOff(HEADER.wordSize), F: HEADER.wordSize };
  const symEnd = { x: HEADER.symLeft, y: HEADER.symTop, k: HEADER.symH / SYM_H };

  return (t) => {
    const [u0] = C.units;
    slamUnits(sym, t, C.units);
    sym.lines.forEach((l, i) => {
      const t0 = u0 + 0.12 + (i % 12) * 0.02;
      l.setAttribute("stroke-dashoffset", (1 - E.outCubic(prog(t, t0, t0 + 0.75))).toFixed(4));
    });
    const sw = prog(t, C.sweep, C.sweep + 0.85);
    sym.sweepRects[0].setAttribute("opacity", sw > 0 && sw < 1 ? 1 : 0);
    sym.sweepRects[0].setAttribute("transform", `translate(${lerp(-260, 640, E.inOutCubic(sw)).toFixed(1)} ${SYM_H / 2}) rotate(32)`);
    const sw2 = prog(t, C.sweep + 2.3, C.sweep + 3.2);
    sym.sweepRects[1].setAttribute("opacity", sw2 > 0 && sw2 < 1 ? 1 : 0);
    sym.sweepRects[1].setAttribute("transform", `translate(${lerp(-260, 640, E.inOutCubic(sw2)).toFixed(1)} ${SYM_H / 2}) rotate(32)`);
    const impact = Math.max(...C.units.map((tu) => (t >= tu ? Math.exp(-(t - tu) / 0.35) : 0)));
    glow.style.opacity = (0.35 + 0.65 * impact + 0.35 * Math.sin(Math.PI * sw)) * (1 - prog(t, C.move, C.move + 0.3));
    letters.forEach((l, i) => {
      const t0 = C.word + i * 0.045;
      l.style.transform = `translateY(${((1 - E.outExpo(prog(t, t0, t0 + 0.65))) * 1.45).toFixed(4)}em)`;
    });
    const tp = prog(t, C.tag, C.tag + 0.8);
    tag.style.clipPath = `inset(0 ${((1 - E.outCubic(tp)) * 100).toFixed(2)}% 0 0)`;
    tag.style.opacity = tp > 0 ? 1 - prog(t, C.move, C.move + 0.18) : 0;
    // Camera: impact shake, slow push-in.
    let sx = 0;
    let sy = 0;
    C.units.forEach((tu, i) => {
      if (t < tu) return;
      const a = [7, 5, 4][i] * Math.exp(-(t - tu) / 0.09);
      sx += a * Math.sin((t - tu) * 2 * Math.PI * 23 + i);
      sy += a * Math.cos((t - tu) * 2 * Math.PI * 19 + i * 2);
    });
    const g = 1 + 0.03 * E.inOutSine(prog(t, C.word, C.move));
    sym.lines.forEach((l) => l.parentNode && (l.parentNode.style.opacity = 1 - prog(t, C.move, C.move + 0.3)));
    if (t < C.move) {
      cam.style.transform = `translate(${sx.toFixed(2)}px, ${sy.toFixed(2)}px) scale(${g.toFixed(4)})`;
      sym.wrap.style.transform = "none";
      word.style.transform = "none";
    } else {
      // Match cut: symbol and wordmark fly into the site header's logo.
      cam.style.transform = "none";
      const gm = 1 + 0.03;
      const toScreen = (x, y) => [960 + (x - 960) * gm, 540 + (y - 540) * gm];
      const p = E.inOutCubic(prog(t, C.move, C.moveEnd));
      const [sx0, sy0] = toScreen(symLeft0, symTop0);
      const ks = lerp(k0 * gm, symEnd.k, p);
      const sxp = lerp(sx0, symEnd.x, p);
      const syp = lerp(sy0, symEnd.y, p);
      sym.wrap.style.transform = `translate(${(sxp - symLeft0).toFixed(3)}px, ${(syp - symTop0).toFixed(3)}px) scale(${(ks / k0).toFixed(5)})`;
      const [wx0, wy0] = toScreen(word0.x, word0.y);
      const F = lerp(WORD * gm, wordEnd.F, p);
      const wx = lerp(wx0, wordEnd.x, p);
      const wy = lerp(wy0, wordEnd.y, p);
      word.style.transform = `translate(${(wx - wordLeft0).toFixed(3)}px, ${(wy - wordTop0).toFixed(3)}px) scale(${(F / WORD).toFixed(5)})`;
    }
    const fadeOut = 1 - prog(t, C.moveEnd - 0.05, C.moveEnd + 0.1);
    sym.wrap.style.opacity = fadeOut;
    word.style.opacity = fadeOut;
    // Opening: S4 is only visible between the split lines.
    root.style.clipPath = t < CUES.s3.reveal + 0.5 ? `inset(${Math.max(0, SPLIT.top).toFixed(1)}px 0 ${Math.max(0, 1080 - SPLIT.bottom).toFixed(1)}px 0)` : "none";
  };
});

// ---------------------------------------------------------------- S5 · the product (21–29 s)
const CHROME = 52;
scene("s5", 20.5, 29.06, 3, (root) => {
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
  const scrim = abs({ left: "0", top: "0", width: "1920px", height: "300px", background: "linear-gradient(#050506 0%, rgba(5,5,6,.92) 48%, rgba(5,5,6,0) 100%)" });
  const H = ["LAUNCH A COIN.", "GET YOUR OWN COMPETITION.", "SUBMIT YOUR VIDEOS."].map((txt) => {
    const hl = headline([txt], { size: 84 });
    place(hl.el, 192, 92);
    return hl;
  });
  const label = h("div", { class: "mono", style: { position: "absolute", right: "44px", bottom: "40px", fontSize: "14px", letterSpacing: "0.2em", color: "#8b8b94", background: "rgba(5,5,6,.86)", border: "1px solid #1d1d21", borderRadius: "8px", padding: "9px 14px 9px 17px" }, text: "PRODUCT UI · ILLUSTRATIVE DATA" });
  root.append(cam, scrim, ...H.map((x) => x.el), label);
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
    root.style.opacity = t < C.start ? E.inOutCubic(prog(t, CUES.s4.move + 0.3, CUES.s4.moveEnd)) : 1 - prog(t, C.zoom + 0.26, C.zoom + 0.4);
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
const ROUND = [29.0, C6.checkpoint];
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
    [29.0, heroScoreAt(0)],
    [29.35, heroScoreAt(0)],
    [30.3, 52],
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
  for (let t = 28.8; t <= 36.3; t += 1 / 240) {
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
scene("s6", 28.8, 36.2, 6, (root) => {
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
    const hl = headline([w], { size: 92 });
    place(hl.el, 120, 300 + i * 106);
    return hl;
  });
  const one = headline(["ONE", "VIRAL", "SCORE."], { size: 92, lh: 1.12 });
  place(one.el, 120, 300);
  const formula = h("div", { class: "mono", style: { position: "absolute", left: "120px", top: "660px", fontSize: "17px", lineHeight: 1.7, letterSpacing: "0.08em", color: "#a1a1aa" }, html: `VIEWS 50% · LIKES 25% · COMMENTS 25%<br><span style="color:#71717a">ADJUSTED PER PLATFORM</span>` });
  root.append(panel, ...words.map((w) => w.el), one.el, formula);
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
    const hlCol = t < C.words[0] ? null : t < C.words[1] ? [0] : t < C.words[2] ? [1] : t < C.words[2] + 0.6 ? [2] : t < C.score ? [0, 1, 2] : [3];
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
    const remain = Math.max(0, Math.round(lerp(6 * 3600 - 2, 0, prog(t, 29.0, C.checkpoint))));
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
    words.forEach((w, i) => animWords(w.words, t, C.words[i], { tout: C.score - 0.42 + i * 0.05, dur: 0.5, outDur: 0.28 }));
    animWords(one.words, t, C.score, { tout: C.expand - 0.1, stagger: 0.08 });
    const fp = prog(t, C.formula, C.formula + 0.5);
    formula.style.opacity = E.outCubic(fp) * (1 - prog(t, C.expand - 0.1, C.expand + 0.15));
    formula.style.transform = `translateY(${((1 - E.outExpo(fp)) * 16).toFixed(2)}px)`;
  };
});

// ---------------------------------------------------------------- S7 · the rewards (36–41 s)
const CARD = { x: 880, y: 170, w: 940, h: 740 };
const S8_SYM_H = 150;
const S8_SYM_TOP = 255;
const S8_K = S8_SYM_H / SYM_H;
const S8_UNIT0 = [960 - (SYM_W * S8_K) / 2 + unitCenter(UNITS[0])[0] * S8_K, S8_SYM_TOP + unitCenter(UNITS[0])[1] * S8_K];
scene("s7", 35.5, 41.1, 7, (root) => {
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
      t_(L, 398, { fontSize: "17px", color: "#8b8b94", width: px(R - L) }, "47.3% of newly confirmed creator fees, the share set by the reward curve at a $28.7K market cap."),
    ],
  ];
  // Transfer: reward vault → creator wallet.
  const nodeBox = (inner) => h("div", { style: { width: "64px", height: "64px", borderRadius: "16px", background: "#111114", border: "1px solid #26262c", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 64px" } }, inner);
  const vaultIcon = s("svg", { width: 26, height: 27, viewBox: `0 0 ${SYM_W} ${SYM_H}` }, s("path", { d: SYM_PATH, fill: ACCENT }));
  const walletIcon = s("svg", { width: 28, height: 28, viewBox: "0 0 24 24" }, s("path", { d: "M4 6.5A2.5 2.5 0 0 1 6.5 4H18v3H6.5a.5.5 0 0 0 0 1H20v10.5a1.5 1.5 0 0 1-1.5 1.5h-12A2.5 2.5 0 0 1 4 17.5Z", fill: "#e4e4e7" }), s("circle", { cx: 16.5, cy: 13.5, r: 1.4, fill: "#111114" }));
  const nodeB = nodeBox(walletIcon);
  const transfer = [
    place(abs({ background: "#1d1d21", height: "1px" }), L, 452, R - L),
    t_(L, 484, { display: "flex", alignItems: "center", gap: "16px" }, h("div", { style: { display: "flex", alignItems: "center", gap: "16px" } }, nodeBox(vaultIcon), h("div", {}, h("div", { style: { fontSize: "19px", fontWeight: 500 }, text: "Reward vault" }), h("div", { style: { fontSize: "14px", color: "#71717a", marginTop: "4px" }, text: "Creator fees" })))),
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
  const head = headline(["COMPETE FOR", "CREATOR", "REWARDS."], { size: 88, lh: 1.1 });
  place(head.el, 120, 290);
  const second = h("div", { class: "mono", style: { position: "absolute", left: "120px", top: "650px", fontSize: "19px", letterSpacing: "0.12em", lineHeight: 1.65, color: "#a1a1aa" }, html: 'REWARDS POWERED BY<br>GENERATED CREATOR FEES<span class="dot">.</span>' });
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

// ---------------------------------------------------------------- S8 · end card (41–45 s)
scene("s8", 40.3, 45.01, 8, (root) => {
  const C = CUES.s8;
  const sym = buildSymbol(S8_SYM_H, { id: "s8" });
  const left = 960 - (SYM_W * S8_K) / 2;
  place(sym.wrap, left, S8_SYM_TOP);
  const glow = abs({ left: px(960 - 520), top: px(330 - 520), width: "1040px", height: "1040px", background: "radial-gradient(circle, rgba(44,245,158,.18) 0%, rgba(44,245,158,.05) 32%, rgba(44,245,158,0) 62%)", opacity: 0 });
  const word = h("div", { style: { position: "absolute", left: "0", width: "1920px", top: "446px", textAlign: "center", fontSize: "58px", fontWeight: 600, letterSpacing: "0.16em", paddingLeft: "0.16em", lineHeight: 1.3, overflow: "hidden" } });
  const letters = "VYRAL".split("").map((ch) => {
    const l = h("span", { class: "ch", text: ch });
    word.append(l);
    return l;
  });
  const slogan = headline(["LAUNCH. CREATE. COMPETE. GET PAID."], { size: 50, tracking: -0.02, align: "center" });
  place(slogan.el, 0, 590, 1920);
  const solana = h("div", { class: "mono", style: { position: "absolute", left: "0", width: "1920px", top: "674px", textAlign: "center", fontSize: "22px", letterSpacing: "0.36em", paddingLeft: "0.36em", color: "#a1a1aa" }, html: 'BUILT ON SOLANA<span class="dot">.</span>' });
  const url = h("div", { class: "mono", style: { position: "absolute", left: "0", width: "1920px", top: "930px", textAlign: "center", fontSize: "32px", letterSpacing: "0.04em", color: "#f4f4f5" }, text: "makevyral.com" });
  const underline = abs({ top: "984px", height: "1px", background: ACCENT });
  root.append(glow, sym.wrap, word, slogan.el, solana, url, underline);
  const urlW = (() => {
    const r = document.createElement("span");
    r.className = "mono";
    r.style.cssText = "font-size:32px;letter-spacing:0.04em;position:absolute;visibility:hidden";
    r.textContent = "makevyral.com";
    root.append(r);
    const w = r.getBoundingClientRect().width;
    r.remove();
    return w;
  })();
  const sTimes = [...C.words, C.words[3] + 0.06];

  return (t) => {
    // Units: tip forms out of the confirmation check, then the formation slams in.
    const tip = CUES.s7.out + 0.6;
    slamUnits(sym, t, [tip, C.impact, C.impact + 0.07], { from: 1.6, travel: 30, dur: 0.36 });
    // Signal pulses travel tip → outer pair.
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
      const t0 = C.impact + 0.12 + i * 0.04;
      l.style.transform = `translateY(${((1 - E.outExpo(prog(t, t0, t0 + 0.6))) * 1.4).toFixed(4)}em)`;
    });
    animWords(slogan.words, t, 0, { times: sTimes, dur: 0.55, bl: 6 });
    const sp = prog(t, C.solana, C.solana + 0.7);
    solana.style.opacity = E.outCubic(sp);
    solana.style.letterSpacing = `${lerp(0.6, 0.36, E.outExpo(sp)).toFixed(4)}em`;
    const up = prog(t, C.url, C.url + 0.6);
    url.style.opacity = E.outCubic(up);
    url.style.transform = `translateY(${((1 - E.outExpo(up)) * 18).toFixed(2)}px)`;
    const ul = E.inOutCubic(prog(t, C.url + 0.2, C.url + 0.75)) * urlW;
    place(underline, 960 - ul / 2, 984, ul);
    root.style.opacity = 1 - prog(t, C.fade, 45.0);
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
  const black = (t < 0.6 ? 1 - prog(t, 0.45, 0.6) : 0) + (t >= CUES.s2.black && t < CUES.s3.line - 0.05 ? 1 : 0);
  grain.style.opacity = (0.32 * (1 - clamp(black)) * (1 - prog(t, CUES.s8.fade, 45))).toFixed(3);
}

// ================================================================ frame API

window.renderFrame = (t) => {
  for (const sc of SCENES) {
    const on = t >= sc.t0 && t < sc.t1;
    show(sc.el, on);
    if (on) sc.upd(t);
  }
  updFlash(t);
  updGrain(t);
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
};
window.DURATION = CUES.duration;
window.FPS = CUES.fps;
