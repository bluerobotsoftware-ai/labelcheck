/**
 * The verification sweep. Run this before every push.
 *
 * Every sample label, measured through several deliberately sloppy bounding
 * boxes, checked against the manifest's ground truth. No network, no API key,
 * about a second.
 *
 * This exists because abandoning it cost real defects. The unit tests are green
 * on fixtures written by the same hand that wrote the code, so they confirm
 * assumptions rather than challenge them. This sweep runs the measurement over
 * real images with inputs shaped like the ones the reader actually returns, and
 * it caught four production bugs in a single run that were otherwise found one
 * at a time over several pushes:
 *
 *   - bounding boxes arriving in pixels where fractions were specified
 *   - boxes overrunning the image edge
 *   - a loose box diluting the ink measurement into a false rejection
 *   - an underexposed photograph read as a badly-printed label
 *
 *   npm run sweep
 *
 * If it prints anything other than "all correct", do not push.
 */

import { readFileSync } from "node:fs";
import sharp from "sharp";
import { measureWarningContrast } from "../src/lib/ttb/pixelContrast.ts";
import { MIN_RELATIVE_WARNING_CONTRAST } from "../src/lib/ttb/contrast.ts";

const manifest = JSON.parse(readFileSync("public/samples/manifest.json", "utf8"));

/** The whole label, for the relative comparison. */
const WHOLE_LABEL = { x: 0.02, y: 0.02, width: 0.96, height: 0.96 };

/**
 * Boxes shaped like what the reader really returns: loose, looser, and stated
 * in pixels rather than the fractions the schema asks for. Testing only snug
 * fractional boxes is what let the defects through.
 *
 * The pixel variant is derived from each image's own dimensions and made to
 * overrun the right edge, because that is what the reader does. A fixed pixel
 * rectangle would land in a different place on every differently-sized label
 * and would be testing the harness rather than the code — which is exactly the
 * mistake this sweep exists to prevent, and which it caught on its first run.
 */
function boxesFor(width, height) {
  return [
    { name: "loose", box: { x: 0.07, y: 0.86, width: 0.88, height: 0.1 } },
    { name: "looser", box: { x: 0.05, y: 0.84, width: 0.92, height: 0.14 } },
    {
      name: "overrunning px",
      box: {
        x: Math.round(0.09 * width),
        y: Math.round(0.88 * height),
        // Deliberately wider than the image, as the reader's boxes tend to be.
        width: Math.round(1.02 * width),
        height: Math.round(0.07 * height),
      },
    },
  ];
}

/** Only this sample should fail on legibility; every other must not. */
const SHOULD_FAIL_LEGIBILITY = new Set(["spirits-warning-illegible"]);

let wrong = 0;

console.log(`Sweeping ${manifest.samples.length} samples x 3 box shapes\n`);
console.log("sample".padEnd(48), "ratios (loose / looser / px)".padEnd(30), "verdict");
console.log("-".repeat(96));

for (const sample of manifest.samples) {
  const image = readFileSync(`public/samples/${sample.file}`);
  const meta = await sharp(image).metadata();
  const label = await measureWarningContrast(image, WHOLE_LABEL);

  const ratios = [];
  let worst = Infinity;

  for (const { box } of boxesFor(meta.width, meta.height)) {
    const warning = await measureWarningContrast(image, box);
    if (!warning || !label || label.contrast <= 0) {
      ratios.push("   -  ");
      continue;
    }
    const ratio = warning.contrast / label.contrast;
    ratios.push(ratio.toFixed(2).padStart(6));
    worst = Math.min(worst, ratio);
  }

  const fails = worst !== Infinity && worst < MIN_RELATIVE_WARNING_CONTRAST;
  const expected = SHOULD_FAIL_LEGIBILITY.has(sample.id);
  const ok = fails === expected;
  if (!ok) wrong++;

  console.log(
    sample.id.padEnd(48),
    ratios.join("  ").padEnd(30),
    (fails ? "FAILS legibility" : "passes legibility").padEnd(18),
    ok ? "" : `<-- WRONG, expected ${expected ? "fail" : "pass"}`,
  );
}

console.log("-".repeat(96));
console.log(wrong === 0 ? "all correct" : `${wrong} wrong — do not push`);
process.exit(wrong === 0 ? 0 : 1);
