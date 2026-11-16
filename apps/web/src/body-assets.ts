import type { BodyAssets } from '@dv/engine/client/boot';

/**
 * The bytes of the on-foot bodies (M10d5) through the asset worker: the files of a group at the variant the pool asks for, read one after
 * another in the `idle` lane by the world's `world.ped` job (M10d4, `packages/world/src/client/peds/ped-job.ts`, which reads any catalog
 * ref at a variant), and the atlas pages decoded here. Nothing is asked before the world's reveal plus one task, so the bodies add nothing
 * to the boot's request counts (the boot figures are read in the reveal's task, as the surface textures and the pedestrian kit wait).
 * A ref the catalog lacks rejects, so the pool keeps the mannequin.
 */
export function bodyAssets(client: { job(name: string, args: unknown): Promise<unknown> }, revealed: Promise<void>): BodyAssets {
  const after = revealed.then(() => new Promise<void>((r) => setTimeout(r, 0)));
  const group = async (refs: string[], variant: 'mobile' | 'mobile-low'): Promise<ArrayBuffer[]> => {
    await after;
    const r = (await client.job('world.ped', { refs, variant })) as { files?: ArrayBuffer[]; missing?: true };
    if (r.missing) throw new Error(`${refs.join(', ')}: not in the asset catalog`);
    if (!r.files || r.files.length < refs.length) throw new Error(`${refs.join(', ')}: not all read`);
    return r.files;
  };
  return {
    group,
    image: async (ref, variant) => {
      const [bytes] = await group([ref], variant);
      try {
        return { source: await createImageBitmap(new Blob([bytes as ArrayBuffer], { type: 'image/png' })) };
      } catch {
        return null;
      }
    },
  };
}
