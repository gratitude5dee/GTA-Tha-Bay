import type { SandboxSlice } from '@dv/shared';
import { SaveServiceImpl } from '../service.ts';

/**
 * Worker half of the QA page `/qa/save-kill.html` (QA builds only; the production dist has no such page or string).
 * Phase `loop` writes the `sandbox` slot of the profile "kill-test" again and again until the page is closed;
 * phase `verify` loads the profile after the kill and reports the generation, checksum and size it found.
 */
export const KILL_PROFILE = 'kill-test';

export interface SaveKillEnv {
  post(name: string, data: unknown): void;
  sleep(ms: number): Promise<void>;
}

export interface SaveLoopReport {
  n: number;
  gen: number;
  checksum: string;
  bytes: number;
}

export interface SaveVerifyReport {
  profileId: string;
  persistent: boolean;
  /** The loop counter stored in the loaded slot, or null when nothing loaded. */
  n: number | null;
  gen: number | null;
  checksum: string | null;
  bytes: number | null;
  fellBack: boolean;
  lastSaveError: string | null;
}

function slice(n: number): SandboxSlice {
  // About 6 KiB of changing data, so a write takes long enough to be interrupted mid-transaction now and then.
  const pad = Array.from({ length: 64 }, (_v, i) => `${n.toString(36)}-${i}-${'q'.repeat(80)}`);
  return {
    toggles: { n },
    savedPositions: pad.slice(0, 32).map((name, i) => ({ name: name.slice(0, 80), x: i, y: n, z: -i, yaw: 0 })),
    clock: { hour: 9, paused: false, syncSystemTime: false },
    weather: 'clear',
    presets: pad.slice(32).map((s) => ({ s })),
  };
}

async function openProfile(env: SaveKillEnv): Promise<{ svc: SaveServiceImpl; id: string } | null> {
  const svc = await SaveServiceImpl.open({ capability: 'sandbox', buildId: 'qa' });
  if (!svc.persistent) {
    env.post('save-error', { message: 'IndexedDB is unavailable: the memory store cannot be killed and reloaded' });
    return null;
  }
  let meta = (await svc.listProfiles()).find((p) => p.name === KILL_PROFILE);
  if (!meta) {
    const made = await svc.createProfile(KILL_PROFILE);
    if (!('id' in made)) {
      env.post('save-error', { message: `createProfile: ${JSON.stringify(made)}` });
      return null;
    }
    meta = made;
  }
  return { svc, id: meta.id };
}

export async function runSaveKill(phase: 'loop' | 'verify', env: SaveKillEnv): Promise<void> {
  const opened = await openProfile(env);
  if (!opened) return;
  const { svc, id } = opened;
  const game = await svc.load(id as never);
  const stored = (game.sandbox as SandboxSlice | null)?.toggles['n'];
  if (phase === 'verify') {
    const info = await svc.describeSlot(id as never, 'sandbox');
    const report: SaveVerifyReport = {
      profileId: id,
      persistent: svc.persistent,
      n: typeof stored === 'number' ? stored : null,
      gen: info?.gen ?? null,
      checksum: info?.checksum ?? null,
      bytes: info?.bytes ?? null,
      fellBack: info?.fellBack ?? false,
      lastSaveError: game.profile.lastSave?.error ?? null,
    };
    env.post('save-verify', report);
    return;
  }
  env.post('save-ready', { profileId: id, resumeFrom: typeof stored === 'number' ? stored : 0 });
  for (let n = (typeof stored === 'number' ? stored : 0) + 1; ; n++) {
    const r = await svc.write('sandbox', slice(n), 'manual');
    if (!r.ok) {
      env.post('save-error', { message: `write ${n}: ${r.error}` });
      return;
    }
    const info = await svc.describeSlot(id as never, 'sandbox');
    const report: SaveLoopReport = { n, gen: r.gen, checksum: info?.checksum ?? '', bytes: r.bytes };
    env.post('save-loop', report);
    await env.sleep(1);
  }
}
