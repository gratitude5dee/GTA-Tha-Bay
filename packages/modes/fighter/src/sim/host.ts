/**
 * What the fighter sim module (`module.ts`) hands to the mode (`mode.ts`): whether the ECS mirror exists, the leniency of the render
 * tier, and the build id for replays. Without a module (a Node test, a session that never fights) the mode falls back to the
 * defaults here and runs on the view model alone. Sim code under the C02 lint.
 */
export interface FighterHost {
  /** The components 1280 to 1283 and their prefabs are registered. */
  mirror: boolean;
  /** 100, or 150 on a 30 fps render tier (FC5.3.6). */
  leniencyX100: number;
  build: string;
  /**
   * The match hash as a hashed resource (`fighter.match`), added to the sim on the first match, the way the economy adds its own, so a session
   * that never fights hashes as before. `digest` reads the live match (lo, hi, tick) or null; null detaches.
   */
  attach(digest: (() => [number, number, number] | null) | null): void;
}

let host: FighterHost = { mirror: false, leniencyX100: 100, build: 'dev', attach: () => undefined };

export const getFighterHost = (): FighterHost => host;
export function setFighterHost(h: FighterHost): void {
  host = h;
}
