/**
 * Minimal RFC 4180 CSV reading and writing.
 *
 * Hand-rolled rather than pulled from npm. The requirement is one manifest
 * format we define ourselves and one export, so a dependency would buy little
 * and cost a supply-chain surface on a federal prototype. It handles quoting,
 * embedded commas, embedded newlines and doubled quotes, because a real
 * bottler line ("Old Tom Distillery Co., Bardstown, KY") contains a comma and
 * silently splitting on it would corrupt every row an importer submits.
 */

/** Parse CSV text into rows of raw cell values. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  // Normalise line endings first so CRLF files from Excel behave.
  const input = text.replace(/\r\n?/g, "\n");

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"'; // escaped quote
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  // Flush the final cell unless the file ended with a clean newline.
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((r) => r.some((value) => value.trim() !== ""));
}

/**
 * Parse CSV with a header row into keyed records.
 * Header names are lower-cased and stripped of spaces and underscores, so
 * "Brand Name", "brand_name" and "brandname" are all accepted.
 */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];

  const headers = rows[0].map(normaliseHeader);
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (row[index] ?? "").trim();
    });
    return record;
  });
}

export function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

/** Serialise rows to CSV, quoting only where necessary. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((row) => row.map(escapeCell).join(","))
    .join("\r\n");
}

function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
