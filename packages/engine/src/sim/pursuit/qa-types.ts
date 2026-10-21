/** The shape of the QA command handler of the pursuit module (M03c); the handler itself (`qa.ts`) is loaded by the QA worker entry only. */
import type { WorldApi } from '@dv/shared';
import type { DebugCommand } from '../transport/envelope.ts';
import type { PursuitDirector } from './director.ts';
import type { EcsPursuitHost } from './host.ts';
import type { WalletPort } from './ports.ts';

export interface PursuitQaContext {
  director: PursuitDirector;
  host: EcsPursuitHost;
  wallet: WalletPort;
  world: WorldApi | null;
  tick: number;
}

/** `cx` is null while the director cannot be built (no world services or no vehicle module yet); `send` posts a named QA message to the page. */
export type PursuitQaHandler = (cx: PursuitQaContext | null, cmd: DebugCommand, send: (name: string, data: unknown) => void) => void;
