/**
 * Preview sheet: the four banners as X shows them on desktop, with the profile
 * picture overlapping the bottom left (X: 133 px avatar on a 600 px wide
 * header, i.e. ~333 px of the 1500 px banner, centred on its bottom edge).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
const names = ["01-architectural-minimalism", "02-geometric-depth", "03-technical-system", "04-bold-statement"];
const titles = ["01 · Architectural Minimalism", "02 · Geometric Depth", "03 · Abstract Technical System", "04 · Bold Brand Statement"];
const png = (n) => `data:image/png;base64,${readFileSync(join(out, `vyral-x-banner-${n}@2x.png`)).toString("base64")}`;
const avatar = `data:image/png;base64,${readFileSync(join(here, "..", "..", "public/brand/vyral-logo-primary-512.png")).toString("base64")}`;

const blocks = names
  .map(
    (n, i) => `
  <section>
    <p>${titles[i]}</p>
    <div class="frame"><img class="banner" src="${png(n)}"/><img class="avatar" src="${avatar}"/></div>
  </section>`,
  )
  .join("");
const html = `<!doctype html><html><head><style>
  body { margin: 0; background: #151515; font: 500 22px/1.2 system-ui, sans-serif; color: #9a9a9a; padding: 48px 60px 120px; }
  section { margin-bottom: 230px; }
  p { margin: 0 0 18px; letter-spacing: .04em; }
  .frame { position: relative; width: 1500px; height: 500px; }
  .banner { width: 1500px; height: 500px; display: block; }
  .avatar { position: absolute; left: 40px; top: 333px; width: 333px; height: 333px; border-radius: 50%; border: 10px solid #151515; box-sizing: border-box; }
</style></head><body>${blocks}</body></html>`;

const { chromium } = require("playwright");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1620, height: 800 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" });
await page.screenshot({ path: join(out, "preview-with-profile-picture.png"), fullPage: true });
await browser.close();
console.log("preview written");
