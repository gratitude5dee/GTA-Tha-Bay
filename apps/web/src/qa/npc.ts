/**
 * QA builds only (M06a3): `window.__dvBridge.npc` and the small "Talk to npc_test" panel at the top right of the default scene.
 * The runtime is the real one (`@dv/npc`): it posts to route 31 with the P0 play token, streams the answer into the panel, and plays the
 * NPC's ink when the token, the network or the Worker says no. In a Workers Preview or a staging build the Worker answers from recorded
 * streams until the operator turns `ANTHROPIC_MODE=live` on, and the panel says so ("recorded fixture, not a live model").
 *
 * `?npc=local` runs the same client against a recorded stream made in the browser (no Worker, no play token, header
 * `X-DV-Npc-Mode: local-fixture`): the way to see the streamed line and the AI badge where the Worker has no `PLAY_TOKEN_HMAC` or the
 * visitor has not passed the 18+ screen. The panel labels it "recorded in this browser".
 *
 * `npc_test` is the only NPC wired here: its compiled ink and soul version come from the repository files (bundled into QA builds only,
 * because this module is reached through a dynamic import behind `VITE_DV_QA === '1'`). The real roster and ink assets arrive with M06a5.
 */
import type { NpcBridge, NpcBridgeHooks } from '@dv/npc/debug';
import type { LipSyncTarget, TtsAudioHost } from '@dv/npc/voice';
import { DIALOGUE_OPEN_KEY, DialogueSession, bindDialogueOpen, setDialogueSession, type SpeakerInfo } from '@dv/ui';
import soulsIndex from '../../../../content/npcs/souls.index.json';
import npcTestInk from '../../../../assets/src/data/ink.npc_test/ink.json?raw';
import roBatistaInk from '../../../../assets/src/data/ink.ro-batista/ink.json?raw';
import type { IdentityWiring } from '../identity.ts';
import { babbleChunks } from './babble.ts';

/**
 * The panel talks to `npc_test` (no voice: its soul has tier text) or, with `?npcId=ro-batista`, to the original voiced hero (tier t1: Aura through
 * the Worker, a synthetic tone in `?npc=local`). Both are bundled into the Worker's fixture mode.
 */
const INK: Record<string, string> = { npc_test: npcTestInk, 'ro-batista': roBatistaInk };
const wanted = typeof location === 'undefined' ? '' : (new URLSearchParams(location.search).get('npcId') ?? '');
const NPC_ID = wanted in INK ? wanted : 'npc_test';

const LINES: Record<string, string> = {
  greet: 'Good day. Please confirm the lot is clear.',
  smalltalk: 'Noted. The forecast on the clipboard says clear.',
  farewell: 'Checklist complete. Good day.',
};
const OTHER = 'Copy that. This answer is a recorded fixture, not a live model.';

/** A `fetch` that answers the talk route with a recorded stream (events and pacing like the Worker's) and leaves every other request alone. */
export function localFixtureFetch(real: typeof fetch): typeof fetch {
  return (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!/\/api\/v1\/npc\/[^/]+\/talk$/.test(url)) return real(input, init);
    const req = JSON.parse(String(init?.body ?? '{}')) as { turn?: { intent?: string }; encounterId?: string; context?: { voice?: string } };
    const voiced = req.context?.voice === 'auto';
    const line = LINES[req.turn?.intent ?? ''] ?? OTHER;
    const frame = (event: string, data: unknown): Uint8Array => new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const chunks = line.match(/.{1,9}/g) ?? [line];
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
        controller.enqueue(
          frame('meta', {
            encounterId: req.encounterId ?? '0198aaaa-bbbb-7ccc-8ddd-eeeeffff0000', turnIndex: 0, npcId: NPC_ID, soulVersion: 1, model: 'haiku', voice: voiced ? 't1' : 'text', turnsLeft: 5,
            disclosure: { aiCharacter: true, disclaimer: 'none' }, gov: 0,
          }),
        );
        await pause(300);
        for (const [i, text] of chunks.entries()) {
          controller.enqueue(frame('line.delta', { seq: i, text }));
          await pause(60);
        }
        // M06a4: a voiced turn sends a synthetic audio line (sentence by sentence) after the text, before line.done, as the Worker does.
        if (voiced) {
          await pause(120);
          for (const [j, audio] of babbleChunks(line).entries()) controller.enqueue(frame('line.delta', { seq: chunks.length + j, audio }));
        }
        controller.enqueue(frame('line.done', { text: line, words: line.split(' ').length }));
        controller.enqueue(frame('effects', { mood: 'neutral' }));
        controller.enqueue(frame('done', { costMicros: 0, turnsLeft: 5, closed: false }));
        controller.close();
      },
    });
    return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', 'x-dv-npc-mode': 'local-fixture' } }));
  };
}

