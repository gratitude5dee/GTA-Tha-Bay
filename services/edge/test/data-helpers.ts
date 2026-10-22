import type { CutsceneIndex } from '@dv/shared/contracts/c09-cutscene';
import type { ServerDataPort } from '@dv/shared/data-port';
import { sha256Hex } from '@dv/shared';

/** A key per label, shaped like a cutscene cache key. */
export const indexKey = (label: string): string => sha256Hex(`catalog-sync-test:${label}`);

/** A shipped index with one entry per label (M05d tests). The fields the sync reads are real; the rest is minimal. */
export function indexOf(labels: string[]): CutsceneIndex {
  return {
    schema: 'cutscene-index/1',
    release: 'test',
    builtAt: 1_790_000_000_000,
    entries: labels.map((label) => ({
      ref: `cut.story.m.test.${label}.beat` as `cut.${string}`,
      key: indexKey(label),
      keyInput: {
        template: 'story.beat@1',
        characters: [{ id: 'npc_test', soulVersion: 1, likenessTier: 'original' }],
        move: null,
        stage: null,
        style: 'bay-cel@1',
        endpoint: 'minimax/h3/image-to-video@unpinned',
        seed: 1,
        inputHashes: [],
      },
      provider: 'h3.partner',
      characters: [{ id: 'npc_test', soulVersion: 1, tier: 'original' }],
      durationMs: 8000,
      fallback: 'm.test.beat',
      cues: [],
      audio: 'engine',
    })),
  };
}

/** A DataPort whose every call rejects: the database is down. */
export function downPort(): ServerDataPort {
  const failing = new Proxy(
    {},
    { get: () => () => Promise.reject(new Error('database unavailable')) },
  );
  return new Proxy({}, { get: () => failing }) as unknown as ServerDataPort;
}
