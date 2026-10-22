/**
 * `@dv/mode-tycoon` (M09a1): the descriptor and the data the shell needs without loading the sim half. The sim half
 * (`./sim/TycoonModeSim.ts`) is a lazy import, as C06 asks. The pure company simulation is `@dv/shared/tycoon`.
 */
export { tycoonDescriptor, tycoonUnlock } from './descriptor.ts';
