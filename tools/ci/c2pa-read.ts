/**
 * Reads the C2PA claim of a rendition with the pinned `@contentauth/c2pa-node` (spec/03-decisions-and-facts.md section 7; M05c4).
 * Shared by `check:c2pa --verify-signatures` and by `prewarm --finish`, which reads each rendition back after signing it. Dev-time tool
 * code only: the package never reaches a Worker or the client bundle.
 */

/** The slice of the pinned tool this repository uses. */
export interface C2paReaderLike {
  json(): unknown;
  getActive(): { label?: string; ingredients?: { title?: string }[] } | undefined | null;
}
export interface C2paBuilderLike {
  setIntent(i: { create: string }): void;
  addIngredient(json: string, asset: { buffer: Buffer; mimeType: string }): Promise<void>;
  sign(signer: unknown, input: { path: string; mimeType: string }, output: { path: string }): unknown;
}
export interface C2paModuleLike {
  LocalSigner: { newSigner(cert: Buffer, key: Buffer, alg: string): unknown };
  Builder: { newAsync(): Promise<C2paBuilderLike> };
  Reader: { fromAsset(a: { path: string; mimeType: string }): Promise<C2paReaderLike | null> };
}

export async function loadC2pa(): Promise<C2paModuleLike> {
  return (await import('@contentauth/c2pa-node')) as unknown as C2paModuleLike;
}

/** The one validation code a self-made root produces; any other code is a failed claim. */
export const UNTRUSTED = 'signingCredential.untrusted';
/** The ingredient every re-signed rendition names (the unmodified original). */
export const ORIG_INGREDIENT = 'orig.mp4';

export interface SignatureInfo {
  /** An active manifest was found. */
  present: boolean;
  activeLabel: string | null;
  /** The active manifest lists `orig.mp4` as an ingredient. */
  hasOrigIngredient: boolean;
  /** Every validation code the reader reported. */
  codes: string[];
}

/** Reads the claim of a file. A file without a manifest is `present: false` (the reader answers null or throws). */
export async function inspectSignature(mod: C2paModuleLike, file: string, mimeType: string): Promise<SignatureInfo> {
  let reader: C2paReaderLike | null;
  try {
    reader = await mod.Reader.fromAsset({ path: file, mimeType });
  } catch {
    reader = null;
  }
  if (reader === null) return { present: false, activeLabel: null, hasOrigIngredient: false, codes: [] };
  const active = reader.getActive() ?? null;
  const doc = reader.json() as { validation_status?: { code?: string }[] } | null;
  const codes = (doc?.validation_status ?? []).flatMap((s) => (typeof s.code === 'string' ? [s.code] : []));
  return {
    present: active !== null,
    activeLabel: active?.label ?? null,
    hasOrigIngredient: (active?.ingredients ?? []).some((g) => g.title === ORIG_INGREDIENT),
    codes,
  };
}

/** What is wrong with a claim; empty when it has an active manifest naming `orig.mp4` and no code but `signingCredential.untrusted`. */
export function signatureProblems(info: SignatureInfo): string[] {
  if (!info.present) return ['no active C2PA manifest'];
  const out: string[] = [];
  if (!info.hasOrigIngredient) out.push(`the active manifest has no ${ORIG_INGREDIENT} ingredient`);
  const other = info.codes.filter((c) => c !== UNTRUSTED);
  if (other.length > 0) out.push(`validation code(s) ${[...new Set(other)].join(', ')} (only ${UNTRUSTED} is expected)`);
  return out;
}
