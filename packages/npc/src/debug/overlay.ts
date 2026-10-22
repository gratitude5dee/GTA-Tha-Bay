/**
 * The NPC debug overlay and bridge (M06a3; QA builds only). `window.__dvBridge.npc.talk(npcId, turn)` runs one turn through the real
 * NpcRuntime, and a small DOM panel shows what it does: the AI badge from `meta.disclosure`, the streamed line, where the answer came
 * from (live model, recorded fixture, or ink) and the event order. It is the stand-in for the dialogue panel of M06a5, and talks to
 * `npc_test` by default. Plain DOM with a `data-testid` on each part, like the other QA panels. Reached only through a dynamic import
 * behind `VITE_DV_QA === '1'`, so a production build does not contain it.
 */
import type { DialogueEvent, NPCDialogueContext, NPCDialogueRequest } from '@dv/shared/contracts/c10-npc';
import type { NpcRuntime } from '../client/runtime.ts';

export interface DebugTurnResult {
  npcId: string;
  source: 'llm' | 'ink';
  /** `live` or `fixture` from the Worker (header X-DV-Npc-Mode), or null when the turn never reached it. */
  mode: string | null;
  encounterId: string | null;
  /** The line as shown after the turn: the text of `line.done` events, joined. */
  text: string;
  events: DialogueEvent[];
  /** `meta.disclosure.aiCharacter`. */
  aiCharacter: boolean;
}

export interface NpcBridge {
  /** One turn through the runtime. `turn` defaults to a greeting. */
  talk(npcId?: string, turn?: NPCDialogueRequest['turn']): Promise<DebugTurnResult>;
  last(): DebugTurnResult | null;
  /** Ends the encounter with the NPC (the next turn opens a new one). */
  end(npcId?: string): void;
  /** Subscribes to changes of the shown state; returns the unsubscribe. */
  onChange(fn: () => void): () => void;
  /** The mode header of the latest response; set by the page's runtime through `noteResponse`. */
  noteResponse(res: Response): void;
  /** QA only: use this `Authorization` value (`PlayToken <token>`) for the next turns instead of the identity's; null goes back to the identity. */
  setAuthHeader(header: string | null): void;
}

export const DEBUG_NPC_ID = 'npc_test';

/** A neutral story-mode scene: nothing offered, nothing nearby. */
export function debugContext(): NPCDialogueContext {
  return {
    schema: 1,
    clockT: 7200,
    chunkKey: '9/256/256',
    poiId: null,
    mode: 'story',
    missionId: null,
    missionStep: null,
    player: { heat: 0, inVehicle: false, health: 'ok', streetCred: 0, techClout: 0 },
    relation: { trust: 0, met: false },
    events: [],
    offers: { missionIds: [], raceIds: [], dealIds: [] },
    tycoon: null,
    voice: 'off',
    locale: 'en-US',
  };
}

export function installNpcBridge(runtime: NpcRuntime, hooks: { setAuthHeader?: (header: string | null) => void } = {}, target: { __dvBridge?: Record<string, unknown> } = window as never): NpcBridge {
  const listeners = new Set<() => void>();
  let last: DebugTurnResult | null = null;
  let mode: string | null = null;
  const bridge: NpcBridge = {
    async talk(npcId = DEBUG_NPC_ID, turn = { intent: 'greet' }) {
      mode = null;
      const events: DialogueEvent[] = [];
      let committed = ''; // the finished lines
      let streaming = ''; // the line still arriving
      let ai = false;
      const partial: DebugTurnResult = { npcId, source: 'llm', mode: null, encounterId: null, text: '', events, aiCharacter: false };
      last = partial;
      const shown = (): string => (streaming === '' ? committed : committed === '' ? streaming : `${committed} ${streaming}`);
      const on = (e: DialogueEvent): void => {
        events.push(e);
        if (e.event === 'meta') ai = e.data.disclosure.aiCharacter;
        else if (e.event === 'line.delta' && typeof e.data.text === 'string') streaming += e.data.text;
        else if (e.event === 'line.done') {
          committed = committed === '' ? e.data.text : `${committed} ${e.data.text}`;
          streaming = '';
        } else if (e.event === 'fallback') {
          // the partial line is dropped; ink lines follow
          committed = '';
          streaming = '';
        }
        partial.text = shown();
        partial.aiCharacter = ai;
        partial.mode = mode;
        listeners.forEach((fn) => fn());
      };
      listeners.forEach((fn) => fn());
      const r = await runtime.talk(npcId, turn, debugContext(), on);
      last = { npcId, source: r.source, mode, encounterId: r.encounterId, text: shown(), events, aiCharacter: ai };
      listeners.forEach((fn) => fn());
      return last;
    },
    last: () => last,
    end: (npcId = DEBUG_NPC_ID) => runtime.endEncounter(npcId),
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    noteResponse(res) {
      mode = res.headers.get('x-dv-npc-mode');
    },
    setAuthHeader(header) {
      hooks.setAuthHeader?.(header);
    },
  };
  const w = target as { __dvBridge?: Record<string, unknown> };
  w.__dvBridge = { ...(w.__dvBridge ?? {}), npc: bridge };
  return bridge;
}

