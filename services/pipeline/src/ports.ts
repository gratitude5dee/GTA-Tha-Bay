/**
 * Ports of the generation pipeline (spec/domains/05-assets.md section 3). Every stage talks to the outside only through
 * these interfaces, so the same steps run against fal, the mock, Miniflare and the in-process shim.
 * Port methods return plain data (no Response, no stream) so step results stay JSON and under 1 MiB (F-024).
 */
import type { GovLevel, LikenessTier, SpendEvent, Vendor } from '@dv/shared';

export type Bucket = 'MEDIA' | 'PRIVATE';

export interface FalSubmission {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
  cancelUrl: string;
}

export interface FalStatus {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED';
  errorType?: string;
  error?: string;
}

export interface FalResult {
  /** URL of the primary video output; the file itself is copied by `fetchFile`. */
  videoUrl: string;
  contentType: string;
}

export interface FalSubmitOptions {
  /** `?fal_webhook=` target: <api host>/api/v1/hooks/fal?wf=<instanceId>. */
  webhookUrl: string;
  jobKey: string;
}

export interface FalPort {
  submit(endpointId: string, input: Record<string, unknown>, opts: FalSubmitOptions): Promise<FalSubmission>;
  status(sub: FalSubmission): Promise<FalStatus>;
  result(sub: FalSubmission): Promise<FalResult>;
  cancel(sub: FalSubmission): Promise<void>;
  /** Copies the bytes of an output URL (CDN copies expire, so this runs at once). */
  fetchFile(url: string): Promise<Uint8Array>;
  /** One keyframe image for a shot (a fal image-edit call in live mode; not a video submit and not counted as one). */
  keyframe(job: { jobKey: string; shotId: string; prompt: string }): Promise<{ sha256: string }>;
}

export interface BlobHead {
  size: number;
}

export interface BlobPort {
  head(bucket: Bucket, key: string): Promise<BlobHead | null>;
  get(bucket: Bucket, key: string): Promise<Uint8Array | null>;
  put(bucket: Bucket, key: string, body: Uint8Array, meta?: { contentType?: string; custom?: Record<string, string> }): Promise<void>;
}

export interface RosterEntry {
  id: string;
  tier: LikenessTier;
  soulVersion: number;
  /** Kill scopes in force for this character (C12 KillScope names). */
  killed: readonly string[];
  minor?: boolean;
}

export interface RosterPort {
  lookup(id: string): Promise<RosterEntry | null>;
}

export interface BudgetPort {
  reserve(vendor: Vendor, estMicros: number, jobId: string): Promise<{ ok: boolean; level: GovLevel }>;
  settle(jobId: string, actualMicros: number, requestId?: string): Promise<void>;
  level(): Promise<GovLevel>;
}

/** Kill switches (`ks:*` names that are on). KV-backed in the Worker. */
export interface FlagsPort {
  killSwitches(): Promise<ReadonlySet<string>>;
}

export interface ClockPort {
  now(): number;
}

export interface TranscodedFile {
  /** Name relative to cutscenes/<key>/. */
  file: string;
  bytes: Uint8Array;
  contentType: string;
  /** Present for video renditions. */
  codecs?: string;
  kbps?: number;
}

export interface TranscodeResult {
  recipe: 'cut@1';
  files: TranscodedFile[];
  width: number;
  height: number;
  frames: number;
  /** Rendition key to name in `files`, e.g. v768. */
  renditions: Record<string, string>;
  speechDetected: boolean;
  /** C2PA state of the unmodified original (valid-untrusted is expected for fal output, F-043). */
  origC2pa: 'valid' | 'valid-untrusted' | 'absent' | 'invalid';
}

export interface TranscodePort {
  /** Probe + ladder of recipe cut@1 over the unmodified original. */
  transcode(orig: Uint8Array): Promise<TranscodeResult>;
  /** Live adapters only: null when the container answers, else the reason it cannot run. Checked before any money moves (M05c3). */
  ready?(): Promise<string | null>;
}

export interface SignedFile {
  bytes: Uint8Array;
  /** C2PA state of the written file. */
  c2pa: 'valid' | 'valid-untrusted' | 'absent' | 'invalid';
  resigned: true;
}

export interface SignPort {
  /** Re-sign one rendition with our claim (`trainedAlgorithmicMedia`), `orig` as the ingredient. */
  resign(rendition: { file: string; bytes: Uint8Array; contentType: string }, orig: Uint8Array): Promise<SignedFile>;
  /** Live adapters only: null when the signer is configured, else the reason it cannot sign. Checked before any money moves (M05c3). */
  ready?(): Promise<string | null>;
}

export interface FalGatePort {
  acquire(jobId: string, ttlMs: number): Promise<boolean>;
  release(jobId: string): Promise<void>;
}

/** The single-flight object notified when the job ends (`CutsceneJobDO.complete` / `fail`). */
export interface JobSinkPort {
  complete(r: { manifestKey: string; costUsdMicros: number }): Promise<void>;
  fail(err: string): Promise<void>;
}

/**
 * Real-side names for the prompt lint (M05b2, DL-550, DL-240): the PRIVATE R2 object `config/names-real.json`, which the
 * operator uploads. The strings are never logged and never returned; `null` means the object is absent (the gate then applies
 * the public denylist only and logs a SKIP line).
 */
export interface NamePort {
  realNames(): Promise<readonly string[] | null>;
}

export const NAMES_REAL_KEY = 'config/names-real.json';

/** NamePort over the PRIVATE bucket: `{schema: 'names/1', entries: [{id, real?, aliases?}]}`. Unreadable content counts as absent. */
export function blobNamePort(blob: Pick<BlobPort, 'get'>): NamePort {
  return {
    async realNames() {
      const bytes = await blob.get('PRIVATE', NAMES_REAL_KEY);
      if (bytes === null) return null;
      try {
        const doc = JSON.parse(new TextDecoder().decode(bytes)) as { entries?: { real?: unknown; aliases?: unknown }[] };
        const out: string[] = [];
        for (const e of doc.entries ?? []) {
          if (typeof e.real === 'string') out.push(e.real);
          if (Array.isArray(e.aliases)) for (const a of e.aliases) if (typeof a === 'string') out.push(a);
        }
        return out;
      } catch {
        return null;
      }
    },
  };
}

export interface GenPorts {
  fal: FalPort;
  blob: BlobPort;
  roster: RosterPort;
  budget: BudgetPort;
  flags: FlagsPort;
  clock: ClockPort;
  transcode: TranscodePort;
  sign: SignPort;
  falGate: FalGatePort;
  sink: JobSinkPort;
  /** Optional: absent behaves like an absent object (public denylist only). */
  names?: NamePort;
}

export type { SpendEvent };
