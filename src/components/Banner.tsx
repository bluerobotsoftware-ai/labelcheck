/**
 * Full-bleed masthead with the author's seal.
 *
 * Deliberately NOT the Department of the Treasury seal. This prototype sits on
 * a public URL, and carrying the real seal would present it as an official
 * government system — which 31 U.S.C. 333 prohibits, and which would contradict
 * the "not connected to COLA" statement printed on the seal itself.
 *
 * So the seal is the author's own, and both legends on it are true: the tool is
 * *intended for* government use, and it is *not connected to* COLA. Stating the
 * limitation on the most official-looking element on the page is the point —
 * anyone who screenshots this carries the disclaimer with them.
 *
 * Drawn as inline SVG rather than shipped as an image: crisp at any size, no
 * network request, no font dependency, and nothing that could be mistaken for
 * a copied government asset.
 */

const SEAL_BLUE = "#0b4c8c";

export function Banner() {
  return (
    <div className="w-full bg-[#0b4c8c] text-white no-print" role="banner">
      <div className="mx-auto flex max-w-6xl items-center gap-5 px-5 py-4 sm:gap-7 sm:py-5">
        <Seal />

        <div className="min-w-0">
          <p className="text-xl leading-tight font-semibold tracking-wide sm:text-3xl">
            Alcohol Label Verification
          </p>
          <p className="mt-1.5 text-[11px] leading-snug font-bold tracking-[0.14em] text-white/85 uppercase sm:text-[13px]">
            Intended for government use
          </p>
          <p className="text-[11px] leading-snug font-bold tracking-[0.14em] text-white/85 uppercase sm:text-[13px]">
            Prototype — not connected to COLA
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The seal itself.
 *
 * Circular legends are set on two `textPath` arcs — the upper one runs
 * left-to-right over the top of the circle, the lower one is drawn on a
 * separately-defined reversed arc so its text reads the right way up rather
 * than upside down. That reversed path is the only fiddly part of a seal.
 */
function Seal() {
  return (
    <svg
      viewBox="0 0 200 200"
      className="h-20 w-20 shrink-0 sm:h-24 sm:w-24"
      role="img"
      aria-label="Seal of Gerald Grimes-Wyatt, AI Technologist. Intended for government use. Prototype, not connected to COLA."
    >
      <defs>
        {/*
          Both arcs run LEFT TO RIGHT. That is what keeps the glyphs upright:
          text on a path is drawn with "up" as the left-hand normal of the
          direction of travel, so a bottom arc travelling right-to-left renders
          the legend upside down. Only the sweep flag differs — 1 bulges the
          path over the top, 0 dips it under the bottom.
        */}
        <path id="seal-arc-top" d="M 30,100 A 70,70 0 0 1 170,100" fill="none" />
        <path id="seal-arc-bottom" d="M 32,104 A 72,72 0 0 0 168,104" fill="none" />
      </defs>

      {/* Rings */}
      <circle cx="100" cy="100" r="96" fill="#ffffff" />
      <circle cx="100" cy="100" r="96" fill="none" stroke={SEAL_BLUE} strokeWidth="4" />
      <circle cx="100" cy="100" r="88" fill="none" stroke={SEAL_BLUE} strokeWidth="1.5" />
      <circle cx="100" cy="100" r="58" fill="none" stroke={SEAL_BLUE} strokeWidth="2" />

      {/* Rope-style beading between the rings, the way a real seal is bordered. */}
      {Array.from({ length: 48 }, (_, i) => {
        const angle = (i / 48) * Math.PI * 2;
        return (
          <circle
            key={i}
            cx={100 + Math.cos(angle) * 82}
            cy={100 + Math.sin(angle) * 82}
            r="1.6"
            fill={SEAL_BLUE}
          />
        );
      })}

      <g
        fill={SEAL_BLUE}
        fontSize="15"
        fontWeight="700"
        letterSpacing="1.6"
        style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
      >
        <text>
          <textPath href="#seal-arc-top" startOffset="50%" textAnchor="middle">
            GERALD GRIMES-WYATT
          </textPath>
        </text>
        <text fontSize="13">
          <textPath href="#seal-arc-bottom" startOffset="50%" textAnchor="middle">
            AI TECHNOLOGIST
          </textPath>
        </text>
      </g>

      {/* Centre device: a bottle with a check across its label area. */}
      <g stroke={SEAL_BLUE} fill="none" strokeWidth="4" strokeLinejoin="round">
        <path d="M88 62h24v16l10 16v46a7 7 0 0 1-7 7H85a7 7 0 0 1-7-7V94l10-16V62Z" />
        <path
          d="M86 118l10 10 20-22"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* Small stars separating the two legends, as on a struck seal. */}
      {[0, 1].map((i) => {
        const angle = i === 0 ? Math.PI : 0;
        return (
          <circle
            key={`star-${i}`}
            cx={100 + Math.cos(angle) * 73}
            cy={100 + Math.sin(angle) * 73}
            r="3.2"
            fill={SEAL_BLUE}
          />
        );
      })}
    </svg>
  );
}
