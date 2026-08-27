/**
 * Full-bleed masthead.
 *
 * Text only. Both statements are true and both need to be visible on a public
 * URL: the tool is intended for government use, and it is not connected to
 * COLA. Putting the limitation in the most prominent band on the page means
 * anyone who screenshots the tool carries the disclaimer with them.
 */

export function Banner() {
  return (
    <div className="w-full bg-[#0b4c8c] text-white no-print" role="banner">
      <div className="mx-auto max-w-6xl px-5 py-4 sm:py-5">
        <p className="text-xl leading-tight font-semibold tracking-wide sm:text-3xl">
          Alcohol Label Verification
        </p>
        <p className="mt-1.5 text-[11px] leading-snug font-bold tracking-[0.14em] text-white/85 uppercase sm:text-[13px]">
          Gerald Grimes-Wyatt — AI Technologist
        </p>
        <p className="text-[11px] leading-snug font-bold tracking-[0.14em] text-white/85 uppercase sm:text-[13px]">
          Intended for government use · Prototype — not connected to COLA
        </p>
      </div>
    </div>
  );
}
