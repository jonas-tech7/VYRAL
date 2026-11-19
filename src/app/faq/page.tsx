import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/misc";
import { FAQ } from "@/content/faq";

export const metadata: Metadata = {
  title: "FAQ",
  description: "How VYRAL turns a token's creator fees into rewards for the creators who make it go viral.",
};

export default function FaqPage() {
  return (
    <Container size="narrow">
      <div className="max-w-[760px] pb-8 pt-10 sm:pt-14">
        <p className="eyebrow !mb-3">FAQ</p>
        <h1 className="text-[28px] font-semibold leading-[1.2] tracking-[-0.02em] text-ink">Frequently asked questions</h1>
        <p className="mt-3 text-[16px] leading-relaxed text-ink-2">
          Memes are attention. VYRAL turns a token&apos;s creator fees into rewards for the creators who make it go viral.
        </p>
        <div className="mt-10 border-t border-edge">
          {FAQ.map((item, i) => (
            <details key={item.id} id={item.id} open={i === 0} className="group scroll-mt-[88px] border-b border-edge">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[15.5px] text-ink transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
                {item.q}
                <Plus aria-hidden className="size-4 shrink-0 text-ink-3 transition-transform duration-200 group-open:rotate-45" />
              </summary>
              <div className="prose-vyral pb-5 pr-2 sm:pr-10 [&>*:first-child]:mt-0">{item.a()}</div>
            </details>
          ))}
        </div>
        <p className="mt-10 text-[14px] text-ink-3">
          Looking for the details?{" "}
          <Link href="/how-it-works" className="text-ink underline decoration-edge-strong underline-offset-[3px] hover:decoration-accent">
            How it works
          </Link>{" "}
          explains every rule, and the{" "}
          <Link href="/docs" className="text-ink underline decoration-edge-strong underline-offset-[3px] hover:decoration-accent">
            documentation
          </Link>{" "}
          goes into technical detail.
        </p>
      </div>
    </Container>
  );
}
