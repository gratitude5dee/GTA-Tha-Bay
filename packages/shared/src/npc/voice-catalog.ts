/**
 * The voice catalog (`config/voice-catalog.json`, C10 `VoiceCatalog`) and the choice of one voice for a turn (04-npc.md section 5.7, M06a4).
 * Pure. The Worker may not import `config/` directly (only `@dv/shared`), so the JSON is read here.
 */
import catalogJson from '../../../../config/voice-catalog.json' with { type: 'json' };
import type { AssetRef, LikenessTier } from '../assets/c07.ts';
import type { VoiceCatalog, VoiceCatalogEntry, VoiceTier } from '../contracts/c10-npc.ts';
import { sha256Hex } from '../hash.ts';

export const VOICE_CATALOG: VoiceCatalog = catalogJson as unknown as VoiceCatalog;

/**
 * USD micros per character of input text. Workers AI Aura-1 is $0.015 and Aura-2 $0.030 per 1,000 characters [F-025]; ElevenLabs Flash is
 * $0.0044 per 110-character line [F-051], 40 micros per character. A model that is not listed is charged at the dearest rate.
 */
export const TTS_MICROS_PER_CHAR: Readonly<Record<string, number>> = {
  '@cf/deepgram/aura-1': 15,
  '@cf/deepgram/aura-2-en': 30,
  eleven_flash_v2_5: 40,
};
export const TTS_MICROS_PER_CHAR_MAX = 40;

export const ttsMicros = (model: string, chars: number): number => Math.ceil(chars * (TTS_MICROS_PER_CHAR[model] ?? TTS_MICROS_PER_CHAR_MAX));

const ENGINE_OF_TIER: Record<VoiceTier, VoiceCatalogEntry['engine'] | null> = { text: null, t1: 'workers_ai', t2: 'elevenlabs', t3: 'elevenlabs' };

/**
 * The catalog entry that voices `npcId` at `tier`: the soul's own `voiceRef` when it names an entry of that tier that its likeness tier may use,
 * else a default of the tier chosen by a stable hash of the id, so the same NPC always gets the same voice. Null for `text`, and for a tier the
 * catalog has no entry for (t2 and t3 have none until the voices are designed or cleared).
 */
export function pickVoice(catalog: VoiceCatalog, input: { npcId: string; tier: VoiceTier; voiceRef: AssetRef | null; likeness: LikenessTier }): VoiceCatalogEntry | null {
  const engine = ENGINE_OF_TIER[input.tier];
  if (engine === null) return null;
  // An original character (no real person behind it) may use any voice; the other tiers use the entries that list their tier.
  const usable = catalog.entries.filter((e) => e.tier === input.tier && e.engine === engine && (input.likeness === 'original' || e.allowedTiers.includes(input.likeness)));
  if (usable.length === 0) return null;
  if (input.voiceRef !== null) {
    const own = usable.find((e) => e.voiceRef === input.voiceRef);
    if (own !== undefined) return own;
  }
  // Defaults are the entries without consent records (a licensed or cloned voice is chosen only by an explicit voiceRef).
  // Only the model of the first default in file order is used: Aura-1 entries come first, and the Aura-2 entries behind them are the fallback
  // that becomes the default by moving them up (the staging probe decides, U-NPC-05).
  const synthetic = usable.filter((e) => e.mode === 'synthetic' || e.mode === 'designed');
  const defaults = synthetic.filter((e) => e.model === synthetic[0]?.model);
  if (defaults.length === 0) return null;
  const h = parseInt(sha256Hex(input.npcId).slice(0, 8), 16);
  return defaults[h % defaults.length] ?? null;
}
