/** Every section of the economy harness: `base` and the content sections (Act 1 from M05c1). */
import { ACT1_SECTION } from './act1.ts';
import { BASE_SECTIONS, type EconSection } from './base.ts';

export type { EconSection } from './base.ts';
export const SECTIONS: Readonly<Record<string, EconSection>> = { ...BASE_SECTIONS, act1: ACT1_SECTION };
