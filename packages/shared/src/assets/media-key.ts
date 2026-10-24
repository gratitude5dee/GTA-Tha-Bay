/**
 * Key grammar of the public media route `/media/<key>` (DL-713, M01d2). Pure, no IO.
 * Accepts exactly the shapes the publisher and the pipeline write; everything else is not a media key.
 */
const SEGMENT = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HASHED_FILE = /^([a-z0-9][a-z0-9._-]{0,127})\.([0-9a-f]{12})\.([a-z0-9]{1,16})$/;
const BARK_FILE = /^([0-9a-f]{64})\.([a-z0-9]{1,16})$/;
const MANIFEST_FILE = /^assets-[0-9a-f]{64}\.json$/;

function isSegment(s: string): boolean {
  return s !== '.' && s !== '..' && SEGMENT.test(s);
}

export function isMediaKey(key: string): boolean {
  if (key.length === 0 || key.length > 600 || key.includes('%') || key.includes('\\') || key.endsWith('/')) return false;
  const parts = key.split('/');
  if (parts.some((p) => p.length === 0)) return false;
  const last = parts[parts.length - 1] ?? '';
  switch (parts[0]) {
    case 'assets':
    case 'characters':
      return parts.length === 4 && isSegment(parts[1] ?? '') && isSegment(parts[2] ?? '') && HASHED_FILE.test(last);
    case 'audio':
      return parts.length === 3 && parts[1] === 'barks' && BARK_FILE.test(last);
    case 'cutscenes':
    case 'odbl':
      return parts.length === 3 && HEX64.test(parts[1] ?? '') && isSegment(last);
    case 'manifests':
      return parts.length === 2 && MANIFEST_FILE.test(last);
    default:
      return false;
  }
}
