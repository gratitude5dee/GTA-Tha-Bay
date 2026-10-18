import { RngStreams, type Fnv64, type InputFrame, type SimServices } from '@dv/shared';
import type { ByteReader, ByteWriter } from './bytes.ts';
import type { PhysicsSystemsBackend } from './physics/backend.ts';

/**
 * Sim state that lives outside the ECS but must be hashed and checkpointed (C02 rule 7: RNG states, clock, weather,
 * pursuit, economy; M01a2 adds physics). Resources are hashed in ascending `name` order after the component stores.
 */
export interface SimResource {
  readonly name: string;
  hash(h: Fnv64): void;
  save(w: ByteWriter): void;
  load(r: ByteReader): void;
}

/** The services bag of this milestone: C02 SimServices plus the named RNG streams and the current input frame. */
export interface EngineServices extends SimServices {
  readonly rng: RngStreams;
  /** Player 0's quantized input for the tick about to run (C02 determinism rule 4); null when there is none. */
  input: InputFrame | null;
  /** The physics backend once the session has one (M01a2); null in physics-free sims. */
  physics: PhysicsSystemsBackend | null;
}

export function createSimServices(seed: number): EngineServices {
  return { xrPoses: null, rng: new RngStreams(seed), input: null, physics: null };
}

/** The RNG streams as a hashed, checkpointed resource (C02 rule 3: stream states are hashed resources). */
export function rngResource(rng: RngStreams): SimResource {
  return {
    name: 'rng',
    hash(h) {
      for (const { name, state } of rng.states()) {
        h.str(name);
        for (const word of state) h.u32(word);
      }
    },
    save(w) {
      const states = rng.states();
      w.u32(states.length);
      for (const { name, state } of states) {
        w.str(name);
        for (const word of state) w.u32(word);
      }
    },
    load(r) {
      const list: { name: string; state: [number, number, number, number] }[] = [];
      for (let n = r.u32(); n > 0; n--) {
        const name = r.str();
        list.push({ name, state: [r.u32(), r.u32(), r.u32(), r.u32()] });
      }
      rng.setStates(list);
    },
  };
}
