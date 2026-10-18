import { utf8Bytes } from '@dv/shared';

/** Little-endian byte writer for snapshots. Grows by doubling. */
export class ByteWriter {
  private buf = new Uint8Array(1024);
  private view = new DataView(this.buf.buffer);
  length = 0;

  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.length + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number): void {
    this.ensure(1);
    this.view.setUint8(this.length, v);
    this.length += 1;
  }
  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.length, v, true);
    this.length += 2;
  }
  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.length, v >>> 0, true);
    this.length += 4;
  }
  i8(v: number): void {
    this.ensure(1);
    this.view.setInt8(this.length, v);
    this.length += 1;
  }
  i16(v: number): void {
    this.ensure(2);
    this.view.setInt16(this.length, v, true);
    this.length += 2;
  }
  i32(v: number): void {
    this.ensure(4);
    this.view.setInt32(this.length, v, true);
    this.length += 4;
  }
  f32(v: number): void {
    this.ensure(4);
    this.view.setFloat32(this.length, v, true);
    this.length += 4;
  }
  f64(v: number): void {
    this.ensure(8);
    this.view.setFloat64(this.length, v, true);
    this.length += 8;
  }
  str(s: string): void {
    const b = utf8Bytes(s);
    this.u32(b.length);
    this.bytes(b);
  }
  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }
  /** Copy of the written bytes. */
  toBytes(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

/** Little-endian byte reader matching ByteWriter. */
export class ByteReader {
  private readonly view: DataView;
  pos = 0;

  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  u8(): number {
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }
  u16(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  i8(): number {
    const v = this.view.getInt8(this.pos);
    this.pos += 1;
    return v;
  }
  i16(): number {
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i32(): number {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f32(): number {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f64(): number {
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }
  bytes(n: number): Uint8Array {
    const b = this.buf.slice(this.pos, this.pos + n);
    if (b.length !== n) throw new RangeError('ByteReader: unexpected end of data');
    this.pos += n;
    return b;
  }
  str(): string {
    const n = this.u32();
    const b = this.bytes(n);
    return decodeUtf8(b);
  }
}

/** UTF-8 decode without TextDecoder (sim code has no DOM or Node types). Invalid sequences become U+FFFD. */
export function decodeUtf8(b: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < b.length) {
    const c = b[i++] as number;
    let cp: number;
    if (c < 0x80) cp = c;
    else if (c >= 0xc0 && c < 0xe0 && i < b.length) cp = ((c & 0x1f) << 6) | ((b[i++] as number) & 0x3f);
    else if (c >= 0xe0 && c < 0xf0 && i + 1 < b.length) {
      cp = ((c & 0x0f) << 12) | (((b[i] as number) & 0x3f) << 6) | ((b[i + 1] as number) & 0x3f);
      i += 2;
    } else if (c >= 0xf0 && i + 2 < b.length) {
      cp = ((c & 0x07) << 18) | (((b[i] as number) & 0x3f) << 12) | (((b[i + 1] as number) & 0x3f) << 6) | ((b[i + 2] as number) & 0x3f);
      i += 3;
    } else cp = 0xfffd;
    out += String.fromCodePoint(cp);
  }
  return out;
}
