/**
 * The mission overlay (C09 section C10; QA builds only): a small DOM panel at the bottom left that lists the live threads (op path and
 * wait reason), the objectives, the cast, the mission flags, the clock and the newest events, with pause, step, skip stage and force
 * pass or fail. With no mission running it offers to start `m.dev.sample`. Plain DOM with a `data-testid` on each part; the spec
 * calls this file `overlay.tsx`, and the panels of the other modes in this repository are plain DOM as well (BD-M05a1-02).
 * Reached only through a dynamic import behind `VITE_DV_QA === '1'`.
 */
import type { JsonValue } from '@dv/shared';
import type { MissionBridge, MissionBridgeHost } from './bridge.ts';

const STYLE = `
.dv-mission{position:fixed;left:calc(env(safe-area-inset-left,0px) + .5rem);bottom:calc(env(safe-area-inset-bottom,0px) + .5rem);z-index:34;max-inline-size:min(25rem,62vw);max-block-size:55vh;overflow:auto;
padding:.4rem .5rem;border-radius:.5rem;background:rgba(14,18,26,.86);color:#f3f5f8;font:600 .72rem/1.3 system-ui,sans-serif;pointer-events:none}
.dv-mission button{pointer-events:auto;min-block-size:1.7rem;padding-inline:.45rem;border:1px solid rgba(255,255,255,.35);border-radius:.3rem;background:rgba(255,255,255,.1);color:inherit;font:inherit;cursor:pointer}
.dv-mission__row{display:flex;flex-wrap:wrap;gap:.25rem;margin-block:.25rem}
.dv-mission__h{margin:.35rem 0 .1rem;color:#f2c230;font-weight:700}
.dv-mission__l{display:block;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;font-weight:500}
.dv-mission__done{color:#6ed08b}.dv-mission__failed{color:#ff7b72}.dv-mission__pending{color:#9aa4b2}
`;

interface DebugState {
  phase: string;
  mission: string | null;
  stage: number;
  stageId: string | null;
  stages: number;
  attempt: number;
  seed: number;
  clockSec: number;
  beat: boolean;
  objectives: { id: string; k: string; state: string; text: string; optional: boolean }[];
  threads: { id: string; ptr: string; wait: string; ops: number }[];
  cast: { name: string; key: string; alive: boolean; task: string; distance: number }[];
  flags: Record<string, JsonValue>;
  failReason: string | null;
  hash: string;
}

export interface MissionOverlay {
  dispose(): void;
}

export function mountMissionOverlay(host: MissionBridgeHost & { setPaused?(p: boolean): void }, bridge: MissionBridge, container: HTMLElement = document.body): MissionOverlay {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);
  const root = document.createElement('div');
  root.className = 'dv-mission';
  root.dataset['dvQa'] = '';
  root.dataset['testid'] = 'mission-overlay';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Mission debug');
  container.append(root);
  let paused = false;
  let shown = '';

  const line = (text: string, cls = ''): HTMLSpanElement => {
    const s = document.createElement('span');
    s.className = `dv-mission__l ${cls}`.trim();
    s.textContent = text;
    return s;
  };
  const heading = (text: string, testid: string): HTMLDivElement => {
    const d = document.createElement('div');
    d.className = 'dv-mission__h';
    d.textContent = text;
    d.dataset['testid'] = testid;
    return d;
  };
  const button = (label: string, testid: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.dataset['testid'] = testid;
    b.addEventListener('click', fn);
    return b;
  };

  const render = (): void => {
    const st = bridge.state() as unknown as DebugState | null;
    const key = JSON.stringify(st ?? null) + String(paused);
    if (key === shown) return;
    shown = key;
    root.replaceChildren();
    if (!st) {
      root.append(line('MISSION none', ''));
      const row = document.createElement('div');
      row.className = 'dv-mission__row';
      row.append(
        button('start m.dev.sample', 'mission-start-sample', () => {
          const u = new URL(location.href);
          u.searchParams.set('mission', 'm.dev.sample');
          u.searchParams.set('seed', '1');
          u.searchParams.set('talk', 'scripted');
          // the intro beat of the sample is a generated cutscene: show the fixture clip with the AI chip (M05b2)
          u.searchParams.set('beats', 'video');
          location.href = u.toString();
        }),
      );
      root.append(row);
      return;
    }
    const head = line(`MISSION ${st.mission ?? '-'}  ${st.phase}  #${st.stage + 1}/${st.stages} (${st.stageId ?? '-'})  attempt ${st.attempt}  ${st.clockSec}s${st.beat ? '  BEAT' : ''}`);
    head.dataset['testid'] = 'mission-head';
    root.append(head);
    if (st.failReason) root.append(line(`failed: ${st.failReason}`, 'dv-mission__failed'));
    const row = document.createElement('div');
    row.className = 'dv-mission__row';
    row.append(
      button(paused ? 'resume' : 'pause', 'mission-pause', () => {
        paused = !paused;
        host.setPaused?.(paused);
        shown = '';
      }),
      button('step', 'mission-step', () => {
        if (!paused) {
          paused = true;
          host.setPaused?.(true);
        }
        bridge.step(1);
      }),
      button('skip stage', 'mission-skip', () => void bridge.jump(Math.min(st.stage + 1, st.stages - 1))),
      button('pass', 'mission-pass', () => void bridge.pass()),
      button('fail', 'mission-fail', () => void bridge.fail()),
      button('retry', 'mission-retry', () => void bridge.retry()),
      button('quit', 'mission-quit', () => void bridge.quit()),
    );
    root.append(row);

    root.append(heading('threads', 'mission-threads'));
    for (const t of st.threads) root.append(line(`${t.id.replace(/^mis:[^:]+:/, '')}  ${t.ptr}  ${t.wait}  ops ${t.ops}`));
    root.append(heading('objectives', 'mission-objectives'));
    for (const o of st.objectives) root.append(line(`${o.k} ${o.id} ${o.state}${o.optional ? ' (optional)' : ''}`, `dv-mission__${o.state}`));
    root.append(heading('cast', 'mission-cast'));
    for (const c of st.cast) root.append(line(`${c.name} ${c.alive ? 'alive' : 'gone'} ${c.task} ${c.distance} m`));
    const flags = Object.entries(st.flags);
    if (flags.length > 0) {
      root.append(heading('flags', 'mission-flags'));
      root.append(line(flags.map(([k, v]) => `${k}=${String(v)}`).join(' ')));
    }
    root.append(heading('events', 'mission-events'));
    for (const e of bridge.events().slice(-8)) root.append(line(`${e.tick} ${e.t}`));
  };

  const offs = [host.vm.subscribe('mode.story.*', () => render())];
  render();
  return {
    dispose() {
      for (const off of offs) off();
      root.remove();
      style.remove();
    },
  };
}
