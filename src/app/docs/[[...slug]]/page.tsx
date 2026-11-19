import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/misc";
import { DOCS } from "@/content/docs";

export function generateStaticParams() {
  return DOCS.map((d) => ({ slug: d.slug ? [d.slug] : [] }));
}

export async function generateMetadata({ params }: PageProps<"/docs/[[...slug]]">): Promise<Metadata> {
  const { slug } = await params;
  const doc = DOCS.find((d) => d.slug === (slug?.join("/") ?? ""));
  return doc ? { title: doc.slug ? `${doc.title} · Docs` : "Documentation", description: doc.description } : {};
}

export default function DocPage({ params }: PageProps<"/docs/[[...slug]]">) {
  return (
    <Suspense
      fallback={
        <div aria-hidden>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="mt-6 h-64 w-full" />
        </div>
      }
    >
      <DocContent params={params} />
    </Suspense>
  );
}

async function DocContent({ params }: Pick<PageProps<"/docs/[[...slug]]">, "params">) {
  const { slug } = await params;
  const key = slug?.join("/") ?? "";
  const index = DOCS.findIndex((d) => d.slug === key);
  if (index < 0) notFound();
  const doc = DOCS[index];
  const prev = DOCS[index - 1];
  const next = DOCS[index + 1];
  return (
    <article className="prose-vyral pb-8">
      <p className="eyebrow !mb-3">Documentation</p>
      <h1>{doc.title}</h1>
      <p className="!mt-0 text-[16px] text-ink-2">{doc.description}</p>
      <hr />
      {doc.body()}
      <nav className="not-prose mt-14 grid gap-3 border-t border-edge pt-6 sm:grid-cols-2" aria-label="Pagination">
        {prev ? (
          <Link href={prev.slug ? `/docs/${prev.slug}` : "/docs"} className="rounded-lg border border-edge px-4 py-3 no-underline hover:border-edge-strong">
            <span className="block text-[12px] text-ink-3">Previous</span>
            <span className="text-[14px] text-ink">{prev.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`/docs/${next.slug}`} className="rounded-lg border border-edge px-4 py-3 text-right no-underline hover:border-edge-strong">
            <span className="block text-[12px] text-ink-3">Next</span>
            <span className="text-[14px] text-ink">{next.title}</span>
          </Link>
        ) : null}
      </nav>
    </article>
  );
}
