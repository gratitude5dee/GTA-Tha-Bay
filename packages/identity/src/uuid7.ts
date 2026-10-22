/**
 * UUIDv7 (RFC 9562) minted on the device: 48-bit Unix ms, version nibble 7, variant `10`, 74 random bits.
 * The identity profile id is the one id the client may mint (06 section 4.3).
 */
export function uuid7(now: number = Date.now(), fill: (bytes: Uint8Array<ArrayBuffer>) => void = (b) => void crypto.getRandomValues(b)): string {
  const bytes = new Uint8Array(16);
  fill(bytes);
  const ms = Math.max(0, Math.floor(now));
  const hi = Math.floor(ms / 0x1_0000_0000);
  const lo = ms >>> 0;
  bytes[0] = (hi >>> 8) & 0xff;
  bytes[1] = hi & 0xff;
  bytes[2] = (lo >>> 24) & 0xff;
  bytes[3] = (lo >>> 16) & 0xff;
  bytes[4] = (lo >>> 8) & 0xff;
  bytes[5] = lo & 0xff;
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
