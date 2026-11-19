/**
 * End-to-end smoke test against a running dev/prod server (default http://localhost:3000).
 *
 * Injects a Wallet Standard wallet (the same discovery path Phantom/Solflare
 * use). Message signing is delegated to Node via exposeFunction, so the key
 * never enters the page. Exercises: wallet connect + signed sign-in, video
 * submission (with simulated account linking), token launch, admin review and
 * payout actions, API CSRF protection and rate limiting.
 *
 *   node e2e/run.mjs [baseUrl]
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { createRequire } from "node:module";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { testKeypair } from "./test-wallet.mjs";

// Use the project's Playwright if installed, otherwise a globally installed one.
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const BASE = args.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const OUT = new URL("./screenshots/", import.meta.url).pathname;
await mkdir(OUT, { recursive: true });

const pubkey = testKeypair.publicKey.toBase58();

// --reset: start from a freshly seeded demo database (development only).
if (args.includes("--reset")) {
  const { execSync } = await import("node:child_process");
  execSync("npx tsx scripts/reset.ts", { stdio: "inherit" });
  execSync(`npx tsx scripts/admin-add.ts ${pubkey} admin`, { stdio: "inherit" });
}
const secret = testKeypair.secretKey.slice(0, 32);
let failures = 0;
const results = [];

function check(name, ok, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/** Runs in the page before any app script. */
function injectWallet({ address, publicKey }) {
  const listeners = { change: new Set() };
  const account = {
    address,
    publicKey: new Uint8Array(publicKey),
    chains: ["solana:mainnet", "solana:devnet", "solana:testnet"],
    features: ["solana:signMessage", "solana:signTransaction", "solana:signAndSendTransaction"],
    label: "E2E",
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
      "standard:connect": {
        version: "1.0.0",
        connect: async () => {
          accounts = [account];
          emit();
          return { accounts };
        },
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => {
          accounts = [];
          emit();
        },
      },
      "standard:events": {
        version: "1.0.0",
        on: (event, listener) => {
          listeners[event]?.add(listener);
          return () => listeners[event]?.delete(listener);
        },
      },
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: async (...inputs) =>
          Promise.all(
            inputs.map(async (input) => {
              const sig = await window.__e2eSign(Array.from(input.message));
              return { signedMessage: input.message, signature: new Uint8Array(sig) };
            }),
          ),
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signTransaction: async () => {
          throw new Error("Transactions are not supported by the E2E wallet");
        },
      },
      "solana:signAndSendTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signAndSendTransaction: async () => {
          throw new Error("Transactions are not supported by the E2E wallet");
        },
      },
    },
  };
  const register = ({ register }) => register(wallet);
  window.addEventListener("wallet-standard:app-ready", ({ detail }) => register(detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await context.exposeFunction("__e2eSign", (bytes) => Array.from(ed25519.sign(Uint8Array.from(bytes), secret)));
await context.addInitScript(injectWallet, { address: pubkey, publicKey: Array.from(testKeypair.publicKey.toBytes()) });
const page = await context.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && consoleErrors.push(m.text()));

async function shot(name, full = false) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: full });
}

