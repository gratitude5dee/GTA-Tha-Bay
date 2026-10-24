import { NPC_GUARDRAILS, type GovLevel } from '@dv/shared';
import { assetTier, type AudioChunk, type CompiledSoul, type VoiceCatalog, type VoiceCatalogEntry, type VoiceTier } from '@dv/shared/contracts/c10-npc';
import { effectiveTier, pickVoice, splitSentences, ttsMicros, VOICE_CATALOG, type IdentityTier, type VoiceSetting } from '@dv/shared/npc';
import type { QuotaRpc } from '../budget/quota.ts';
import type { Env } from '../env.ts';
import { ttsElevenlabsHeldOff } from '../flags/ks.ts';
import { toBase64 } from './ai.ts';
import { speakElevenLabs } from './tts-elevenlabs.ts';
import { speakWorkersAi, type SpokenSentence } from './tts-workers-ai.ts';

/**
 * TtsRouter (04-npc.md section 5.7, M06a4). `planVoice` decides the effective tier of a turn before the stream starts (it goes into `meta.voice`);
 * `TtsSession.speak` voices the validated line sentence by sentence after the text and before `line.done`.
 *
 * In v1 the tier is `t1` (Workers AI Aura through the `AI` binding) or `text`. t2 and t3 are ElevenLabs tiers and are implemented behind
 * `ks:tts:elevenlabs`, which is on by default (Q-20): they need the switch released by staff, `ELEVENLABS_API_KEY`, a linked identity and a
 * catalog entry, none of which exist in v1. A tier that cannot be served falls back to t1, never to silence by accident; any engine failure
 * ends the audio of the line and the text stands alone.
 */
let catalogOverride: VoiceCatalog | null = null;
let fetchOverride: typeof fetch | null = null;

/** Test seam: another catalog (null restores `config/voice-catalog.json`). */
export function setCatalogForTests(c: VoiceCatalog | null): void {
  catalogOverride = c;
}
/** Test seam: the `fetch` the ElevenLabs engine uses. */
export function setTtsFetchForTests(f: typeof fetch | null): void {
  fetchOverride = f;
}
const catalog = (): VoiceCatalog => catalogOverride ?? VOICE_CATALOG;

export interface VoicePlan {
  tier: VoiceTier;
  entry: VoiceCatalogEntry | null;
}
const TEXT_ONLY: VoicePlan = { tier: 'text', entry: null };

export interface PlanInput {
  env: Pick<Env, 'FLAGS' | 'ELEVENLABS_API_KEY'>;
  npcId: string;
  soul: Pick<CompiledSoul, 'voice' | 'roles' | 'tier' | 'basis'>;
  setting: VoiceSetting;
  identity: IdentityTier;
  gov: GovLevel;
  /** Kill switches in force among `ks:tts:all` (the others are read here). */
  ks: ReadonlySet<string>;
  /** The roster kill scope `voice` (or `all`) is in force for this NPC. */
  voiceKilled: boolean;
  quota: Pick<QuotaRpc, 'usage'>;
}

export async function planVoice(i: PlanInput): Promise<VoicePlan> {
  const soulTier = i.soul.voice.tier;
  if (soulTier === 'text' || i.setting === 'off') return TEXT_ONLY;
  const limits = i.identity === 'linked' ? NPC_GUARDRAILS.quotas.linked : NPC_GUARDRAILS.quotas.p0;
  let used = 0;
  try {
    used = (await i.quota.usage())['voice_line'] ?? 0;
  } catch {
    used = 0; // the reservation at speaking time is the real gate
  }
  const heldOff = await ttsElevenlabsHeldOff(i.env);
  const keyed = i.env.ELEVENLABS_API_KEY !== undefined && i.env.ELEVENLABS_API_KEY !== '';
  let tier = effectiveTier({
    soulTier,
    hero: i.soul.roles.hero,
    setting: i.setting,
    identity: i.identity,
    govLevel: i.gov,
    ksElevenlabs: heldOff || !keyed,
    ksTtsAll: i.ks.has('ks:tts:all'),
    ksVoice: i.voiceKilled,
    voiceQuotaLeft: used < limits.voiceLines,
    // t3 needs an unexpired voice_clone consent record in config/consent-index.json, which holds no entry in v1 and is not readable from the Worker
    // before M10c supplies it (BD-M06a4-06).
    cloneConsent: false,
  });
  if (tier === 'text') return TEXT_ONLY;
  const pick = (t: VoiceTier): VoiceCatalogEntry | null =>
    pickVoice(catalog(), { npcId: i.npcId, tier: t, voiceRef: i.soul.voice.voiceRef, likeness: assetTier(i.soul) });
  let entry = pick(tier);
  if (entry === null && tier !== 't1') {
    tier = 't1';
    entry = pick('t1');
  }
  return entry === null ? TEXT_ONLY : { tier, entry };
}