/** The page's view-model store, as far as the dialogue panel needs it (`ViewModelStore`): `setLocal` is for values only the page knows. */
export interface NpcQaVm {
  get(key: never): unknown;
  subscribe(key: never, cb: (v: unknown) => void): () => void;
  setLocal(key: never, v: never): void;
}

/** Name and disclaimer of the QA NPCs, as their souls say (`content/npcs/<id>/soul.md`). `ro-batista` shows the likeness card on first contact. */
const SPEAKERS: Record<string, SpeakerInfo> = {
  npc_test: { name: 'Tester Nine', disclaimer: 'none' },
  'ro-batista': { name: 'Ro Batista', disclaimer: 'fictional' },
};

/** What the page gives the NPC panel for voice: the engine's audio service and the first-gesture unlock. Null without Web Audio. */
export interface NpcQaAudio {
  host: TtsAudioHost;
  /** Unlocks the audio context (inside the click on the Voice switch). */
  unlock(): void;
}

/**
 * `startAfter`: the runtime's roster poll (`GET /api/v1/roster` on start, then every 30 s) begins only once it settles. The page passes
 * the age gate, so an unattested or blocked device sends nothing to the Worker API (BD-FIX-CI5-G02); the panel and the bridge are there at once.
 */
export async function installNpcQa(
  identity: IdentityWiring,
  audio: NpcQaAudio | null = null,
  startAfter: Promise<void> = Promise.resolve(),
  vm: NpcQaVm | null = null,
  emit: ((name: 'npc.turn.client' | 'npc.encounter.client', props: Record<string, string | number | boolean>) => void) | null = null,
): Promise<NpcBridge> {
  const [{ createNpcRuntime }, { installNpcBridge, mountNpcOverlay }, { TtsPlayer, LipSyncDriver }] = await Promise.all([
    import('@dv/npc/client'),
    import('@dv/npc/debug'),
    import('@dv/npc/voice'),
  ]);
  const local = new URLSearchParams(location.search).get('npc') === 'local';
  let bridge: NpcBridge | null = null;
  // M06b1: user NPCs made through the builder (soul version by id); the runtime asks for these versions on route 31.
  const userNpcs = new Map<string, number>();
  let override: string | null = local ? 'PlayToken local-fixture' : null;
  // Voice (M06a4): the TtsPlayer plays the stream's audio chunks on the voice bus; the LipSyncDriver lights the mouth cell in the panel, once per frame.
  let overlayMouth: LipSyncTarget | null = null;
  const driver = audio === null ? null : new LipSyncDriver({ clock: () => audio.host.context?.currentTime ?? 0 });
  const player =
    audio === null || driver === null
      ? null
      : new TtsPlayer({
          audio: audio.host,
          lipSync: { driver, target: () => (overlayMouth === null ? null : { target: overlayMouth, hasJaw: false }) },
        });
  if (driver !== null) {
    const frame = (): void => {
      if (driver.speaking().length > 0) driver.update();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  // The runtime's telemetry goes to the platform client, and a copy stays here for `__dvBridge.npc.telemetry()` (the e2e reads it).
  const seen: { name: string; props: Record<string, string | number | boolean> }[] = [];
  const runtime = createNpcRuntime({
    telemetry: {
      emit: (name, props) => {
        seen.push({ name, props });
        emit?.(name, props);
      },
    },
    auth: async () => {
      if (override !== null) return { Authorization: override };
      const service = await identity.ready;
      return service === null ? null : service.authHeader();
    },
    ...(local ? { fetch: localFixtureFetch(fetch.bind(globalThis)) } : {}),
    soulVersionOf: (id) => (INK[id] !== undefined ? ((soulsIndex as { souls: Record<string, { soulVersion: number }> }).souls[id]?.soulVersion ?? 1) : (userNpcs.get(id) ?? null)),
    loadInk: (id) => (INK[id] !== undefined ? Promise.resolve(INK[id] as string) : Promise.reject(new Error(`no ink bundled for ${id}`))),
    onResponse: (res) => bridge?.noteResponse(res),
    ...(player === null ? {} : { voice: player, settings: () => ({ aiDialogue: true, voice: 'all' as const }) }),
  });
  // M06a5: with a view-model store the real dialogue panel (`DialogueBubble`, mounted by the shell) takes the conversation. The bridge opens it
  // through `sys.dialogue.open`, the session runs the turns, and `hud.subtitle` carries each line. Without a store the box talks to the runtime alone.
  const hooks: NpcBridgeHooks = { telemetry: () => seen, setAuthHeader: (h) => (override = h), onVoice: (on) => (on ? audio?.unlock() : player?.stop(NPC_ID)) };
  if (vm !== null) {
    const { debugContext } = await import('@dv/npc/debug');
    const key = DIALOGUE_OPEN_KEY as never;
    let seq = 0;
    const s = new DialogueSession({
      runtime,
      speaker: (id) => SPEAKERS[id] ?? { name: id, disclaimer: 'none' },
      context: () => debugContext(bridge?.voiceOn() ? 'auto' : 'off'),
      subtitle: (cue) => vm.setLocal('hud.subtitle' as never, cue as never),
      onClosed: () => vm.setLocal(key, null as never),
      audio: player === null || audio === null ? null : { available: () => audio.host.unlocked, line: (id) => player.clock(id) },
    });
    setDialogueSession(s);
    bindDialogueOpen({ get: () => vm.get(key), subscribe: (_k, cb) => vm.subscribe(key, cb) }, s);
    hooks.openPanel = (npcId) => {
      const now = s.state();
      if (!(now.open && now.npcId === npcId)) vm.setLocal(key, { npcId, id: ++seq } as never);
    };
    hooks.runTurn = (_npcId, turn, _ctx, on) => s.say(turn, on);
  }
  bridge = installNpcBridge(runtime, hooks);
  overlayMouth = mountNpcOverlay(bridge, document.body, NPC_ID).mouth;
  // M06b1: `bridge.useUserNpc(id, soulVersion)` for tests, and the builder QA (button, `bridge.buildTestNpc()`) in the same box.
  Object.assign(bridge, { useUserNpc: (id: string, soulVersion: number) => void userNpcs.set(id, soulVersion) });
  const { installBuilderQa } = await import('./npc-builder.ts');
  const statusLine = (text: string): void => {
    const el = document.querySelector('[data-testid="npc-builder-status"]');
    if (el !== null) el.textContent = text;
  };
  installBuilderQa(
    bridge,
    {
      auth: async () => {
        if (override !== null) return override;
        const service = await identity.ready;
        const h = service === null ? null : await service.authHeader();
        return h?.Authorization ?? null;
      },
      register: (id, v) => void userNpcs.set(id, v),
    },
    statusLine,
  );
  void startAfter.then(() => runtime.start());
  return bridge;
}
