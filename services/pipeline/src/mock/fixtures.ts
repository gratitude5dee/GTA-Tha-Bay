import { CUTSCENE_FIXTURES, type FixtureFile } from '../../fixtures/cutscene-data.ts';

export function fixtureEntry(name: string): FixtureFile {
  const f = CUTSCENE_FIXTURES[name];
  if (f === undefined) throw new Error(`missing cutscene fixture ${name}`);
  return f;
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const cache = new Map<string, Uint8Array>();

/** A copy of a committed fixture file (services/pipeline/fixtures/cutscene/). */
export function fixtureBytes(name: string): Uint8Array {
  let bytes = cache.get(name);
  if (bytes === undefined) {
    bytes = fromBase64(fixtureEntry(name).base64);
    cache.set(name, bytes);
  }
  return bytes.slice();
}
