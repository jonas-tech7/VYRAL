import Link from "next/link";
import { legalOperator } from "@/components/legal/legal";
import { Container, Notice } from "@/components/ui/misc";
import { LEGAL_LINKS } from "@/lib/legal";

export default function LegalLayout({ children }: LayoutProps<"/legal">) {
  const { reviewed } = legalOperator();
  return (
    <Container>
      <div className="grid gap-10 pt-10 sm:pt-14 lg:grid-cols-[200px_1fr] lg:gap-16">
        <aside className="lg:sticky lg:top-[84px] lg:self-start">
          <nav aria-label="Legal" className="flex gap-6 overflow-x-auto text-[13px] lg:flex-col lg:gap-2.5">
            {LEGAL_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="whitespace-nowrap text-ink-3 transition-colors hover:text-ink">
                {l.label}
              </Link>
            ))}
          </nav>
        </aside>
        <div className="min-w-0 max-w-[760px]">
          {reviewed ? null : (
            <Notice tone="warning" className="mb-8">
              <span className="font-medium">Draft.</span> These texts are a starting point prepared with the platform. They have not been reviewed by a lawyer
              yet and must be checked and completed before VYRAL handles real money. Fields in brackets are still missing.
            </Notice>
          )}
          {children}
        </div>
      </div>
    </Container>
  );
}
