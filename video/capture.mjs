/**
 * Captures real VYRAL screens for the launch trailer (3840×2160 @ 2x).
 *
 *   node video/capture.mjs [baseUrl]     (default http://localhost:3000)
 *
 * Uses the same injected Wallet Standard test wallet as the E2E suite to sign
 * in. Nothing is launched or submitted. The site's demonstration banner and
 * tags are hidden for a clean frame; the trailer labels these scenes as
 * illustrative data instead.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { testKeypair } from "../e2e/test-wallet.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const OUT = new URL("./assets/ui/", import.meta.url).pathname;
await mkdir(OUT, { recursive: true });
const pubkey = testKeypair.publicKey.toBase58();
const secret = testKeypair.secretKey.slice(0, 32);

function injectWallet({ address, publicKey }) {
  const listeners = { change: new Set() };
  const account = {
    address,
    publicKey: new Uint8Array(publicKey),
    chains: ["solana:mainnet", "solana:devnet"],
    features: ["solana:signMessage", "solana:signTransaction", "solana:signAndSendTransaction"],
    label: "Demo",
  };
  const unsupported = async () => {
    throw new Error("Transactions are not supported by the capture wallet");
  };
  let accounts = [];
  const emit = () => listeners.change.forEach((l) => l({ accounts }));
  const wallet = {
    version: "1.0.0",
    name: "E2E Test Wallet",
    icon: "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="6" fill="#444"/></svg>'),
    chains: account.chains,
    get accounts() {
      return accounts;
    },
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ((accounts = [account]), emit(), { accounts }) },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => ((accounts = []), emit()) },
      "standard:events": { version: "1.0.0", on: (e, l) => (listeners[e]?.add(l), () => listeners[e]?.delete(l)) },
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: async (...inputs) =>
          Promise.all(inputs.map(async (i) => ({ signedMessage: i.message, signature: new Uint8Array(await window.__sign(Array.from(i.message))) }))),
      },
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: unsupported },
      "solana:signAndSendTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signAndSendTransaction: unsupported },
    },
  };
  const register = ({ register }) => register(wallet);
  window.addEventListener("wallet-standard:app-ready", ({ detail }) => register(detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
}

/** Hide demo chrome and freeze animations so every capture is deterministic. */
const CLEAN = `
  .formation-unit, .formation-line, .flywheel-orbit, .flywheel-station, .animate-fade-in, .animate-pulse-soft, .animate-shimmer { animation: none !important; }
  .formation-line { stroke-dashoffset: 0 !important; }
  nextjs-portal { display: none !important; }
`;
async function clean(page) {
  await page.addStyleTag({ content: CLEAN });
  await page.evaluate(() => {
    // The banner is <div><p><span>Demonstration environment.</span> …</p></div>; remove exactly that div.
    for (const span of document.querySelectorAll("span")) {
      if (span.textContent?.trim() === "Demonstration environment." && span.parentElement?.tagName === "P") span.parentElement.parentElement?.remove();
    }
    // Other demo-environment notices: remove the outermost element that holds only that notice.
    const notices = [/^Simulated token:/, /^Demonstration environment: you/, /^Disabled in the demonstration environment/, /^Not on-chain \(simulated\)/, /· simulated$/];
    for (const el of [...document.querySelectorAll("p, span, div")]) {
      const text = el.textContent?.trim() ?? "";
      if (!el.isConnected || !notices.some((re) => re.test(text))) continue;
      let top = el;
      while (top.parentElement && top.parentElement.textContent?.trim() === text) top = top.parentElement;
      top.remove();
    }
    // The story launches the coin in this scene; show it as just launched.
    for (const el of document.querySelectorAll("span, p, div")) {
      if (el.children.length === 0 && /^Launched \d+[smhd] ago$/.test(el.textContent?.trim() ?? "")) el.textContent = "Launched just now";
    }
    for (const tag of document.querySelectorAll('[title^="Demonstration data"]')) tag.style.visibility = "hidden";
    for (const el of document.querySelectorAll("span, p")) {
      if (/^simulated data$/i.test(el.textContent?.trim() ?? "") && el.children.length === 0) el.style.visibility = "hidden";
    }
    // Toasts (e.g. "Linked @handle") are transient UI.
    for (const el of document.querySelectorAll('[role="status"], [aria-live="polite"] > *')) {
      if (el.closest('[aria-live="polite"]') && el.textContent?.includes("Linked")) el.remove();
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(300);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
await context.exposeFunction("__sign", (bytes) => Array.from(ed25519.sign(Uint8Array.from(bytes), secret)));
await context.addInitScript(injectWallet, { address: pubkey, publicKey: Array.from(testKeypair.publicKey.toBytes()) });
const page = await context.newPage();
const shot = async (name, opts = {}) => {
  await clean(page);
  await page.screenshot({ path: `${OUT}${name}.jpg`, type: "jpeg", quality: 92, ...opts });
  console.log("captured", name);
};

const comps = await (await fetch(`${BASE}/api/competitions?sort=trending`)).json();
const coin = comps.items[0];

// Home hero.
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await shot("home");

// Sign in with the test wallet.
await page.getByRole("button", { name: "Connect Wallet" }).first().click();
await page.getByRole("button", { name: /E2E Test Wallet/ }).click();
await page.getByRole("button", { name: new RegExp(pubkey.slice(0, 4)) }).first().waitFor({ timeout: 20_000 });

// Launch form, filled in (nothing is submitted).
await page.goto(`${BASE}/launch`, { waitUntil: "networkidle" });
await page.getByLabel("Name").fill(coin.name);
await page.getByLabel("Ticker").fill(coin.symbol);
await page.getByLabel("Description").fill("The coldest cat on Solana. Every video about it can win its creator fees.");
await page.locator('input[type="file"]').setInputFiles(new URL("./assets/glacier-cat.png", import.meta.url).pathname);
await page.getByLabel("Every 6 hours").check();
for (const box of await page.getByRole("checkbox").all()) await box.check();
await page.waitForTimeout(400);
await shot("launch", { fullPage: true });

// The coin's competition, as the deployer sees it right after launching.
await page.goto(`${BASE}/competitions/${coin.mint}?launched=1`, { waitUntil: "networkidle" });
await shot("competition", { fullPage: true });

// Submitting a video: link checked against every rule.
const publishedAt = new Date(Date.now() - 40 * 60_000);
let id = (BigInt(Math.floor(publishedAt.getTime() / 1000)) << 32n) | 123457n;
if (id % 1000n === 0n) id += 1n;
const handle = "novaclips";
await page.goto(`${BASE}/competitions/${coin.mint}/submit`, { waitUntil: "networkidle" });
await page.getByLabel("Public video URL").fill(`https://www.tiktok.com/@${handle}/video/${id}`);
await page.getByRole("button", { name: "Check video" }).click();
await page.getByText("Published after the token launch").waitFor({ timeout: 20_000 });
const link = page.getByRole("button", { name: `Link @${handle}` });
if (await link.isVisible().catch(() => false)) {
  await link.click();
  await link.waitFor({ state: "detached", timeout: 20_000 });
}
await page.getByText("Post contains the coin's contract address").waitFor();
await page.waitForTimeout(500);
await shot("submit", { fullPage: true });

// Token page with chart.
await page.goto(`${BASE}/token/${coin.mint}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await shot("token");

await browser.close();
console.log(JSON.stringify({ coin: { name: coin.name, symbol: coin.symbol, mint: coin.mint } }));
