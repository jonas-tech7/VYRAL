import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/misc";

export default function NotFound() {
  return (
    <Container size="narrow">
      <div className="flex min-h-[50vh] flex-col items-start justify-center py-20">
        <p className="font-mono text-[12px] text-ink-4">404</p>
        <h1 className="mt-3 text-[28px] font-semibold tracking-[-0.02em] text-ink">This page doesn&apos;t exist</h1>
        <p className="mt-2 max-w-[440px] text-[14.5px] leading-relaxed text-ink-2">
          The token, competition or creator you&apos;re looking for may have a different address. Check the link, or browse live competitions.
        </p>
        <div className="mt-8 flex gap-2">
          <ButtonLink href="/competitions" variant="primary">
            Browse competitions
          </ButtonLink>
          <ButtonLink href="/" variant="secondary">
            Home
          </ButtonLink>
        </div>
      </div>
    </Container>
  );
}
