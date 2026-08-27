/**
 * Reader bake-off.
 *
 * Runs candidate vision models over the sample labels and scores each one
 * against the manifest's ground truth — what the artwork actually says, known
 * exactly because the labels were generated deterministically.
 *
 * This exists because "which model should we use" is an evidence question, and
 * the honest answer to it was missing: the seam was built, but nothing measured
 * what came through it. Latency alone is a trap, since the fastest model is
 * useless if it misreads a glared bottle.
 *
 *   node --use-system-ca scripts/compare-readers.mjs
 *
 * GEMINI_API_KEY must be set. Add models with MODELS=a,b,c.
 */

import { readFileSync } from "node:fs";

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  console.error("GEMINI_API_KEY is not set.");
  process.exit(1);
}

const MODELS = (process.env.MODELS ?? "gemini-3.6-flash,gemini-3.5-flash-lite").split(",");
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

const manifest = JSON.parse(readFileSync("public/samples/manifest.json", "utf8"));

/** Which samples to measure. Degraded variants matter most — they are the ask. */
const CHOSEN = process.env.SAMPLES
  ? process.env.SAMPLES.split(",")
  : [
      "spirits-bourbon-compliant",
      "spirits-bourbon-compliant--glare",
      "spirits-bourbon-compliant--rotated-8deg",
      "spirits-bourbon-compliant--blurred-underexposed",
      "wine-compliant",
      "malt-compliant",
    ];

const FIELD = {
  type: "OBJECT",
  nullable: true,
  properties: { text: { type: "STRING" }, confidence: { type: "NUMBER" } },
  required: ["text", "confidence"],
};

const SCHEMA = {
  type: "OBJECT",
  properties: {
    brandName: FIELD,
    classType: FIELD,
    alcoholContent: FIELD,
    netContents: FIELD,
    bottlerName: FIELD,
    countryOfOrigin: FIELD,
    governmentWarning: {
      type: "OBJECT",
      nullable: true,
      properties: {
        text: { type: "STRING" },
        confidence: { type: "NUMBER" },
        headerIsAllCaps: { type: "BOOLEAN" },
        headerIsBold: { type: "BOOLEAN" },
        legibleSize: { type: "BOOLEAN" },
      },
      required: ["text", "confidence", "headerIsAllCaps", "headerIsBold", "legibleSize"],
    },
    imageQuality: {
      type: "OBJECT",
      properties: {
        score: { type: "NUMBER" },
        issues: { type: "ARRAY", items: { type: "STRING" } },
        tooPoorToReview: { type: "BOOLEAN" },
      },
      required: ["score", "issues", "tooPoorToReview"],
    },
    notes: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["imageQuality", "notes"],
};

const PROMPT =
  "Transcribe this alcohol label exactly as printed. Preserve capitalisation. " +
  "Return null only for information genuinely absent from the label; if text is " +
  "present but hard to read, give your best reading with low confidence.";

/** Compare ignoring case, spacing and typographic quotes — the app does the same. */
function same(a, b) {
  const fold = (s) =>
    (s ?? "")
      .normalize("NFKC")
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  return fold(a) === fold(b);
}

async function read(model, file) {
  const image = readFileSync(`public/samples/${file}`).toString("base64");
  const started = Date.now();
  const response = await fetch(
    `${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: PROMPT }] },
        contents: [
          {
            parts: [
              { inline_data: { mime_type: "image/png", data: image } },
              { text: "Transcribe this label." },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: SCHEMA,
          temperature: 0,
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
    },
  );

  const ms = Date.now() - started;
  if (!response.ok) {
    const body = await response.text();
    return { ms, error: `${response.status}: ${body.slice(0, 80)}` };
  }
  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  try {
    return { ms, extraction: JSON.parse(text) };
  } catch {
    return { ms, error: "unparseable JSON" };
  }
}

const results = {};

for (const model of MODELS) {
  results[model] = { correct: 0, total: 0, times: [], misses: [] };

  for (const id of CHOSEN) {
    const sample = manifest.samples.find((s) => s.id === id);
    if (!sample) {
      console.log(`  (no sample "${id}" in manifest — skipped)`);
      continue;
    }

    const truth = sample.labelText ?? {};
    const outcome = await read(model, sample.file);

    if (outcome.error) {
      console.log(`${model.padEnd(24)} ${id.padEnd(48)} ERROR ${outcome.error}`);
      results[model].misses.push(`${id}: ${outcome.error}`);
      continue;
    }

    results[model].times.push(outcome.ms);
    const got = outcome.extraction;

    // Score the four fields whose ground truth the manifest states plainly.
    const checks = [
      ["brandName", truth.brandName, got.brandName?.text],
      ["classType", truth.classType, got.classType?.text],
      ["alcoholContent", truth.alcoholContent, got.alcoholContent?.text],
      ["netContents", truth.netContents, got.netContents?.text],
    ].filter(([, expected]) => expected);

    let hits = 0;
    for (const [field, expected, actual] of checks) {
      if (same(expected, actual)) hits++;
      else results[model].misses.push(`${id}/${field}: expected "${expected}" got "${actual ?? "null"}"`);
    }

    // The warning is the hardest read: smallest type, and must be exact.
    let warning = "n/a";
    if (truth.warningBody) {
      const full = `${truth.warningHeader} ${truth.warningBody}`;
      warning = same(full, got.governmentWarning?.text) ? "exact" : "DIFFERS";
      if (warning === "DIFFERS") results[model].misses.push(`${id}/warning: not verbatim`);
      results[model].total += 1;
      if (warning === "exact") results[model].correct += 1;
    }

    results[model].correct += hits;
    results[model].total += checks.length;

    console.log(
      `${model.padEnd(24)} ${id.padEnd(48)} ${(outcome.ms / 1000).toFixed(2)}s  fields ${hits}/${checks.length}  warning ${warning}`,
    );
  }
  console.log("");
}

console.log("=".repeat(96));
for (const [model, r] of Object.entries(results)) {
  const sorted = [...r.times].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] / 1000 : NaN;
  const worst = sorted.length ? sorted[sorted.length - 1] / 1000 : NaN;
  const accuracy = r.total ? ((r.correct / r.total) * 100).toFixed(0) : "—";
  console.log(
    `${model.padEnd(24)} accuracy ${String(accuracy).padStart(3)}% (${r.correct}/${r.total})   median ${median.toFixed(2)}s   worst ${worst.toFixed(2)}s`,
  );
}

console.log("\nMisses:");
for (const [model, r] of Object.entries(results)) {
  if (!r.misses.length) {
    console.log(`  ${model}: none`);
    continue;
  }
  for (const miss of r.misses) console.log(`  ${model}: ${miss}`);
}
