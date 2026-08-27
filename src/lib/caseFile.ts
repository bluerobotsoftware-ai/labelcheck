/**
 * Builds the downloadable case file: the report, plus the artwork it was drawn
 * from, in one archive.
 *
 * The point is that a decision without its evidence is not a record. Six months
 * later, on an appeal, "the tool approved it" is worth nothing; "here is the
 * exact image reviewed, the rule that fired on each item, and the regulation
 * behind it" is a defensible file. So the image travels with the verdict, and
 * the verdict carries its reasoning rather than a summary of it.
 *
 * Three files go in:
 *   report.txt   — plain text, printable, meant for a human and a folder
 *   report.json  — the complete report, for anything that consumes it later
 *   the label artwork, under its original filename
 */

import { createZip, type ZipEntry } from "./zip";
import type { Application, VerificationReport, Verdict } from "./ttb/types";

const VERDICT_LABEL: Record<Verdict, string> = {
  pass: "MATCHES",
  review: "CHECK BY EYE",
  fail: "PROBLEM",
  unreadable: "COULD NOT READ",
  not_applicable: "NOT REQUIRED",
};

const RECOMMENDATION_LABEL: Record<VerificationReport["recommendation"], string> = {
  approve: "NO PROBLEMS FOUND",
  needs_review: "NEEDS REVIEW BY AN AGENT",
  reject: "PROBLEMS FOUND",
};

/** Wrap prose to a fixed width so the file prints sensibly. */
function wrap(text: string, width: number, indent: string): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    if (line.length + word.length + 1 > width && line.length > 0) {
      lines.push(indent + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(indent + line);
  return lines.join("\n");
}

function rule(char = "-"): string {
  return char.repeat(78);
}

/**
 * Render the report as plain text.
 *
 * Deliberately plain text rather than PDF or HTML: it opens on any machine,
 * prints without a browser, survives being pasted into an email or a case
 * management system, and will still be readable in twenty years. A compliance
 * file outlives the tool that produced it.
 */
export function renderReportText(
  report: VerificationReport,
  application: Application,
  meta: { imageFilename: string; generatedAt: Date },
): string {
  const lines: string[] = [];

  lines.push(rule("="));
  lines.push("TTB LABEL CHECK — VERIFICATION RECORD");
  lines.push(rule("="));
  lines.push("");
  lines.push(`Result:            ${RECOMMENDATION_LABEL[report.recommendation]}`);
  lines.push(wrap(report.headline, 60, "                   ").trimStart());
  lines.push("");
  lines.push(`Generated:         ${meta.generatedAt.toISOString()}`);
  lines.push(`Label artwork:     ${meta.imageFilename}`);
  lines.push(`Reader:            ${report.reader}`);
  lines.push(
    `Time taken:        ${(report.timing.totalMs / 1000).toFixed(1)}s (reading ${(report.timing.extractionMs / 1000).toFixed(1)}s, rules ${report.timing.rulesMs}ms)`,
  );
  lines.push("");

  lines.push(rule());
  lines.push("APPLICATION AS FILED");
  lines.push(rule());
  const filed: Array<[string, string | undefined]> = [
    ["Application reference", application.applicationId],
    ["TTB ID", application.ttbId],
    ["Beverage type", application.beverageType.replace(/_/g, " ")],
    ["Brand name", application.brandName],
    ["Class / type", application.classType],
    ["Alcohol content", application.alcoholContent],
    ["Net contents", application.netContents],
    ["Bottler / producer", application.bottlerName],
    ["Trade name on label", application.labelCompanyName],
    ["Country of origin", application.countryOfOrigin],
    ["Imported", application.isImport ? "yes" : "no"],
  ];
  for (const [label, value] of filed) {
    if (value) lines.push(`  ${label.padEnd(22)} ${value}`);
  }
  lines.push("");

  const groups: Array<[string, string, typeof report.checks]> = [
    [
      "COMPARED WITH THE APPLICATION",
      "Does the artwork show what the applicant filed?",
      report.checks.filter((c) => c.category === "match"),
    ],
    [
      "REQUIRED BY REGULATION",
      "Does the label meet federal requirements, whatever was filed?",
      report.checks.filter((c) => c.category === "compliance"),
    ],
  ];

  for (const [title, subtitle, checks] of groups) {
    if (checks.length === 0) continue;
    lines.push(rule());
    lines.push(title);
    lines.push(subtitle);
    lines.push(rule());
    lines.push("");

    for (const check of checks) {
      lines.push(`  [${VERDICT_LABEL[check.verdict]}]  ${check.name}`);
      if (check.expected !== undefined) {
        lines.push(`      Application says: ${check.expected}`);
      }
      if (check.found !== undefined) {
        lines.push(`      Label shows:      ${check.found}`);
      }
      lines.push(wrap(check.explanation, 70, "      "));
      // The audit trail. On an appeal this is the line that answers
      // "why did it say that?" — the rule identifier and the regulation.
      const provenance = [
        check.citation ? `Regulation: ${check.citation}` : null,
        `Rule: ${check.rule}`,
        check.confidence !== undefined
          ? `Reading confidence: ${Math.round(check.confidence * 100)}%`
          : null,
      ]
        .filter(Boolean)
        .join("   ");
      lines.push(`      ${provenance}`);
      lines.push("");
    }
  }

  if (report.imageQuality.issues.length > 0 || report.imageQuality.tooPoorToReview) {
    lines.push(rule());
    lines.push("PHOTOGRAPH QUALITY");
    lines.push(rule());
    lines.push(`  Legibility score: ${report.imageQuality.score.toFixed(2)}`);
    for (const issue of report.imageQuality.issues) lines.push(`  - ${issue}`);
    if (report.imageQuality.tooPoorToReview) {
      lines.push("  This image was judged too poor to support a decision.");
    }
    lines.push("");
  }

  if (report.notes.length > 0) {
    lines.push(rule());
    lines.push("OTHER OBSERVATIONS");
    lines.push(rule());
    for (const note of report.notes) lines.push(wrap(`- ${note}`, 74, "  "));
    lines.push("");
  }

  lines.push(rule("="));
  lines.push(
    wrap(
      "This is an advisory record produced by an automated prototype. It is not a determination. A compliance agent decides every application. The artwork this report was drawn from is included in this archive.",
      74,
      "",
    ),
  );
  lines.push(rule("="));

  return lines.join("\n") + "\n";
}

/** Filesystem-safe slug for the archive name. */
function slug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 40) || "label"
  );
}

export interface CaseFile {
  filename: string;
  bytes: Uint8Array;
}

/**
 * Assemble the archive.
 *
 * Takes the image bytes rather than a File so this stays testable without a
 * browser, and takes `generatedAt` so the output is reproducible.
 */
export function buildCaseFile(
  report: VerificationReport,
  application: Application,
  image: { filename: string; bytes: Uint8Array },
  generatedAt: Date = new Date(),
): CaseFile {
  const text = renderReportText(report, application, {
    imageFilename: image.filename,
    generatedAt,
  });

  const entries: ZipEntry[] = [
    { name: "report.txt", data: new TextEncoder().encode(text) },
    {
      name: "report.json",
      data: new TextEncoder().encode(
        JSON.stringify({ generatedAt: generatedAt.toISOString(), application, report }, null, 2),
      ),
    },
    { name: image.filename, data: image.bytes },
  ];

  const stamp = generatedAt.toISOString().slice(0, 10);
  const reference = application.applicationId ?? application.brandName;

  return {
    filename: `label-check-${slug(reference)}-${stamp}.zip`,
    bytes: createZip(entries, generatedAt),
  };
}