const STYLE = `
.dv-npcdbg{position:fixed;right:calc(env(safe-area-inset-right,0px) + .5rem);top:calc(env(safe-area-inset-top,0px) + .5rem);z-index:35;inline-size:min(20rem,62vw);max-block-size:45vh;overflow:auto;pointer-events:none;
padding:.45rem .55rem;border-radius:.5rem;background:rgba(14,18,26,.9);color:#f3f5f8;font:600 .72rem/1.35 system-ui,sans-serif}
.dv-npcdbg button,.dv-npcdbg input{pointer-events:auto}
.dv-npcdbg button{min-block-size:1.8rem;padding-inline:.5rem;border:1px solid rgba(255,255,255,.35);border-radius:.3rem;background:rgba(255,255,255,.1);color:inherit;font:inherit;cursor:pointer}
.dv-npcdbg input{box-sizing:border-box;inline-size:100%;min-block-size:1.8rem;margin-block:.25rem;padding-inline:.4rem;border:1px solid rgba(255,255,255,.35);border-radius:.3rem;background:rgba(0,0,0,.35);color:inherit;font:inherit}
.dv-npcdbg__h{display:flex;justify-content:space-between;align-items:center;gap:.4rem;color:#f2c230;font-weight:700}
.dv-npcdbg__badge{padding:.05rem .35rem;border-radius:.6rem;background:#f2c230;color:#14181f;font-size:.66rem}
.dv-npcdbg__row{display:flex;flex-wrap:wrap;gap:.25rem;margin-block:.3rem}
.dv-npcdbg__line{min-block-size:2.6em;font-size:.85rem;font-weight:500;overflow-wrap:anywhere}
.dv-npcdbg__meta{color:#9aa4b2;font-weight:500;overflow-wrap:anywhere}
`;

export interface NpcOverlay {
  dispose(): void;
}

export function mountNpcOverlay(bridge: NpcBridge, container: HTMLElement = document.body, npcId: string = DEBUG_NPC_ID): NpcOverlay {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);
  const root = document.createElement('div');
  root.className = 'dv-npcdbg';
  root.dataset['testid'] = 'npc-overlay';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'NPC dialogue debug');

  const head = document.createElement('div');
  head.className = 'dv-npcdbg__h';
  const title = document.createElement('span');
  title.textContent = `Talk to ${npcId} (QA)`;
  const badge = document.createElement('span');
  badge.className = 'dv-npcdbg__badge';
  badge.dataset['testid'] = 'npc-ai-badge';
  badge.textContent = 'AI character';
  badge.hidden = true;
  head.append(title, badge);

  const line = document.createElement('div');
  line.className = 'dv-npcdbg__line';
  line.dataset['testid'] = 'npc-line';
  line.setAttribute('aria-live', 'polite');
  const meta = document.createElement('div');
  meta.className = 'dv-npcdbg__meta';
  meta.dataset['testid'] = 'npc-meta';

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 280;
  input.placeholder = 'Say something (280 characters)';
  input.dataset['testid'] = 'npc-input';
  input.setAttribute('aria-label', 'Say something to the character');

  let busy = false;
  const say = (turn: NPCDialogueRequest['turn']): void => {
    if (busy) return;
    busy = true;
    void bridge.talk(npcId, turn).finally(() => {
      busy = false;
    });
  };
  const button = (label: string, testid: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.dataset['testid'] = testid;
    b.addEventListener('click', fn);
    return b;
  };
  const row = document.createElement('div');
  row.className = 'dv-npcdbg__row';
  row.append(
    button('Greet', 'npc-greet', () => say({ intent: 'greet' })),
    button('Small talk', 'npc-smalltalk', () => say({ text: 'How is the weather?', intent: 'smalltalk' })),
    button('Say', 'npc-send', () => {
      const text = input.value.trim();
      if (text !== '') say({ text, intent: 'smalltalk' });
    }),
    button('Farewell', 'npc-farewell', () => say({ intent: 'farewell' })),
    button('New talk', 'npc-reset', () => bridge.end(npcId)),
  );
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const text = input.value.trim();
      if (text !== '') say({ text, intent: 'smalltalk' });
    }
  });
  root.append(head, line, meta, row, input);
  container.append(root);

  const sourceLabel = (r: DebugTurnResult): string => {
    if (r.source === 'ink') return r.mode === null && r.events.every((e) => e.event !== 'meta') ? 'ink (no stream from the Worker: no play token, offline, or dialogue off)' : 'ink (fallback)';
    return r.mode === 'local-fixture' ? 'recorded in this browser (?npc=local), no Worker' : r.mode === 'fixture' ? 'recorded fixture, not a live model' : r.mode === 'live' ? 'live model' : 'model';
  };
  const render = (): void => {
    const r = bridge.last();
    if (r === null) return;
    line.textContent = r.text;
    badge.hidden = !r.aiCharacter;
    meta.textContent = `${sourceLabel(r)} · ${r.events.map((e) => e.event).join(' ')}`;
  };
  const off = bridge.onChange(render);
  return {
    dispose() {
      off();
      root.remove();
      style.remove();
    },
  };
}
