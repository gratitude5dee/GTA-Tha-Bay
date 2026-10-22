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
import type { NpcBridge } from '@dv/npc/debug';
import type { LipSyncTarget, TtsAudioHost } from '@dv/npc/voice';
import soulsIndex from '../../../../content/npcs/souls.index.json';
import npcTestInk from '../../../../assets/src/data/ink.npc_test/ink.json?raw';
import type { IdentityWiring } from '../identity.ts';
import { babbleChunks } from './babble.ts';

const NPC_ID = 'npc_test';

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

/** What the page gives the NPC panel for voice: the engine's audio service and the first-gesture unlock. Null without Web Audio. */
export interface NpcQaAudio {
  host: TtsAudioHost;
  /** Unlocks the audio context (inside the click on the Voice switch). */
  unlock(): void;
}

export async function installNpcQa(identity: IdentityWiring, audio: NpcQaAudio | null = null): Promise<NpcBridge> {
  const [{ createNpcRuntime }, { installNpcBridge, mountNpcOverlay }, { TtsPlayer, LipSyncDriver }] = await Promise.all([
    import('@dv/npc/client'),
    import('@dv/npc/debug'),
    import('@dv/npc/voice'),
  ]);
  const version = (soulsIndex as { souls: Record<string, { soulVersion: number }> }).souls[NPC_ID]?.soulVersion ?? 1;
  const local = new URLSearchParams(location.search).get('npc') === 'local';
  let bridge: NpcBridge | null = null;
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
  const runtime = createNpcRuntime({
    auth: async () => {
      if (override !== null) return { Authorization: override };
      const service = await identity.ready;
      return service === null ? null : service.authHeader();
    },
    ...(local ? { fetch: localFixtureFetch(fetch.bind(globalThis)) } : {}),
    soulVersionOf: (id) => (id === NPC_ID ? version : null),
    loadInk: (id) => (id === NPC_ID ? Promise.resolve(npcTestInk) : Promise.reject(new Error(`no ink bundled for ${id}`))),
    onResponse: (res) => bridge?.noteResponse(res),
    ...(player === null ? {} : { voice: player, settings: () => ({ aiDialogue: true, voice: 'all' as const }) }),
  });
  bridge = installNpcBridge(runtime, { setAuthHeader: (h) => (override = h), onVoice: (on) => (on ? audio?.unlock() : player?.stop(NPC_ID)) });
  overlayMouth = mountNpcOverlay(bridge, document.body, NPC_ID).mouth;
  runtime.start();
  return bridge;
}
