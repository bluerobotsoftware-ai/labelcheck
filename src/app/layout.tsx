import type { Metadata } from "next";
import Link from "next/link";
import { Banner } from "@/components/Banner";
import "./globals.css";

export const metadata: Metadata = {
  title: "TTB Label Check",
  description:
    "Verify alcohol beverage label artwork against a COLA application and against federal labelling requirements.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {/* Keyboard users should not have to tab through the header every time. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:font-semibold"
        >
          Skip to main content
        </a>

        <Banner />

        <header className="border-b border-[var(--color-line)] bg-[var(--color-surface)] no-print">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
            <Link href="/" className="text-xl font-bold text-[var(--color-brand)]">
              TTB Label Check
            </Link>
            <nav className="flex gap-6 text-[17px]" aria-label="Main">
              <Link href="/" className="font-semibold hover:underline">
                Single label
              </Link>
              <Link href="/batch" className="font-semibold hover:underline">
                Batch
              </Link>
              <Link href="/about" className="font-semibold hover:underline">
                How it works
              </Link>
            </nav>
            <span className="ml-auto rounded-full bg-[var(--color-muted-bg)] px-3 py-1 text-[13px] font-semibold text-[var(--color-ink-soft)]">
              Prototype — not connected to COLA
            </span>
          </div>
        </header>

        <main id="main" className="mx-auto max-w-6xl px-5 py-8">
          {children}
        </main>

        <footer className="mx-auto max-w-6xl px-5 pt-4 pb-12 text-[15px] text-[var(--color-ink-soft)] no-print">
          <p>
            A proof of concept for label review. Every result is advisory; a
            compliance agent makes the decision.
          </p>
        </footer>
      </body>
    </html>
  );
}
