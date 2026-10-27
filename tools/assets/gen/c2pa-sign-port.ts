/**
 * `SignPort` over the pinned `@contentauth/c2pa-node` (M05c4): re-signs one rendition with our claim (`trainedAlgorithmicMedia`,
 * `orig.mp4` as the ingredient) on the operator's workstation, with the signing chain and key from the operator's shell
 * (`C2PA_CERT_CHAIN_PEM`, `C2PA_KEY_PEM`; never in CI, never in the Worker). The signed file is read back with `Reader.fromAsset` and
 * the port refuses unless the active manifest names `orig.mp4` and the only validation code is `signingCredential.untrusted`.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SignedFile, SignPort } from '../../../services/pipeline/src/ports.ts';
import { inspectSignature, loadC2pa, signatureProblems, UNTRUSTED, type C2paModuleLike } from '../../ci/c2pa-read.ts';

export const TRAINED_ALGORITHMIC_MEDIA = 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia';

export interface C2paSignOptions {
  certChainPem: string;
  keyPem: string;
  /** Signing algorithm of the key; the fixtures and the default chain use es256. */
  alg?: string;
  /** Test input: the module to use instead of the pinned package. */
  load?: () => Promise<C2paModuleLike>;
}

export class C2paNodeSignPort implements SignPort {
  private mod: Promise<C2paModuleLike> | undefined;
  constructor(private readonly o: C2paSignOptions) {}

  private module(): Promise<C2paModuleLike> {
    this.mod ??= (this.o.load ?? loadC2pa)();
    return this.mod;
  }

  async resign(rendition: { file: string; bytes: Uint8Array; contentType: string }, orig: Uint8Array): Promise<SignedFile> {
    const mod = await this.module();
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dv-c2pa-'));
    try {
      const input = path.join(dir, 'in.mp4');
      const output = path.join(dir, 'out.mp4');
      writeFileSync(input, rendition.bytes);
      const signer = mod.LocalSigner.newSigner(Buffer.from(this.o.certChainPem), Buffer.from(this.o.keyPem), this.o.alg ?? 'es256');
      const builder = await mod.Builder.newAsync();
      builder.setIntent({ create: TRAINED_ALGORITHMIC_MEDIA });
      await builder.addIngredient(
        JSON.stringify({ title: 'orig.mp4', format: 'video/mp4', instance_id: `orig-${createHash('sha256').update(orig).digest('hex').slice(0, 12)}`, relationship: 'componentOf' }),
        { buffer: Buffer.from(orig), mimeType: 'video/mp4' },
      );
      builder.sign(signer, { path: input, mimeType: rendition.contentType }, { path: output });
      const info = await inspectSignature(mod, output, rendition.contentType);
      const problems = signatureProblems(info);
      if (problems.length > 0) throw new Error(`C2PA read-back of ${rendition.file} failed: ${problems.join('; ')}`);
      return { bytes: new Uint8Array(readFileSync(output)), c2pa: info.codes.includes(UNTRUSTED) ? 'valid-untrusted' : 'valid', resigned: true };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
