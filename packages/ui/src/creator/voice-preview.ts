/**
 * The creator's voice preview (R-UI-01, M06a4; closes the M04b2 stub, DL-292). Each of the eight creator `voice` parts maps through
 * `config/creator-voices.json` to a t1 catalog voice. The staging TTS probe renders one fixed sample sentence per part into a clip
 * `audio_bark/creator-voice.<partId>`; the Preview button plays that clip once on the voice bus, after the first gesture, with the pitch
 * slider as `detune` (pitch * 300 cents) and the sample line as the subtitle. A part without a clip keeps the button disabled with its hint.
 * Pure logic over ports: the player is `TtsPlayer.playClip`, the clips come from the pack store, the gesture from FirstGestureUnlock.
 */
import creatorVoices from '../../../../config/creator-voices.json';

export interface CreatorVoices {
  schema: 'creator-voices/1';
  sample: string;
  detuneCentsPerPitch: number;
  voices: Record<string, string>;
}
export const CREATOR_VOICES = creatorVoices as unknown as CreatorVoices;

/** The asset that holds the rendered sample of a creator voice part. */
export const creatorVoiceRef = (partId: string): string => `audio_bark/creator-voice.${partId}`;

/** Pitch slider (-1..1) to the `detune` of the buffer source, in cents. */
export const detuneCents = (pitch: number, perPitch: number = CREATOR_VOICES.detuneCentsPerPitch): number =>
  Math.round(Math.max(-1, Math.min(1, Number.isFinite(pitch) ? pitch : 0)) * perPitch);

export interface VoiceClip {
  bytes: Uint8Array;
  codec: 'mp3' | 'pcm_s16le_16000';
}

export interface VoicePreviewDeps {
  /** Part ids that have a clip in the pack catalog (`audio_bark/creator-voice.<partId>`). */
  hasClip(partId: string): boolean;
  /** Loads a clip, or null when it cannot be read. */
  loadClip(partId: string): Promise<VoiceClip | null>;
  /** `TtsPlayer.playClip`. */
  play(clip: VoiceClip, opts: { detuneCents: number; onEnded: () => void }): Promise<boolean>;
  /** FirstGestureUnlock has run (the audio context exists and runs). */
  unlocked(): boolean;
  /** Shows (text) or clears (null) the subtitle of the sample line. */
  subtitle(text: string | null): void;
  /** Called with true while a sample plays and false when it ends or fails, so the button can show it. */
  playing?(on: boolean): void;
}

export interface VoicePreview {
  /** Whether the Preview button of this part is enabled. */
  available(partId: string): boolean;
  /** Plays the part's sample at the pitch. False when it did not start. */
  press(partId: string, pitch: number): Promise<boolean>;
}

export function createVoicePreview(deps: VoicePreviewDeps): VoicePreview {
  let busy = false;
  return {
    available: (partId) => partId in CREATOR_VOICES.voices && deps.hasClip(partId),
    async press(partId, pitch) {
      if (busy || !(partId in CREATOR_VOICES.voices) || !deps.hasClip(partId) || !deps.unlocked()) return false;
      busy = true;
      let started = false;
      try {
        const clip = await deps.loadClip(partId);
        if (clip === null) return false;
        deps.subtitle(CREATOR_VOICES.sample);
        deps.playing?.(true);
        started = await deps.play(clip, {
          detuneCents: detuneCents(pitch),
          onEnded: () => {
            deps.subtitle(null);
            deps.playing?.(false);
            busy = false;
          },
        });
        if (!started) {
          deps.subtitle(null);
          deps.playing?.(false);
        }
        return started;
      } catch {
        deps.subtitle(null);
        deps.playing?.(false);
        return false;
      } finally {
        // a sample that did not start frees the button at once; a playing one frees it when it ends
        if (!started) busy = false;
      }
    },
  };
}
