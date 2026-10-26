/**
 * QA builds only (M06c): the NPC agency's panel and `window.__dvBridge.npcAgency`.
 *
 * The panel sits at the bottom left of the default scene and shows what the named NPCs are doing: how many brains run at LOD A (and the
 * tier cap), B and C, how many barks played, and one row per roster NPC with its tier, the schedule block and the utility winner. The sim
 * publishes it on `sys.npc.debug` twice a second. To see it in a `DV_WORLD=synth` QA build: open `/?debug=1` (any tier flag), wait for the
 * world to reveal, and look around City Hall: the five roster NPCs walk and animate within 100 m of the start. Press E in front of a
 * pedestrian (or an NPC) for the Talk prompt; `?hour=` / `debug.hour` moves the clock so a block changes.
 *
 * The bridge: `debug()` the last published view, `filler(ahead)` stands a pedestrian in front of the player, `bump()` knocks it down (one
 * bark with a subtitle, then a cooldown; ignored while it is still down; `debug().fillerSeen` is 0 once the bark watcher has seen it up again), `bark(tag)` asks the nearest pedestrian for a bark, `subtitle()` reads `hud.subtitle`.
 */
import type { UiCommand } from '@dv/shared';

export interface AgencyQaEngine {
  vm: {
    get(key: string): unknown;
    subscribe(key: string, cb: (v: unknown) => void): () => void;
  };
  sendUi(cmd: UiCommand): void;
}

interface DebugView {
  a: number; b: number; c: number; peakA: number; cap: number;
  steps: { a: number; b: number };
  barks: { played: number; dropped: number; audible: number };
  talks: number; knots: number; intents: number;
  cmds: number; lastCmd: string; bound: boolean; filler: number; fillerSeen: number; grants: number;
  perf?: { ticks: number; aMax: number; bMax: number; cMax: number; brainMsMean: number; brainMsMax: number; sysMsMean: number; sysMsMax: number };
  npcs: { id: string; lod: string; block: number; who: string; x: number; z: number }[];
}

export type AgencyDebugView = DebugView;

export interface AgencyQaBridge {
  debug(): DebugView | null;
  filler(ahead?: number): void;
  bump(): void;
  bark(tag: string): void;
  subtitle(): { speaker?: string; text: string } | null;
  /** Starts a new measurement window of the brain cost and the LOD maxima (the perf scenario `npc-mission-crowd`). */
  perfReset(): void;
}

const cmd = (engine: AgencyQaEngine, name: string, args?: Record<string, unknown>): void =>
  engine.sendUi({ t: 'mode.cmd', mode: 'npc' as never, name, ...(args ? { args: args as never } : {}) });

export function installNpcAgencyQa(engine: AgencyQaEngine): AgencyQaBridge {
  const box = document.createElement('div');
  box.className = 'dv-npcagency';
  box.setAttribute('data-testid', 'npc-agency-panel');
  box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:60;max-width:300px;padding:6px 8px;font:11px/1.35 ui-monospace,monospace;color:#e8f0ff;background:rgba(10,14,24,.78);border-radius:6px;pointer-events:none;white-space:pre';
  box.textContent = 'NPC agency: waiting for the world';
  document.body.appendChild(box);
  let shown = '';
  const render = (v: unknown): void => {
    const d = v as DebugView | undefined;
    if (!d) return;
    const rows = d.npcs.map((n) => `${n.lod} ${n.id.slice(0, 14).padEnd(14)} b${String(n.block).padStart(2)} ${n.who}`).join('\n');
    // The text node is replaced only when the text differs: the view arrives twice a second, but what the panel shows (tiers, blocks, winners)
    // changes rarely, and a layer over the canvas that repaints twice a second for nothing is churn WebKit's software compositor does not need.
    const text = `NPC agency  A ${d.a}/${d.cap}  B ${d.b}  C ${d.c}  barks ${d.barks.played}\n${rows}`;
    if (text !== shown) {
      shown = text;
      box.textContent = text;
    }
  };
  engine.vm.subscribe('sys.npc.debug', render);
  render(engine.vm.get('sys.npc.debug'));

  const bridge: AgencyQaBridge = {
    debug: () => (engine.vm.get('sys.npc.debug') as DebugView | undefined) ?? null,
    filler: (ahead) => cmd(engine, 'qa.filler', ahead === undefined ? undefined : { ahead }),
    bump: () => cmd(engine, 'qa.bump'),
    bark: (tag) => cmd(engine, 'bark', { tag }),
    subtitle: () => (engine.vm.get('hud.subtitle') as { speaker?: string; text: string } | undefined) ?? null,
    perfReset: () => cmd(engine, 'perf.reset'),
  };
  const w = window as unknown as { __dvBridge?: Record<string, unknown> };
  w.__dvBridge = { ...(w.__dvBridge ?? {}), npcAgency: bridge };
  return bridge;
}
