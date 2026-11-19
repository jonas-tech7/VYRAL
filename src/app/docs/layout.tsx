import { Suspense } from "react";
import { DocsNav } from "@/components/docs/docs-nav";
import { Container } from "@/components/ui/misc";
import { DOC_SECTIONS } from "@/content/docs";

export default function DocsLayout({ children }: LayoutProps<"/docs">) {
  return (
    <Container>
      <div className="grid gap-10 pt-10 sm:pt-14 lg:grid-cols-[200px_1fr] lg:gap-16">
        <aside className="lg:sticky lg:top-[84px] lg:self-start">
          <Suspense fallback={<DocsNav sections={DOC_SECTIONS} active="" />}>
            <DocsNav sections={DOC_SECTIONS} />
          </Suspense>
        </aside>
        <div className="min-w-0 max-w-[760px]">{children}</div>
      </div>
    </Container>
  );
}
