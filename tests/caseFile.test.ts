import { describe, expect, it } from "vitest";
import { createZip, crc32 } from "@/lib/zip";
import { buildCaseFile, renderReportText } from "@/lib/caseFile";
import { verify } from "@/lib/ttb/rules";
import { COMPLIANT_SPIRITS } from "@/lib/reader/mock";
import type { Application, LabelExtraction } from "@/lib/ttb/types";

/**
 * The downloadable case file.
 *
 * A decision without its evidence is not a record. Six months later, on an
 * appeal, "the tool approved it" is worth nothing — the artwork actually
 * reviewed, and the rule that fired on each item, is what makes the file
 * defensible. These tests check the archive is real (readable bytes in a valid
 * structure) and that the record inside it carries its reasoning.
 */

const APP: Application = {
  applicationId: "TTB-2026-004417",
  beverageType: "distilled_spirits",
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholContent: "45% Alc./Vol. (90 Proof)",
  netContents: "750 mL",
  bottlerName: "Old Tom Distillery",
  isImport: false,
};

const AT = new Date("2026-08-27T12:00:00Z");

function label(overrides: Partial<LabelExtraction> = {}): LabelExtraction {
  return { ...structuredClone(COMPLIANT_SPIRITS), ...overrides };
}

const report = () =>
  verify(APP, label(), { extractionMs: 2100, reader: "gemini:gemini-3.5-flash-lite" });

/** Minimal ZIP reader, so the archive is verified by reading it back. */
function readZipEntries(archive: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map<string, Uint8Array>();

  // Locate the end-of-central-directory record.
  let end = -1;
  for (let i = archive.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error("no end-of-central-directory record");

  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);

  for (let i = 0; i < count; i++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error("bad central directory signature");
    }
    const nameLength = view.getUint16(cursor + 28, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(archive.slice(cursor + 46, cursor + 46 + nameLength));

    if (view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error("bad local header signature");
    }
    const storedCrc = view.getUint32(localOffset + 14, true);
    const size = view.getUint32(localOffset + 22, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const extraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + extraLength;
    const data = archive.slice(dataStart, dataStart + size);

    // The checksum is the whole point of storing it; verify rather than trust.
    if (crc32(data) !== storedCrc) throw new Error(`CRC mismatch for ${name}`);

    entries.set(name, data);
    cursor += 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
  }

  return entries;
}

describe("crc32", () => {
  it("matches the known checksum for a standard test vector", () => {
    // "123456789" -> 0xCBF43926 is the canonical CRC-32 check value.
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("gives 0 for empty input", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("createZip", () => {
  it("produces an archive that reads back byte-for-byte", () => {
    const files = [
      { name: "report.txt", data: new TextEncoder().encode("hello record") },
      { name: "image.png", data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) },
    ];
    const entries = readZipEntries(createZip(files, AT));

    expect([...entries.keys()]).toEqual(["report.txt", "image.png"]);
    expect(new TextDecoder().decode(entries.get("report.txt"))).toBe("hello record");
    expect(Array.from(entries.get("image.png")!)).toEqual([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  });

  it("starts with the local file header signature, as every reader expects", () => {
    const archive = createZip([{ name: "a.txt", data: new Uint8Array([65]) }], AT);
    expect(Array.from(archive.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("is a pure function of its inputs", () => {
    // Same entries and timestamp must give identical bytes — that is what makes
    // the archive testable at all.
    const files = [{ name: "a.txt", data: new TextEncoder().encode("x") }];
    expect(createZip(files, AT)).toEqual(createZip(files, AT));
  });

  it("handles non-ASCII filenames", () => {
    const entries = readZipEntries(
      createZip([{ name: "étiquette-rosé.png", data: new Uint8Array([1]) }], AT),
    );
    expect(entries.has("étiquette-rosé.png")).toBe(true);
  });

  it("copes with an empty file", () => {
    const entries = readZipEntries(createZip([{ name: "empty.txt", data: new Uint8Array(0) }], AT));
    expect(entries.get("empty.txt")!.length).toBe(0);
  });
});

describe("renderReportText", () => {
  const text = () =>
    renderReportText(report(), APP, { imageFilename: "bourbon.png", generatedAt: AT });

  it("leads with the outcome in plain words", () => {
    expect(text()).toContain("NO PROBLEMS FOUND");
  });

  it("records which artwork the decision was made from", () => {
    expect(text()).toContain("bourbon.png");
  });

  it("carries the rule identifier for every check", () => {
    // The audit trail: on an appeal this is what answers "why did it say that?"
    const rendered = text();
    for (const check of report().checks) {
      expect(rendered).toContain(`Rule: ${check.rule}`);
    }
  });

  it("cites the governing regulation", () => {
    expect(text()).toContain("27 CFR 16.21");
  });

  it("states plainly that it is advisory", () => {
    // Normalise whitespace first: the report is hard-wrapped for printing, so a
    // phrase can legitimately straddle a line break.
    const flat = text().replace(/\s+/g, " ");
    expect(flat).toMatch(/not a determination/i);
    expect(flat).toMatch(/a compliance agent decides every application/i);
  });

  it("records the reader and the time taken", () => {
    const rendered = text();
    expect(rendered).toContain("gemini:gemini-3.5-flash-lite");
    expect(rendered).toMatch(/Time taken:\s+2\.1s/);
  });
});

describe("buildCaseFile", () => {
  it("packs the report, the data and the artwork together", () => {
    const file = buildCaseFile(
      report(),
      APP,
      { filename: "bourbon.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
      AT,
    );
    const entries = readZipEntries(file.bytes);
    expect([...entries.keys()].sort()).toEqual(["bourbon.png", "report.json", "report.txt"]);
  });

  it("keeps the original image bytes untouched", () => {
    // The evidence must be exactly what was reviewed, not a re-encoding of it.
    const original = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 99]);
    const file = buildCaseFile(report(), APP, { filename: "x.png", bytes: original }, AT);
    expect(Array.from(readZipEntries(file.bytes).get("x.png")!)).toEqual(Array.from(original));
  });

  it("writes machine-readable JSON alongside the printable report", () => {
    const file = buildCaseFile(report(), APP, { filename: "x.png", bytes: new Uint8Array([1]) }, AT);
    const json = JSON.parse(
      new TextDecoder().decode(readZipEntries(file.bytes).get("report.json")!),
    );
    expect(json.application.brandName).toBe("OLD TOM DISTILLERY");
    expect(json.report.recommendation).toBe("approve");
    expect(json.generatedAt).toBe(AT.toISOString());
  });

  it("names the archive after the application and the date", () => {
    const file = buildCaseFile(report(), APP, { filename: "x.png", bytes: new Uint8Array([1]) }, AT);
    expect(file.filename).toBe("label-check-ttb-2026-004417-2026-08-27.zip");
  });

  it("falls back to the brand name when there is no application reference", () => {
    const file = buildCaseFile(
      report(),
      { ...APP, applicationId: undefined },
      { filename: "x.png", bytes: new Uint8Array([1]) },
      AT,
    );
    expect(file.filename).toBe("label-check-old-tom-distillery-2026-08-27.zip");
  });

  it("is offered for a rejection too, and says so", () => {
    // A rejection is the record an agent needs most — it is what the rejection
    // letter is written from.
    const rejected = verify(
      APP,
      label({ netContents: null }),
      { extractionMs: 1000, reader: "test" },
    );
    const text = renderReportText(rejected, APP, {
      imageFilename: "x.png",
      generatedAt: AT,
    });
    expect(text).toContain("PROBLEMS FOUND");
    expect(text).toMatch(/net contents/i);
  });
});
