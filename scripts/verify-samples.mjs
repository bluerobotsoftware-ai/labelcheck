/**
 * End-to-end check of the whole pipeline against every sample label.
 *
 * Posts each sample to a running instance with the application data the
 * manifest records for it, and compares the recommendation returned against the
 * one the manifest says a correct implementation must reach.
 *
 * This is the only test in the repo that exercises the vision model. Everything
 * else runs against fixtures and proves the decision layer; this proves the two
 * halves are wired together and that the model reads well enough for the rules
 * to reach the right conclusion. It needs a running server and a configured
 * reader, which is why it is a script and not part of `npm test`.
 *
 *   npm run dev                        # in one terminal
 *   node scripts/verify-samples.mjs    # in another
 *
 * BASE_URL overrides the target, so this doubles as a smoke test against the
 * deployed URL after a release.
 */

import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const manifest = JSON.parse(readFileSync("public/samples/manifest.json", "utf8"));

let passed = 0;
let failed = 0;
const failures = [];

console.log(`Verifying ${manifest.samples.length} samples against ${BASE}\n`);
console.log(
  `${"sample".padEnd(48)} ${"expected".padEnd(13)} ${"got".padEnd(13)} time    model`,
);
console.log("-".repeat(110));

for (const sample of manifest.samples) {
  const expected = sample.expected?.recommendation ?? "(unstated)";

  const image = readFileSync(`public/samples/${sample.file}`);
  const form = new FormData();
  form.append(
    "image",
    new Blob([image], { type: "image/png" }),
    sample.file,
  );
  form.append("application", JSON.stringify(sample.application));

  const started = Date.now();
  let line;
  try {
    const response = await fetch(`${BASE}/api/verify`, { method: "POST", body: form });
    const payload = await response.json();
    const ms = Date.now() - started;

    if (!response.ok) {
      line = `${sample.id.padEnd(48)} ${expected.padEnd(13)} ${"ERROR".padEnd(13)} ${(ms / 1000).toFixed(2)}s  ${payload.message?.slice(0, 40) ?? ""}`;
      failed++;
      failures.push(`${sample.id}: ${payload.message}`);
    } else {
      const got = payload.report.recommendation;
      const ok = got === expected;
      if (ok) passed++;
      else failed++;
      if (!ok) {
        const notable = payload.report.checks
          .filter((c) => c.verdict === "fail" || c.verdict === "review")
          .map((c) => `${c.name} (${c.rule})`)
          .join("; ");
        failures.push(`${sample.id}: expected ${expected}, got ${got} — ${notable || "no failing checks"}`);
      }
      line = `${(ok ? "  " : "! ") + sample.id.padEnd(46)} ${expected.padEnd(13)} ${got.padEnd(13)} ${(ms / 1000).toFixed(2)}s  ${payload.report.reader.replace("gemini:", "")}`;
    }
  } catch (error) {
    failed++;
    failures.push(`${sample.id}: ${error.message}`);
    line = `${sample.id.padEnd(48)} ${expected.padEnd(13)} ${"THREW".padEnd(13)} —      ${error.message.slice(0, 40)}`;
  }

  console.log(line);
}

console.log("-".repeat(110));
console.log(`${passed} matched expectation, ${failed} did not.`);

if (failures.length) {
  console.log("\nDetail:");
  for (const failure of failures) console.log(`  ${failure}`);
}

process.exit(failed > 0 ? 1 : 0);