/** Raw bytes per `line.delta {audio}` chunk (16 KB of base64). */
export const CHUNK_BYTES = 12_288;
/** A sentence shorter than this is joined to its neighbour (04-npc.md section 5.1 step 6). */
export const MIN_SENTENCE_CHARS = 12;

/** The sentences to voice: `splitSentences`, with sentences under 12 characters joined to the next (the last joins the one before). */
export function speakableSentences(line: string): string[] {
  const out: string[] = [];
  let carry = '';
  for (const s of splitSentences(line)) {
    const joined = carry === '' ? s : `${carry} ${s}`;
    if (joined.length < MIN_SENTENCE_CHARS) carry = joined;
    else {
      out.push(joined);
      carry = '';
    }
  }
  if (carry !== '') {
    if (out.length > 0) out[out.length - 1] = `${out[out.length - 1] as string} ${carry}`;
    else out.push(carry);
  }
  return out;
}

export interface SpeakResult {
  /** Characters actually voiced. */
  chars: number;
  /** USD micros charged for them. */
  micros: number;
  sentences: number;
  failed: boolean;
}

/** One voiced line: a single `voice_line` reservation, the sentences synthesized in parallel and emitted in order. */
export class TtsSession {
  private result: SpeakResult = { chars: 0, micros: 0, sentences: 0, failed: false };
  private reservation: string | null = null;
  private reservedTried = false;

  constructor(
    private readonly env: Pick<Env, 'AI' | 'ELEVENLABS_API_KEY'>,
    private readonly plan: VoicePlan,
    private readonly quota: Pick<QuotaRpc, 'reserve' | 'settle'>,
    private readonly npcId: string,
    private readonly now: () => number = Date.now,
  ) {}

  private synth(text: string): Promise<SpokenSentence | null> {
    const entry = this.plan.entry as VoiceCatalogEntry;
    return entry.engine === 'elevenlabs' ? speakElevenLabs(this.env, entry, text, fetchOverride ?? fetch, this.now) : speakWorkersAi(this.env, entry, text, this.now);
  }

  /** Reserves one `voice_line`. False when the quota or the cost cap refuses: the line stays text. */
  private async reserve(line: string): Promise<boolean> {
    if (this.reservedTried) return this.reservation !== null;
    this.reservedTried = true;
    const entry = this.plan.entry as VoiceCatalogEntry;
    const est = Math.max(NPC_GUARDRAILS.estimates.voiceLineUsdMicros, ttsMicros(entry.model, line.length));
    try {
      const r = await this.quota.reserve({ kind: 'voice_line', npcId: this.npcId, estMicros: est });
      if (r.ok) this.reservation = r.reservationId;
    } catch {
      this.reservation = null;
    }
    return this.reservation !== null;
  }

  /** Audio chunks of the validated line, sentence after sentence. Yields nothing when the plan is text, the quota refuses or the engine fails. */
  async *speak(line: string): AsyncGenerator<AudioChunk> {
    if (this.plan.entry === null || this.plan.tier === 'text') return;
    const sentences = speakableSentences(line);
    if (sentences.length === 0) return;
    if (!(await this.reserve(line))) return;
    const entry = this.plan.entry;
    const jobs = sentences.map((s) => this.synth(s));
    for (let i = 0; i < sentences.length; i++) {
      const spoken = await jobs[i];
      if (spoken === null || spoken === undefined) {
        this.result.failed = true;
        // later sentences are not played after a gap; their results are dropped
        for (const j of jobs.slice(i + 1)) void j.catch(() => undefined);
        return;
      }
      const text = sentences[i] as string;
      this.result.chars += text.length;
      this.result.micros += ttsMicros(entry.model, text.length);
      this.result.sentences++;
      const total = Math.max(1, Math.ceil(spoken.bytes.length / CHUNK_BYTES));
      for (let c = 0; c < total; c++) {
        const part = spoken.bytes.subarray(c * CHUNK_BYTES, (c + 1) * CHUNK_BYTES);
        const last = c === total - 1;
        yield {
          sentence: i,
          codec: spoken.codec,
          b64: toBase64(part),
          last,
          ...(last && spoken.alignment !== undefined ? { alignment: spoken.alignment } : {}),
        };
      }
    }
  }

  /** Settles the reservation with what was voiced (0 when nothing was). Safe to call without a reservation, and twice. */
  async finish(): Promise<SpeakResult> {
    const id = this.reservation;
    this.reservation = null;
    if (id !== null) {
      const entry = this.plan.entry as VoiceCatalogEntry;
      try {
        await this.quota.settle(id, this.result.micros, { vendor: entry.engine === 'elevenlabs' ? 'elevenlabs' : 'workers_ai', model: entry.model });
      } catch {
        // the answer never waits on the spend ledger
      }
    }
    return this.result;
  }
}
