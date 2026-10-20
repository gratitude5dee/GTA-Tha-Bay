import type { VehicleView } from '@dv/shared';
import type { DebugCommand } from '../../sim/transport/envelope.ts';
import type { EngineHandle, EngineObservation } from '../boot/boot-engine.ts';
import { VEHICLE_VIEW_ORDER } from '../vehicle/vehicle-camera.ts';
import { createSaveBridge, type SaveBridge } from './save-bridge.ts';

/**
 * `window.__dvBridge.engine` (QA builds only; 01-engine.md section 2.11): JSON-friendly observation and debug commands
 * for Playwright and agents. This module is reachable only through a dynamic import behind `VITE_DV_QA === '1'`, so a
 * production dist contains neither it nor the string "__dvBridge" (apps/web/scripts/verify-dist.mjs).
 */
export interface SpawnReply {
  ok: boolean;
  handle?: number;
  key?: string | null;
  reason?: string;
}

export interface EngineBridge {
  observe(): EngineObservation;
  act(cmd: DebugCommand): boolean;
  /** Run `n` ticks while paused. */
  step(n: number): boolean;
  setPaused(paused: boolean): void;
  /** Results published by QA pages (determinism run), by name. */
  qa: Record<string, unknown>;
  /** Input reaches the game (true) or the world is a title backdrop (false). */
  setPlay(on: boolean): void;
  /** Ends the XR smoke session, if one runs. */
  endXr(): Promise<void>;
  /** C05 SaveService on the real database: list, write, load, kill (M04a1). */
  save: SaveBridge;
  /** Vehicles (M03a1). */
  spawn(prefab: string, at: [number, number, number], yaw?: number): Promise<SpawnReply | null>;
  /** The vehicle the local player drives (side key `veh`); null on foot. */
  vehicle(): EngineObservation['vehicle'];
  /** `enter` (with reach and the machine's checks), `seat` (at once), `exit`, `lock`, `unlock`, or `state`; `target` is an entity handle (default: the nearest vehicle). */
  vehicleOp(op: 'enter' | 'seat' | 'exit' | 'lock' | 'unlock' | 'state', target?: number): Promise<Record<string, unknown> | null>;
  /** The five vehicle cameras (R-PLAT-04). */
  vehicleCamera: {
    views(): readonly VehicleView[];
    view(): VehicleView;
    set(v: VehicleView): void;
    cycle(): VehicleView;
    /** Where the draw camera was put by the last vehicle-camera frame, and its distance from the anchor. */
    last(): { x: number; y: number; z: number; distance: number; view: VehicleView };
  };
  /** Input lines (QA): play one from now, stop, record, and stop recording (answers with the line). */
  line: {
    play(line: unknown): Promise<Record<string, unknown> | null>;
    stop(): Promise<Record<string, unknown> | null>;
    record(): Promise<Record<string, unknown> | null>;
    save(): Promise<Record<string, unknown> | null>;
  };
  /** The entity inspector and the physics wireframe (`?debug=1`). */
  tools: {
    inspector(on?: boolean): void;
    physics(on?: boolean): void;
    /** The components of an entity (default: the player's vehicle, else the player). */
    inspect(handle?: number): Promise<Record<string, unknown> | null>;
  };
}

export function installEngineBridge(engine: EngineHandle): EngineBridge {
  let serial = 1_000_000;   // apart from the inspector panel's ids, so that reply names never collide
  const ask = async (cmd: DebugCommand, reply: string): Promise<Record<string, unknown> | null> => (await engine.ask(cmd, reply)) as Record<string, unknown> | null;
  const bridge: EngineBridge = {
    spawn: async (prefab, at, yaw) => {
      const id = ++serial;
      return (await ask({ t: 'debug.spawn', id, prefab, at, ...(yaw !== undefined ? { yaw } : {}) }, `spawn.reply.${id}`)) as SpawnReply | null;
    },
    vehicle: () => engine.observe().vehicle,
    vehicleOp: async (op, target) => {
      const id = ++serial;
      return ask({ t: 'debug.vehicle', id, op, ...(target !== undefined ? { target } : {}) }, `vehicle.reply.${id}`);
    },
    vehicleCamera: {
      views: () => VEHICLE_VIEW_ORDER,
      view: () => engine.vehicleCamera.view,
      set: (v) => engine.vehicleCamera.setView(v),
      cycle: () => engine.vehicleCamera.cycle(),
      last: () => engine.vehicleCamera.last,
    },
    line: {
      play: async (line) => {
        const id = ++serial;
        return ask({ t: 'debug.line', id, op: 'play', line }, `line.reply.${id}`);
      },
      stop: async () => {
        const id = ++serial;
        return ask({ t: 'debug.line', id, op: 'stop' }, `line.reply.${id}`);
      },
      record: async () => {
        const id = ++serial;
        return ask({ t: 'debug.line', id, op: 'record' }, `line.reply.${id}`);
      },
      save: async () => {
        const id = ++serial;
        return ask({ t: 'debug.line', id, op: 'save' }, `line.reply.${id}`);
      },
    },
    tools: {
      inspector: (on) => engine.tools?.inspector.toggle(on),
      physics: (on) => engine.tools?.physics.toggle(on),
      inspect: async (handle) => {
        const id = ++serial;
        return ask({ t: 'debug.inspect', id, ...(handle !== undefined ? { handle } : {}) }, `inspect.reply.${id}`);
      },
    },
    observe: () => engine.observe(),
    act: (cmd) => engine.act(cmd),
    step: (n) => engine.step(n),
    setPaused: (p) => engine.setPaused(p),
    setPlay: (on) => engine.setPlay(on),
    endXr: () => engine.endXr(),
    save: createSaveBridge(),
    get qa() {
      return engine.qaResults();
    },
  };
  window.__dvBridge = { ...window.__dvBridge, engine: bridge };
  return bridge;
}

/** For pages that run no sim (the determinism page): publish results under the same `engine.qa` key. */
export function installQaBridge(results: () => Record<string, unknown>): void {
  const bridge: Partial<EngineBridge> = {
    get qa() {
      return results();
    },
    save: createSaveBridge(),
  };
  window.__dvBridge = { ...window.__dvBridge, engine: bridge as EngineBridge };
}
