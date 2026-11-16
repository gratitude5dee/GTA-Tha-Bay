import { expect, type Page } from '@playwright/test';
import { world } from './markings-helpers.ts';

/**
 * What the M02h4 tree specs share (`world-trees.spec.ts`, `trees-ledger.spec.ts`): `look().vegetation` as the QA bridge reports it (the
 * set, the pools, the instances per form, the wind, the drawn instances and the crossings waiting for upload room).
 */
export type Veg = {
  shown: number; hidden: number; farthestM: number; drawM: number; crossings: number; set: string; pools: number; drawnPools: number;
  forms: { form: string; instances: number; drawn: number; tris: number }[]; wind: number; drawnInstances: number; pendingCrossings: number;
  /** M02h5: the scatter (impostors, shrubs, hedges, band writes), the triangles per pool and in all. */
  scatter?: unknown; poolTris?: { key: string; mode: string; count: number; tris: number }[]; triangles?: number;
};

export const veg = async (page: Page): Promise<Veg> => {
  const v = await world(page, (w) => (w.look() as unknown as { vegetation?: unknown } | null)?.vegetation ?? null);
  expect(v, 'look().vegetation is reported').not.toBeNull();
  return v as Veg;
};
