"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { ImageUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/misc";
import { TokenAvatar } from "@/components/ui/token-avatar";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/components/wallet/auth-provider";
import { api, ApiClientError } from "@/lib/client/api";
import { bpsToPct, cn, fullNumber } from "@/lib/format";
import { FeeSplitBar, FeeSplitLegend } from "@/components/fee-split";
import { CREATOR_FEE_SPLIT } from "@/lib/launch/fee-split";
import { TERMS_VERSION } from "@/lib/legal";

export type LaunchConfig = {
  allowedIntervalsHours: number[];
  defaultIntervalHours: number;
  minVerifiedViews: number;
  simulated: boolean;
  supply: number;
  /** Admins may mark a launch as the official $VYRAL coin (shown in the site header). */
  canSetOfficial: boolean;
};

type Prepared = {
  launchId: string;
  mint: string;
  mode: "message" | "transaction";
  message: string | null;
  transaction: string | null;
  followUp: string[];
  simulated: boolean;
};

type Errors = Partial<Record<"name" | "symbol" | "description" | "image" | "website" | "x" | "telegram" | "discord" | "ack" | "terms", string>>;

const STEP_LABEL = {
  idle: "",
  signin: "Verifying wallet…",
  upload: "Uploading image…",
  prepare: "Preparing launch…",
  sign: "Waiting for wallet signature…",
  confirm: "Confirming launch…",
} as const;
type Step = keyof typeof STEP_LABEL;

const MAX_IMAGE = 4 * 1024 * 1024;

function validUrl(v: string, hosts?: string[]) {
  if (!v) return true;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:") return false;
    return !hosts || hosts.includes(u.hostname.replace(/^www\./, ""));
  } catch {
    return false;
  }
}

const competitionPct = bpsToPct(CREATOR_FEE_SPLIT.vaultBps);
const deployerPct = bpsToPct(CREATOR_FEE_SPLIT.deployerBps);
const buybackPct = bpsToPct(CREATOR_FEE_SPLIT.buybackBps);
const treasuryPct = bpsToPct(CREATOR_FEE_SPLIT.treasuryBps);
/** Name + ticker bytes up to which the first buy still fits in the launch transaction (measured on mainnet). */
const SINGLE_TX_NAME_BYTES = 20;

const PENDING_KEY = "vyral:pending-launch";
type PendingLaunch = { launchId: string; signature: string };

