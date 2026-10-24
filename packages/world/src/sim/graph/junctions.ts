/**
 * The junction runtime (M02c1; 02-world-living.md sections 1.4 to 1.6): which junction a node belongs to and what its signal
 * shows now. Aspects come from the pure `signalAspect(program, tick, movement, blackout)`; no per-signal state is kept or hashed
 * (the blackout flag is the hashed resource `TrafficControl` owns). Only resident junctions carry programs: for a signalised
 * node whose chunk is not resident the aspect is `dark` during a blackout and `green` otherwise, because nothing drives there
 * yet. Pure; C02 lint applies.
 */
import { NodeControl, signalAspect, type Aspect, type Junction, type Movement, type NodeId } from '@dv/shared';
import type { RoadNetwork } from './adjacency.ts';

export interface JunctionClock {
  /** Sim tick (60 Hz) the aspects are evaluated at. */
  tick(): number;
  blackout(): boolean;
}

export class JunctionRuntime {
  constructor(private readonly net: RoadNetwork, private readonly clock: JunctionClock) {}

  /** The resident junction a node belongs to. */
  junctionAt(node: NodeId): Junction | undefined {
    const rn = this.net.residentNode(node);
    if (!rn || rn.junction < 0) return undefined;
    return this.net.junction(rn.junction);
  }

  movements(node: NodeId): readonly Movement[] {
    return this.junctionAt(node)?.movements ?? [];
  }

  /** The aspect a movement (`Movement.id`) of the junction at `node` shows now. */
  aspect(node: NodeId, movement: number): Aspect {
    const j = this.junctionAt(node);
    const dark = this.clock.blackout();
    if (j) {
      if (j.control !== NodeControl.Signal || !j.program) return 'green';
      return signalAspect(j.program, this.clock.tick(), movement, dark);
    }
    if (this.net.hasNode(node) && this.net.nodeControl(node) === NodeControl.Signal && dark) return 'dark';
    return 'green';
  }
}
