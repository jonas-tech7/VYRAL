"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/misc";

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Container size="narrow">
      <div className="flex min-h-[50vh] flex-col items-start justify-center py-20">
        <p className="font-mono text-[12px] text-ink-4">Error</p>
        <h1 className="mt-3 text-[28px] font-semibold tracking-[-0.02em] text-ink">Something went wrong</h1>
        <p className="mt-2 max-w-[440px] text-[14.5px] leading-relaxed text-ink-2">
          This section couldn&apos;t load. No action was taken on your behalf. Try again, or come back in a moment.
        </p>
        <div className="mt-8 flex gap-2">
          <Button variant="primary" onClick={() => retry()}>
            Try again
          </Button>
          <ButtonLink href="/" variant="secondary">
            Home
          </ButtonLink>
        </div>
      </div>
    </Container>
  );
}
