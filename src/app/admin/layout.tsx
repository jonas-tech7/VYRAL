import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminNav } from "@/components/admin/admin-ui";
import { Container } from "@/components/ui/misc";
import { requireRole } from "@/lib/auth/admin";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Container size="wide">
      <div className="grid gap-8 pt-10 lg:grid-cols-[190px_1fr] lg:gap-12">
        <aside className="lg:sticky lg:top-[84px] lg:self-start">
          <Suspense fallback={null}>
            <GatedNav />
          </Suspense>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </Container>
  );
}

async function GatedNav() {
  const auth = await requireRole("reviewer");
  if (!auth.ok) return null;
  return (
    <>
      <p className="mb-5 text-[12px] text-ink-3">
        Signed in as <span className="text-ink-2">{auth.viewer.role}</span>
      </p>
      <AdminNav />
    </>
  );
}
