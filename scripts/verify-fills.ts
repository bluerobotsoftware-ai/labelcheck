/**
 * Cross-checks the standards-of-fill constants in the code against the lists
 * transcribed from the eCFR in docs/REGULATORY-NOTES.md.
 *
 * Run with: npx tsx scripts/verify-fills.ts
 */

import { readFileSync } from "node:fs";
import { STANDARDS_OF_FILL } from "../src/lib/ttb/netContents";

const doc = readFileSync("docs/REGULATORY-NOTES.md", "utf8");
const FENCE = "```";

/** Pull the first fenced list following a heading, normalised to millilitres. */
function listAfter(heading: string): number[] {
  const index = doc.indexOf(heading);
  if (index === -1) throw new Error(`Heading not found: ${heading}`);
  const start = doc.indexOf(FENCE, index);
  const end = doc.indexOf(FENCE, start + 3);
  const block = doc.slice(start + 3, end);

  return block
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((token) => {
      const match = /^([\d.]+)\s*(L|mL)$/i.exec(token);
      if (!match) throw new Error(`Unparsed token: "${token}"`);
      return /^l$/i.test(match[2])
        ? Math.round(Number.parseFloat(match[1]) * 1000)
        : Number.parseFloat(match[1]);
    })
    .sort((a, b) => a - b);
}

const cases = [
  {
    name: "SPIRITS (27 CFR 5.203)",
    fromDoc: listAfter("Authorized metric standards of fill, domestic and imported alike"),
    fromCode: [...STANDARDS_OF_FILL.distilled_spirits!].sort((a, b) => a - b),
  },
  {
    name: "WINE    (27 CFR 4.72)",
    fromDoc: listAfter("Authorized metric standards of fill — 27 CFR 4.72"),
    fromCode: [...STANDARDS_OF_FILL.wine!].sort((a, b) => a - b),
  },
];

let failed = false;

for (const { name, fromDoc, fromCode } of cases) {
  const identical =
    fromDoc.length === fromCode.length && fromDoc.every((v, i) => v === fromCode[i]);

  console.log(
    `${name}  regulation: ${fromDoc.length} sizes   code: ${fromCode.length} sizes   identical: ${identical}`,
  );

  if (!identical) {
    failed = true;
    console.log("  missing from code:", fromDoc.filter((v) => !fromCode.includes(v)));
    console.log("  not in regulation:", fromCode.filter((v) => !fromDoc.includes(v)));
  }
}

process.exit(failed ? 1 : 0);
