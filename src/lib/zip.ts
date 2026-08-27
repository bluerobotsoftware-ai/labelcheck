/**
 * A minimal ZIP writer, stored (uncompressed) entries only.
 *
 * Hand-written rather than pulled from npm. The requirement is three small
 * files in one archive; a compression library would add a supply-chain surface
 * to a federal prototype in exchange for saving perhaps forty kilobytes on a
 * PNG that is already compressed. The format below is the documented ZIP
 * structure — nothing clever, and every field is named.
 *
 * Stored rather than deflated for the same reason: the payload is one PNG or
 * JPEG (already compressed, deflate would gain almost nothing) plus two small
 * text files. Storing keeps this to a hundred lines of well-understood code
 * instead of an implementation of DEFLATE.
 *
 * Archives produced here open in Windows Explorer, macOS Archive Utility,
 * 7-Zip and `unzip` — verified against the structure, and by tests that read
 * the bytes back.
 */

/** Precomputed CRC-32 table (IEEE 802.3 polynomial, reflected). */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/** CRC-32 checksum, which the ZIP format requires for every entry. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Path inside the archive. Forward slashes only. */
  name: string;
  data: Uint8Array;
}

/**
 * MS-DOS date and time, which is what ZIP stores.
 *
 * Seconds have two-second resolution and the year is an offset from 1980 —
 * both quirks of the original format, not mistakes here.
 */
function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

/**
 * Build a ZIP archive from a list of entries.
 *
 * `at` is passed in rather than read from the clock so the output is a pure
 * function of its inputs — the same entries and the same timestamp produce
 * byte-identical archives, which is what makes this testable.
 */
export function createZip(entries: ZipEntry[], at: Date = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(at);

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const checksum = crc32(entry.data);
    const size = entry.data.length;

    // ---- Local file header (30 bytes + name) + the file data itself ----
    const local = new Uint8Array(30 + nameBytes.length + size);
    const localView = new DataView(local.buffer);

    localView.setUint32(0, 0x04034b50, true); // signature
    localView.setUint16(4, 20, true); // version needed to extract (2.0)
    localView.setUint16(6, 0x0800, true); // flags: bit 11 = UTF-8 filename
    localView.setUint16(8, 0, true); // compression method: 0 = stored
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, size, true); // compressed size (== uncompressed)
    localView.setUint32(22, size, true); // uncompressed size
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true); // extra field length

    local.set(nameBytes, 30);
    local.set(entry.data, 30 + nameBytes.length);
    locals.push(local);

    // ---- Central directory header (46 bytes + name) ----
    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);

    centralView.setUint32(0, 0x02014b50, true); // signature
    centralView.setUint16(4, 20, true); // version made by
    centralView.setUint16(6, 20, true); // version needed
    centralView.setUint16(8, 0x0800, true); // flags
    centralView.setUint16(10, 0, true); // stored
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, size, true);
    centralView.setUint32(24, size, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true); // extra
    centralView.setUint16(32, 0, true); // comment
    centralView.setUint16(34, 0, true); // disk number start
    centralView.setUint16(36, 0, true); // internal attributes
    centralView.setUint32(38, 0, true); // external attributes
    centralView.setUint32(42, offset, true); // offset of local header

    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((total, c) => total + c.length, 0);

  // ---- End of central directory record (22 bytes, no comment) ----
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); // signature
  endView.setUint16(4, 0, true); // this disk number
  endView.setUint16(6, 0, true); // disk with central directory
  endView.setUint16(8, entries.length, true); // entries on this disk
  endView.setUint16(10, entries.length, true); // total entries
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true); // central directory offset
  endView.setUint16(20, 0, true); // comment length

  const totalSize = offset + centralSize + end.length;
  const archive = new Uint8Array(totalSize);
  let cursor = 0;
  for (const part of [...locals, ...centrals, end]) {
    archive.set(part, cursor);
    cursor += part.length;
  }

  return archive;
}
