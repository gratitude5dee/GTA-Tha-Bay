/**
 * Effective voice tier of one dialogue turn (04-npc.md section 5.7, M06a4). Pure: the Worker reads the switches, the quota and the
 * identity, then asks this function. The result is the minimum over every cap below; tiers order text < t1 < t2 < t3.
 *
 *  - soul tier: the soul's own `voice.tier`.
 *  - player setting: `all` keeps the soul tier, `heroes` gives `text` unless the NPC is a hero, `off` gives `text`.
 *  - governor: level 2 or higher and `ks:tts:elevenlabs` cap the tier at t1; `ks:tts:all` gives `text`.
 *  - roster kill scope `voice` gives `text`; an exhausted `voice_line` quota gives `text`.
 *  - t2 and t3 are ElevenLabs tiers: they need a linked (18+) identity, otherwise the cap is t1.
 *  - t3 additionally needs `consented` with `voice_clone` and an unexpired consent record, otherwise the cap is t1 (the clone voice is
 *    never used without it; the default t1 voice speaks instead).
 */
import type { VoiceTier } from '../contracts/c10-npc.ts';

export type VoiceSetting = 'all' | 'heroes' | 'off';
export type IdentityTier = 'p0' | 'linked';

export interface VoiceTierInput {
  /** The soul's `voice.tier`. */
  soulTier: VoiceTier;
  /** `roles.hero` of the soul. */
  hero: boolean;
  /** `ProfileSettings.npc.voice`, as far as the server learns it (route 31 derives `off` or `all` from `context.voice`). */
  setting: VoiceSetting;
  identity: IdentityTier;
  /** Governor level 0..3 (`gov:level`). */
  govLevel: 0 | 1 | 2 | 3;
  /** `ks:tts:elevenlabs` is in force. Its default is on: t2 stays off until staff turn the switch off (Q-20). */
  ksElevenlabs: boolean;
  /** `ks:tts:all` is in force. */
  ksTtsAll: boolean;
  /** The roster kill scope `voice` is in force for this NPC. */
  ksVoice: boolean;
  /** The player still has a `voice_line` in today's quota. */
  voiceQuotaLeft: boolean;
  /** t3 only: the soul is `consented` with `voice_clone` and the consent record is unexpired. */
  cloneConsent: boolean;
}

const ORDER: Record<VoiceTier, number> = { text: 0, t1: 1, t2: 2, t3: 3 };
const BY_ORDER: readonly VoiceTier[] = ['text', 't1', 't2', 't3'];

export const minTier = (a: VoiceTier, b: VoiceTier): VoiceTier => (ORDER[a] <= ORDER[b] ? a : b);

export function effectiveTier(i: VoiceTierInput): VoiceTier {
  let tier: VoiceTier = i.soulTier;
  if (i.setting === 'off' || (i.setting === 'heroes' && !i.hero)) return 'text';
  if (i.ksTtsAll || i.ksVoice || !i.voiceQuotaLeft) return 'text';
  if (i.govLevel >= 2 || i.ksElevenlabs) tier = minTier(tier, 't1');
  if (i.identity !== 'linked') tier = minTier(tier, 't1');
  if (tier === 't3' && !i.cloneConsent) tier = 't1';
  return BY_ORDER[ORDER[tier]] as VoiceTier;
}
