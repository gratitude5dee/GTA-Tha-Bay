/**
 * The mission debugger's two ends (C09 section C10; QA builds only, behind `VITE_DV_QA === '1'`):
 *  - sim side: `publishMissionDebug` puts the runtime's state in the view models `mode.story.debug` (core state, under the 4 KiB
 *    patch limit) and `mode.story.events` (the newest events that fit);
 *  - page side: `installMissionBridge` makes `window.__dvBridge.mission = {state, step, jump, events, predicate}` from those view
 *    models and `UiCommand mode.cmd` messages, for Playwright and coding agents.
 * Nothing here is reachable from a production build: the sim imports this module only through a dynamic import behind the QA flag.
 */
import type { JsonValue, ModeContext, UiCommand, ViewModelSource } from '@dv/shared';
import type { MissionRuntime } from '../vm/runtime.ts';

const EVENT_BYTES = 3300;
const CORE_BYTES = 3600;

const size = (v: unknown): number => JSON.stringify(v).length;

/** Sim side. Called every few ticks by the story mode in a QA build. */
export function publishMissionDebug(ctx: ModeContext, rt: MissionRuntime): void {
  if (!rt.active && rt.phase !== 'passed' && rt.phase !== 'aborted') {
    ctx.ui.patch('mode.story.debug', null);
    return;
  }
  const full = rt.debugState() as Record<string, JsonValue>;
  const { events, ...core } = full;
  let view: Record<string, JsonValue> = core;
  // keep the core under the patch limit: shed the longest lists first
  for (const key of ['cast', 'flags', 'threads', 'objectives']) {
    if (size(view) <= CORE_BYTES) break;
    view = { ...view, [key]: Array.isArray(view[key]) ? (view[key] as JsonValue[]).slice(0, 6) : {} };
  }
  ctx.ui.patch('mode.story.debug', { ...view, tick: ctx.tick });
  let list = (events as { tick: number; t: string; data: JsonValue }[]).slice(-24);
  while (list.length > 1 && size(list) > EVENT_BYTES) list = list.slice(1);
  ctx.ui.patch('mode.story.events', list as unknown as JsonValue);
}

// ---------------------------------------------------------------- page side

export interface MissionBridgeHost {
  readonly vm: ViewModelSource;
  sendUi(cmd: UiCommand): boolean;
  /** Runs `n` ticks while the game is paused. */
  step(n: number): boolean;
}

export interface MissionBridge {
  /** The mission state as the sim last published it, or null while no mission is active. */
  state(): Record<string, JsonValue> | null;
  step(ticks: number): boolean;
  jump(stage: number): boolean;
  events(since?: number): { tick: number; t: string; data: JsonValue }[];
  predicate(path: string): Promise<boolean | null>;
  pass(): boolean;
  fail(): boolean;
  retry(): boolean;
  quit(): boolean;
  talk(talkId: string, outcome: string): boolean;
  setFlag(key: string, value: boolean | number | string): boolean;
}

export function createMissionBridge(host: MissionBridgeHost): MissionBridge {
  const cmd = (name: string, args?: Record<string, JsonValue>): boolean => host.sendUi({ t: 'mode.cmd', mode: 'story', name, ...(args ? { args } : {}) });
  return {
    state: () => (host.vm.get<JsonValue>('mode.story.debug') as Record<string, JsonValue> | undefined) ?? null,
    step: (n) => host.step(n),
    jump: (stage) => cmd('debug.jump', { stage }),
    events: (since = 0) => ((host.vm.get<JsonValue>('mode.story.events') as unknown as { tick: number; t: string; data: JsonValue }[] | undefined) ?? []).filter((e) => e.tick >= since),
    predicate: (path) =>
      new Promise((resolve) => {
        const before = host.vm.get<JsonValue>('mode.story.predicate') as { path?: string; tick?: number } | undefined;
        const off = host.vm.subscribe('mode.story.predicate', (v) => {
          const r = v as { path?: string; value?: boolean | null; tick?: number } | undefined;
          if (r && r.path === path && (before === undefined || r.tick !== before.tick)) {
            off();
            resolve(r.value ?? null);
          }
        });
        cmd('debug.predicate', { path });
        setTimeout(() => {
          off();
          resolve(null);
        }, 3000);
      }),
    pass: () => cmd('debug.pass'),
    fail: () => cmd('debug.fail'),
    retry: () => cmd('mission.retry'),
    quit: () => cmd('mission.quit'),
    talk: (talkId, outcome) => cmd('talk.result', { talkId, outcome, turns: 0, path: 'scripted' }),
    setFlag: (key, value) => cmd('debug.flag', { key, value }),
  };
}

/** Installs `window.__dvBridge.mission`. */
export function installMissionBridge(host: MissionBridgeHost): MissionBridge {
  const bridge = createMissionBridge(host);
  const w = window as unknown as { __dvBridge?: Record<string, unknown> };
  w.__dvBridge = { ...(w.__dvBridge ?? {}), mission: bridge };
  return bridge;
}