try {
  // 1. Connect + sign in
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Connect Wallet" }).first().click();
  await page.getByRole("button", { name: /E2E Test Wallet/ }).click();
  const short = `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;
  await page.getByRole("button", { name: new RegExp(short) }).waitFor({ timeout: 15_000 });
  check("wallet connect + signed sign-in", true, short);
  const session = await page.evaluate(() => fetch("/api/auth/session").then((r) => r.json()));
  check("session bound to wallet with admin role", session.wallet === pubkey && session.role === "admin", JSON.stringify(session));

  // 2. Submit a video to the most active competition
  const comps = await page.evaluate(() => fetch("/api/competitions?sort=trending").then((r) => r.json()));
  const target = comps.items.find((c) => c.status === "active");
  const publishedAt = new Date(Date.now() - 45 * 60_000);
  const videoId = ((BigInt(Math.floor(publishedAt.getTime() / 1000)) << 32n) | BigInt(Math.floor(Math.random() * 2 ** 31))).toString();
  const handle = "e2ecreator";
  await page.goto(`${BASE}/competitions/${target.mint}/submit`, { waitUntil: "networkidle" });
  await page.getByLabel("Public video URL").fill(`https://www.tiktok.com/@${handle}/video/${videoId}`);
  await page.getByRole("button", { name: "Check video" }).click();
  await page.getByText("Published after the token launch").waitFor({ timeout: 15_000 });
  const linkBtn = page.getByRole("button", { name: `Link @${handle}` });
  if (await linkBtn.isVisible().catch(() => false)) {
    await linkBtn.click();
    await page.getByRole("button", { name: `Link @${handle}` }).waitFor({ state: "detached", timeout: 15_000 });
  }
  await shot("e2e-submit-checks");
  await page.getByRole("button", { name: `Submit to $${target.symbol}` }).click();
  await page.getByRole("heading", { name: "Video submitted" }).waitFor({ timeout: 15_000 });
  check("video submission end-to-end", true, `$${target.symbol}`);
  await shot("e2e-submit-success");

  // Duplicate protection: the same video again must be refused.
  const dup = await page.evaluate(
    ([mint, url]) => fetch(`/api/competitions/${mint}/submissions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }).then((r) => r.status),
    [target.mint, `https://www.tiktok.com/@${handle}/video/${videoId}?is_from_webapp=1`],
  );
  check("duplicate submission rejected (422/409)", dup === 422 || dup === 409, `status ${dup}`);

  // Pre-launch video must be refused, recorded, and blocked forever after.
  const oldId = ((BigInt(Math.floor(Date.UTC(2025, 5, 1) / 1000)) << 32n) | BigInt(Math.floor(Math.random() * 2 ** 31))).toString();
  const submitOld = () =>
    page.evaluate(
      ([mint, url]) =>
        fetch(`/api/competitions/${mint}/submissions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }).then((r) => r.json()),
      [target.mint, `https://www.tiktok.com/@${handle}/video/${oldId}`],
    );
  const pre = await submitOld();
  check("pre-launch video refused", pre?.error?.code === "published_before_launch", pre?.error?.code);
  const again = await submitOld();
  check("pre-launch video blocked on resubmission", again?.error?.code === "check_failed_not_previously_submitted", again?.error?.code);

  // 3. Launch a token
  const png = await sharp({ create: { width: 256, height: 256, channels: 3, background: { r: 44, g: 245, b: 158 } } }).png().toBuffer();
  await page.goto(`${BASE}/launch`, { waitUntil: "networkidle" });
  await page.getByLabel("Name").fill("E2E Falcon");
  await page.getByLabel("Ticker").fill("EFAL");
  await page.getByLabel("Description").fill("Launched by the end-to-end test suite.");
  await page.locator('input[type="file"]').setInputFiles({ name: "token.png", mimeType: "image/png", buffer: png });
  await page.getByLabel("Every 3 hours").check();
  await page.getByRole("checkbox").check();
  await shot("e2e-launch-form", true);
  await page.getByRole("button", { name: "Launch token" }).click();
  await page.waitForURL(/\/competitions\/.+\?launched=1/, { timeout: 30_000 });
  await page.getByText("Your token is live.").waitFor({ timeout: 15_000 });
  check("token launch → competition page", true, page.url().split("/competitions/")[1]);
  await shot("e2e-launched");

  // 4. Admin: review queue + payouts
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Overview" }).waitFor();
  await shot("e2e-admin-overview", true);
  await page.goto(`${BASE}/admin/review`, { waitUntil: "networkidle" });
  const verifyBtn = page.getByRole("button", { name: "Verify" }).first();
  if (await verifyBtn.isVisible().catch(() => false)) {
    await shot("e2e-admin-review");
    await verifyBtn.click();
    await page.getByLabel("Note for the audit log").fill("E2E: engagement consistent with organic growth.");
    await page.getByRole("dialog").getByRole("button", { name: "Verify" }).click();
    await page.getByText(/Recorded in the audit log/).first().waitFor({ timeout: 10_000 });
    check("admin verify from review queue", true);
  } else {
    check("admin verify from review queue", false, "no item in queue");
  }
  await page.goto(`${BASE}/admin/payouts`, { waitUntil: "networkidle" });
  const retry = page.getByRole("button", { name: "Retry" }).first();
  if (await retry.isVisible().catch(() => false)) {
    await shot("e2e-admin-payouts");
    await retry.click();
    await page.getByLabel("Note for the audit log").fill("E2E: retry after expired attempts.");
    await page.getByRole("dialog").getByRole("button", { name: "Retry" }).click();
    await page.getByText(/Recorded in the audit log/).first().waitFor({ timeout: 10_000 });
    check("admin payout retry", true);
  } else {
    check("admin payout retry", false, "no payout needing attention");
  }
  for (const p of ["scoring", "rules", "competitions", "fees", "disputes", "audit"]) {
    await page.goto(`${BASE}/admin/${p}`, { waitUntil: "networkidle" });
    await shot(`e2e-admin-${p}`, true);
  }
  const auditText = await page.locator("table").innerText();
  check("audit log records admin actions", /video\.review\.verify/.test(auditText) && /payout\.retry/.test(auditText));

  // 5. Account page
  await page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Linked accounts" }).waitFor();
  await shot("e2e-account", true);
  check("account page (linked accounts, rewards, disputes)", true);
} catch (e) {
  check("E2E flow", false, e instanceof Error ? e.message.split("\n")[0] : String(e));
  await page.screenshot({ path: `${OUT}e2e-failure.png`, fullPage: true }).catch(() => {});
}

// 6. API protections (outside the browser)
try {
const csrf = await fetch(`${BASE}/api/auth/verify`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
  body: JSON.stringify({}),
});
check("cross-origin POST blocked", csrf.status === 403, `status ${csrf.status}`);
const unauth = await fetch(`${BASE}/api/admin/config/scoring`, { method: "PUT", headers: { "Content-Type": "application/json", Origin: BASE }, body: "{}" });
check("admin API requires a session", unauth.status === 401, `status ${unauth.status}`);
const badSig = await (async () => {
  const n = await fetch(`${BASE}/api/auth/nonce?wallet=${pubkey}`).then((r) => r.json());
  const forged = bs58.encode(ed25519.sign(new TextEncoder().encode("something else"), secret));
  return fetch(`${BASE}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ wallet: pubkey, nonce: n.nonce, signature: forged }),
  }).then((r) => r.status);
})();
check("signature over a different message rejected", badSig === 401, `status ${badSig}`);
// Use a throwaway wallet so the per-wallet limit never affects the test wallet's next run.
const probe = bs58.encode(ed25519.getPublicKey(ed25519.utils.randomSecretKey()));
let limited = false;
for (let i = 0; i < 40 && !limited; i++) {
  const r = await fetch(`${BASE}/api/auth/nonce?wallet=${probe}`);
  if (r.status === 429) limited = true;
}
check("rate limiting on sign-in nonces (per wallet)", limited);
} catch (e) {
  check("API protection checks", false, e instanceof Error ? e.message.split("\n")[0] : String(e));
}

check("no uncaught page errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
await browser.close();
console.log(results.join("\n"));
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
