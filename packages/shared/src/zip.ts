// A store-only (uncompressed) ZIP writer for the data export of GET /me/export (M06a1). Pure: bytes in, bytes out.
// One local header and one central-directory record per entry, UTF-8 names (flag bit 11), a fixed DOS timestamp so the
// same entries always give the same bytes, and no ZIP64: an archive holds up to 65,535 entries of under 4 GiB each.

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = (CRC_TABLE[(c ^ (data[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1; // 1980-01-01

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function buildZip(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length > 0xffff) throw new Error('zip: too many entries');
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = utf8(e.name);
    const crc = crc32(e.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    const rec = new Uint8Array(46 + name.length);
    const cv = new DataView(rec.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    rec.set(name, 46);
    locals.push(local, e.data);
    central.push(rec);
    offset += local.length + e.data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const parts = [...locals, ...central, end];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Reads a store-only archive written by `buildZip` (used by tests and the export check). Throws on anything else. */
export function readZip(zip: Uint8Array): ZipEntry[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const total = v.getUint16(zip.length - 22 + 10, true);
  let at = v.getUint32(zip.length - 22 + 16, true);
  const out: ZipEntry[] = [];
  for (let i = 0; i < total; i++) {
    if (v.getUint32(at, true) !== 0x02014b50) throw new Error('zip: bad central record');
    const size = v.getUint32(at + 20, true);
    const nameLen = v.getUint16(at + 28, true);
    const localAt = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLen));
    const dataAt = localAt + 30 + v.getUint16(localAt + 26, true) + v.getUint16(localAt + 28, true);
    out.push({ name, data: zip.slice(dataAt, dataAt + size) });
    at += 46 + nameLen + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
  }
  return out;
}

/** The export archive of a profile's rows: `tables/<name>.json` per table, keys in sorted order. */
export function zipOfRows(rows: Record<string, unknown[]>, extra: readonly ZipEntry[] = []): Uint8Array {
  const entries: ZipEntry[] = Object.keys(rows)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => ({ name: `tables/${name}.json`, data: utf8(`${JSON.stringify(rows[name], null, 1)}\n`) }));
  return buildZip([...entries, ...extra]);
}

/** One-chunk stream of bytes (the shape `DataPort.profiles.exportAll` returns). */
export function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
