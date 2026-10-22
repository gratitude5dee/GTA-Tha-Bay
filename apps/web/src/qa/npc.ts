/**
 * QA builds only (M06a3): `window.__dvBridge.npc` and the small "Talk to npc_test" panel at the top right of the default scene.
 * The runtime is the real one (`@dv/npc`): it posts to route 31 with the P0 play token, streams the answer into the panel, and plays the
 * NPC's ink when the token, the network or the Worker says no. In a Workers Preview or a staging build the Worker answers from recorded
 * streams until the operator turns `ANTHROPIC_MODE=live` on, and the panel says so ("recorded fixture, not a live model").
 *
 * `npc_test` is the only NPC wired here: its compiled ink and soul version come from the repository files (bundled into QA builds only,
 * because this module is reached through a dynamic import behind `VITE_DV_QA === '1'`). The real roster and ink assets arrive with M06a5.
 */
import type { NpcBridge } from '@dv/npc/debug';
import soulsIndex from '../../../../content/npcs/souls.index.json';
import npcTestInk from '../../../../assets/src/data/ink.npc_test/ink.json?raw';
import type { IdentityWiring } from '../identity.ts';

const NPC_ID = 'npc_test';

export async function installNpcQa(identity: IdentityWiring): Promise<NpcBridge> {
  const [{ createNpcRuntime }, { installNpcBridge, mountNpcOverlay }] = await Promise.all([import('@dv/npc/client'), import('@dv/npc/debug')]);
  const version = (soulsIndex as { souls: Record<string, { soulVersion: number }> }).souls[NPC_ID]?.soulVersion ?? 1;
  let bridge: NpcBridge | null = null;
  let override: string | null = null;
  const runtime = createNpcRuntime({
    auth: async () => {
      if (override !== null) return { Authorization: override };
      const service = await identity.ready;
      return service === null ? null : service.authHeader();
    },
    soulVersionOf: (id) => (id === NPC_ID ? version : null),
    loadInk: (id) => (id === NPC_ID ? Promise.resolve(npcTestInk) : Promise.reject(new Error(`no ink bundled for ${id}`))),
    onResponse: (res) => bridge?.noteResponse(res),
  });
  bridge = installNpcBridge(runtime, { setAuthHeader: (h) => (override = h) });
  mountNpcOverlay(bridge, document.body, NPC_ID);
  runtime.start();
  return bridge;
}
