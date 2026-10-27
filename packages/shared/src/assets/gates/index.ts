/** The pure gate cores of the asset pipeline (provenance, likeness, and the character gates A3 to A7). No IO; Worker-safe. */
export * from './types.ts';
export { checkRecord, checkDerivation, normalizeSha } from './provenance.ts';
export type { ProvenanceGateOptions } from './provenance.ts';
export { checkLikenessRecord, checkLikenessSummary } from './likeness.ts';
export type { ConsentIndex, ConsentEntry } from './likeness.ts';
export * from './a3-mesh.ts';
export * from './a4-rig.ts';
export * from './a5-retarget.ts';
export * from './a6-budget.ts';
export * from './a7-visual.ts';
