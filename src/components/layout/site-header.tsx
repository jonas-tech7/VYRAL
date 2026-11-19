import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { WalletButton } from "@/components/wallet/wallet-button";
import { MobileNav, MobileNavPlaceholder, NavLinks, NavLinksStatic } from "./nav-links";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-canvas">
      <nav aria-label="Main" className="mx-auto flex h-[60px] w-full max-w-[1200px] items-center gap-6 px-4 sm:px-6">
        <Link href="/" aria-label="VYRAL home" className="shrink-0">
          <Logo />
        </Link>
        <Suspense fallback={<NavLinksStatic />}>
          <NavLinks />
        </Suspense>
        <div className="ml-auto flex items-center gap-2">
          <WalletButton />
          <Suspense fallback={<MobileNavPlaceholder />}>
            <MobileNav />
          </Suspense>
        </div>
      </nav>
    </header>
  );
}