/** A launch that was sent but not registered yet; remembered so a reload can finish it. */
function savePending(p: PendingLaunch | null) {
  try {
    if (p) window.localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else window.localStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function LaunchForm({ config }: { config: LaunchConfig }) {
  const router = useRouter();

  // Finish a launch whose registration did not complete (closed tab, slow network): the coin exists on-chain.
  useEffect(() => {
    let pending: PendingLaunch | null = null;
    try {
      pending = JSON.parse(window.localStorage.getItem(PENDING_KEY) ?? "null") as PendingLaunch | null;
    } catch {
      pending = null;
    }
    if (!pending?.launchId || !pending.signature) return;
    api<{ mint: string }>("/api/launch/confirm", { body: pending })
      .then((r) => {
        savePending(null);
        router.push(`/competitions/${r.mint}?launched=1`);
      })
      .catch((err) => {
        // Keep it only while the chain might still confirm it; drop it once it is definitely invalid.
        if (err instanceof ApiClientError && err.code !== "launch_not_verified" && err.code !== "unauthorized") savePending(null);
      });
  }, [router]);
  const toast = useToast();
  const { ensureSignedIn, signText, wallet } = useAuth();
  const { sendTransaction, signAllTransactions } = useWallet();
  const [official, setOfficial] = useState(false);
  const { connection } = useConnection();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<{ file: File; url: string } | null>(null);
  const file = image?.file ?? null;
  const preview = image?.url ?? null;
  const latestUrl = useRef<string | null>(null);
  const [links, setLinks] = useState({ website: "", x: "", telegram: "", discord: "" });
  const [interval, setInterval] = useState(config.defaultIntervalHours);
  const [initialBuy, setInitialBuy] = useState("");
  const [ack, setAck] = useState(false);
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [step, setStep] = useState<Step>("idle");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Release the preview object URL on unmount.
  useEffect(
    () => () => {
      if (latestUrl.current) URL.revokeObjectURL(latestUrl.current);
    },
    [],
  );

  const ticker = symbol.replace(/^\$/, "").toUpperCase();

  function pickFile(f: File | undefined | null) {
    if (!f) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(f.type)) {
      setErrors((e) => ({ ...e, image: "Use a PNG, JPG, WebP or GIF image." }));
      return;
    }
    if (f.size > MAX_IMAGE) {
      setErrors((e) => ({ ...e, image: "Images must be 4 MB or smaller." }));
      return;
    }
    setErrors((e) => ({ ...e, image: undefined }));
    if (latestUrl.current) URL.revokeObjectURL(latestUrl.current);
    const url = URL.createObjectURL(f);
    latestUrl.current = url;
    setImage({ file: f, url });
  }

  function validate(): Errors {
    const e: Errors = {};
    if (name.trim().length < 2) e.name = "Name must be at least 2 characters.";
    if (name.trim().length > 32) e.name = "Name must be 32 characters or fewer.";
    if (!/^[A-Z0-9]{2,10}$/.test(ticker)) e.symbol = "Ticker must be 2–10 letters or digits.";
    if (description.length > 600) e.description = "Description must be 600 characters or fewer.";
    if (!file) e.image = "Upload a token image.";
    if (!validUrl(links.website)) e.website = "Enter a valid https:// link.";
    if (!validUrl(links.x, ["x.com", "twitter.com"])) e.x = "Use an x.com link.";
    if (!validUrl(links.telegram, ["t.me", "telegram.me"])) e.telegram = "Use a t.me link.";
    if (!validUrl(links.discord, ["discord.gg", "discord.com"])) e.discord = "Use a discord.gg link.";
    if (!ack) e.ack = "Confirm that you reviewed the fee-sharing configuration.";
    if (!terms) e.terms = "Accept the Terms of Use and the risk notice to launch.";
    return e;
  }

  /** Polls until the transaction is confirmed (throws if it failed on-chain or did not land within ~90 s). */
  async function waitForLanding(sig: string) {
    for (let i = 0; i < 45; i++) {
      const { value } = await connection.getSignatureStatuses([sig], { searchTransactionHistory: true });
      const st = value[0];
      if (st?.err) throw new Error("The launch transaction failed on-chain. Nothing was created; only the network fee was spent.");
      if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return;
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error("The launch transaction has not landed yet. If it does, your coin will be live; check your wallet before trying again.");
  }

  async function launch() {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      setStep("signin");
      if (!(await ensureSignedIn())) return setStep("idle");

      setStep("upload");
      const form = new FormData();
      form.append("file", file!);
      const upload = await api<{ id: string; url: string }>("/api/uploads", { form });

      setStep("prepare");
      const prepared = await api<Prepared>("/api/launch/prepare", {
        body: {
          name: name.trim(),
          symbol: ticker,
          description: description.trim(),
          imageUploadId: upload.id,
          links: Object.fromEntries(Object.entries(links).filter(([, v]) => v.trim())),
          payoutIntervalHours: interval,
          initialBuySol: config.simulated ? 0 : Number(initialBuy || 0),
          termsVersion: TERMS_VERSION,
          ...(config.canSetOfficial && official ? { official: true } : {}),
        },
      });

      setStep("sign");
      let signature: string;
      if (prepared.mode === "message" && prepared.message) {
        signature = await signText(prepared.message);
      } else if (prepared.transaction) {
        const decode = (b64: string): Transaction | VersionedTransaction => {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          try {
            return VersionedTransaction.deserialize(bytes);
          } catch {
            return Transaction.from(bytes);
          }
        };
        const tx = decode(prepared.transaction);
        const followUp = prepared.followUp.map(decode);
        if (followUp.length && signAllTransactions) {
          // One wallet prompt: the launch first, then the initial buy once the coin exists.
          const [signedLaunch, ...signedRest] = await signAllTransactions([tx, ...followUp]);
          signature = await connection.sendRawTransaction(signedLaunch.serialize());
          await waitForLanding(signature);
          for (const t of signedRest) {
            try {
              await connection.sendRawTransaction(t.serialize());
            } catch {
              toast.push({ tone: "neutral", title: "Initial buy not sent", description: "Your coin is live; you can buy it on its token page." });
            }
          }
        } else {
          signature = await sendTransaction(tx, connection);
          for (const t of followUp) {
            await waitForLanding(signature);
            await sendTransaction(t, connection).catch(() =>
              toast.push({ tone: "neutral", title: "Initial buy not sent", description: "Your coin is live; you can buy it on its token page." }),
            );
          }
        }
        // Wait until the launch has landed before VYRAL verifies it (busy network: up to ~90 s).
        await waitForLanding(signature);
      } else {
        throw new Error("Launch could not be prepared.");
      }

      setStep("confirm");
      savePending({ launchId: prepared.launchId, signature });
      let result: { mint: string } | null = null;
      for (let i = 0; i < 20 && !result; i++) {
        try {
          result = await api<{ mint: string }>("/api/launch/confirm", { body: { launchId: prepared.launchId, signature } });
        } catch (err) {
          // The server's RPC node can see the transaction a little later than the browser's.
          if (prepared.mode === "transaction" && err instanceof ApiClientError && err.code === "launch_not_verified" && i < 19) {
            await new Promise((r) => setTimeout(r, 2500));
            continue;
          }
          throw err;
        }
      }
      toast.push({ tone: "positive", title: `$${ticker} is live`, description: "Its competition is open for submissions." });
      savePending(null);
      router.push(`/competitions/${result!.mint}?launched=1`);
    } catch (err) {
      setStep("idle");
      const rejected = err instanceof Error && /reject|declin|cancel/i.test(err.message);
      toast.push({
        tone: rejected ? "neutral" : "negative",
        title: rejected ? "Signature cancelled" : "Launch failed",
        description: rejected ? "Nothing was launched." : err instanceof Error ? err.message : undefined,
      });
    }
  }

  const busy = step !== "idle";

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_380px] lg:gap-14">
      <div className="flex flex-col gap-10">
        <FormSection title="Token" description="Shown on every page, wallet and explorer.">
          <div className="grid gap-5 sm:grid-cols-[1fr_180px]">
            <Field label="Name" htmlFor="name" error={errors.name}>
              <Input id="name" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="Glacier Cat" aria-invalid={Boolean(errors.name)} />
            </Field>
            <Field label="Ticker" htmlFor="symbol" error={errors.symbol}>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-ink-4">$</span>
                <Input
                  id="symbol"
                  value={ticker}
                  maxLength={10}
                  onChange={(e) => setSymbol(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))}
                  placeholder="GLCAT"
                  className="pl-6 uppercase"
                  aria-invalid={Boolean(errors.symbol)}
                />
              </div>
            </Field>
          </div>
          <Field
            label="Description"
            htmlFor="description"
            optional
            error={errors.description}
            hint={`${description.length}/600 · Tell creators what the token is about.`}
          >
            <Textarea id="description" value={description} maxLength={600} onChange={(e) => setDescription(e.target.value)} placeholder="A very cold cat with very warm holders." />
          </Field>
        </FormSection>

        <FormSection title="Image" description="Square, at least 64×64. Converted to a 512×512 WebP with metadata removed.">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pickFile(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              "flex items-center gap-5 rounded-lg border border-dashed p-5 transition-colors",
              dragging ? "border-accent/60 bg-accent-soft" : errors.image ? "border-negative/50" : "border-edge-strong",
            )}
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
              <img src={preview} alt="Token image preview" className="size-20 shrink-0 rounded-full object-cover ring-1 ring-edge" />
            ) : (
              <span className="inline-flex size-20 shrink-0 items-center justify-center rounded-full bg-overlay text-ink-4">
                <ImageUp className="size-6" strokeWidth={1.5} />
              </span>
            )}
            <div className="min-w-0">
              <p className="text-[13.5px] text-ink">{file ? file.name : "Drop an image here"}</p>
              <p className="mt-0.5 text-[12.5px] text-ink-3">PNG, JPG, WebP or GIF · up to 4 MB</p>
              <Button type="button" size="sm" variant="secondary" className="mt-3" onClick={() => fileInput.current?.click()}>
                {file ? "Replace image" : "Choose file"}
              </Button>
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(e) => pickFile(e.target.files?.[0])} />
            </div>
          </div>
          {errors.image ? (
            <p className="text-[12.5px] text-negative" role="alert">
              {errors.image}
            </p>
          ) : null}
        </FormSection>

        <FormSection title="Social links" description="Optional. Shown on the token page.">
          <div className="grid gap-5 sm:grid-cols-2">
            {(
              [
                ["website", "Website", "https://"],
                ["x", "X", "https://x.com/…"],
                ["telegram", "Telegram", "https://t.me/…"],
                ["discord", "Discord", "https://discord.gg/…"],
              ] as const
            ).map(([k, label, ph]) => (
              <Field key={k} label={label} htmlFor={`link-${k}`} error={errors[k]} optional>
                <Input
                  id={`link-${k}`}
                  value={links[k]}
                  inputMode="url"
                  onChange={(e) => setLinks((l) => ({ ...l, [k]: e.target.value.trim() }))}
                  placeholder={ph}
                  aria-invalid={Boolean(errors[k])}
                />
              </Field>
            ))}
          </div>
        </FormSection>

        <FormSection title="Launch configuration" description="Applies to this token's competition from the moment it launches.">
          <fieldset>
            <legend className="text-[13px] font-medium text-ink">Payout interval</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {config.allowedIntervalsHours.map((h) => (
                <label
                  key={h}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors",
                    interval === h ? "border-accent/50 bg-accent-soft" : "border-edge hover:border-edge-strong",
                  )}
                >
                  <input type="radio" name="interval" value={h} checked={interval === h} onChange={() => setInterval(h)} className="mt-1 accent-[#2cf59e]" />
                  <span>
                    <span className="block text-[14px] font-medium text-ink">Every {h} hours</span>
                    <span className="mt-0.5 block text-[12.5px] text-ink-3">
                      {24 / h} payouts per day to the top eligible creator{h <= 3 ? " — faster feedback, smaller rewards" : " — larger, less frequent rewards"}.
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Initial buy"
              htmlFor="initial-buy"
              optional
              hint={
                config.simulated
                  ? "Disabled in the demonstration environment."
                  : Number(initialBuy || 0) > 0 && new TextEncoder().encode(name.trim() + ticker).length > SINGLE_TX_NAME_BYTES
                    ? "With a name this long, your buy is sent right after the launch instead of inside it, so someone could buy first. Shorten the name or ticker to keep it in the launch."
                    : "Bought in the launch transaction itself, in SOL, so nobody can buy before you."
              }
            >
              <Input
                id="initial-buy"
                type="number"
                min={0}
                max={50}
                step="0.1"
                value={initialBuy}
                onChange={(e) => setInitialBuy(e.target.value)}
                placeholder="0.0"
                disabled={config.simulated}
              />
            </Field>
            <Field label="Total supply" hint="Fixed by the launch program. Mint authority is revoked at launch.">
              <Input value={fullNumber(config.supply)} readOnly disabled />
            </Field>
          </div>
        </FormSection>
      </div>

      <aside className="lg:sticky lg:top-[84px] lg:self-start">
        <div className="rounded-lg border border-edge bg-raised">
          <div className="flex items-center gap-3 border-b border-edge px-5 py-4">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
              <img src={preview} alt="" className="size-10 rounded-full object-cover ring-1 ring-edge" />
            ) : (
              <TokenAvatar symbol={ticker || "?"} size={40} />
            )}
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-ink">{name.trim() || "Token name"}</p>
              <p className="text-[12.5px] text-ink-3">${ticker || "TICKER"}</p>
            </div>
          </div>

          <div className="px-5 py-4">
            <h3 className="text-[13px] font-medium text-ink">Creator fee split</h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
              Your coin launches on pump.fun. Its creator fees are split in the launch transaction and the split is locked on-chain: nobody, not you and not
              VYRAL, can change it afterwards.
            </p>
            <FeeSplitBar className="mt-4" />
            <FeeSplitLegend described you className="mt-3" />
            <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
              Your share is paid to your wallet by pump.fun directly. The competition share is paid out to the top eligible video at every checkpoint.
              The buyback share buys and burns $VYRAL; every buy and burn is listed on the{" "}
              <Link href="/burns" className="text-ink-2 underline decoration-edge-strong underline-offset-2 hover:text-ink">
                Buyback &amp; burn
              </Link>{" "}
              page.
            </p>
          </div>

          <dl className="divide-y divide-edge border-t border-edge px-5 text-[12.5px]">
            <div className="flex justify-between py-2.5">
              <dt className="text-ink-3">Competition starts</dt>
              <dd className="text-ink">At launch</dd>
            </div>
            <div className="flex justify-between py-2.5">
              <dt className="text-ink-3">Payouts</dt>
              <dd className="text-ink">Every {interval} hours</dd>
            </div>
            <div className="flex justify-between py-2.5">
              <dt className="text-ink-3">Payout eligibility</dt>
              <dd className="text-ink">{fullNumber(config.minVerifiedViews)} verified views</dd>
            </div>
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-ink-3">Coin links to</dt>
              <dd className="text-right">
                <span className="text-ink">Its page on VYRAL</span>
                <span className="block text-[11.5px] text-ink-4">Added to the token metadata automatically</span>
              </dd>
            </div>
            <div className="flex justify-between py-2.5">
              <dt className="text-ink-3">Deployer wallet</dt>
              <dd className={wallet ? "font-mono text-ink" : "text-ink-3"}>{wallet ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : "Connect to launch"}</dd>
            </div>
          </dl>

          <div className="border-t border-edge p-5">
            {config.canSetOfficial ? (
              <label className="mb-3 flex cursor-pointer items-start gap-2.5 rounded-md border border-accent/30 bg-accent/5 p-3 text-[12.5px] leading-relaxed text-ink-2">
                <input type="checkbox" checked={official} onChange={(e) => setOfficial(e.target.checked)} className="mt-0.5 accent-[#2cf59e]" />
                <span>
                  <span className="font-medium text-ink">This is the official $VYRAL coin.</span> Its contract address appears in the site header as soon as
                  the launch is confirmed. Admins only.
                </span>
              </label>
            ) : null}
            <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] leading-relaxed text-ink-2">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 accent-[#2cf59e]" />
              I reviewed the fee split ({competitionPct} competition, {deployerPct} to me, {buybackPct} $VYRAL buyback, {treasuryPct} VYRAL treasury) and understand it is locked on-chain at launch.
            </label>
            {errors.ack ? (
              <p className="mt-2 text-[12.5px] text-negative" role="alert">
                {errors.ack}
              </p>
            ) : null}
            <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-[12.5px] leading-relaxed text-ink-2">
              <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 accent-[#2cf59e]" />
              <span>
                I accept the{" "}
                <Link href="/legal/terms" target="_blank" className="text-ink underline decoration-edge-strong underline-offset-2 hover:decoration-accent">
                  Terms of Use
                </Link>{" "}
                and understand that tokens are highly speculative and can lose all of their value. VYRAL does not promise any price, attention or return.
              </span>
            </label>
            {errors.terms ? (
              <p className="mt-2 text-[12.5px] text-negative" role="alert">
                {errors.terms}
              </p>
            ) : null}
            <Button variant="primary" size="lg" className="mt-4 w-full" loading={busy} onClick={() => void launch()}>
              {busy ? STEP_LABEL[step] : "Launch token"}
            </Button>
            {config.simulated ? (
              <Notice className="mt-3 text-[12px]">
                Demonstration environment: you&apos;ll sign a launch-intent message instead of a transaction. No token is created on-chain and no funds move.
              </Notice>
            ) : (
              <p className="mt-3 text-[12px] leading-relaxed text-ink-3">You&apos;ll review and sign the launch transaction in your wallet. Network fees apply.</p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function FormSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-5 border-t border-edge pt-6 first:border-t-0 first:pt-0">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-1 text-[13px] text-ink-3">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
