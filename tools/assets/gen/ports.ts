/**
 * Ports of the character executor (M10a1) bound to files and to the fal queue. `prewarm` shares `ledger.ts` and this file; neither adds
 * a path that reaches fal on its own: `QueueFalPort` is built only by `run --live` after the guards in `run.ts`.
 *
 *   BlobPort    work files under `.genai/` (a directory standing in for `PRIVATE work/`), or memory in tests
 *   FalPort     the fal queue through M00c's `lib/fal-queue.ts` (polling; the CLI has no public webhook), or `MockFalPort`
 *   BudgetPort  the spend ledger file: reserve checks the line and the program cap, settle appends a row
 *   RosterPort  `content/npcs/roster.json` plus the kill flags
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { GovLevel, Vendor } from '../../../packages/shared/src/api/budget.ts';
import type { BlobHead, BlobPort, BudgetPort, Bucket, ClockPort, FalStatus, FalSubmission, RosterEntry, RosterPort } from '../../../services/pipeline/src/ports.ts';
import { runQueued, type FetchFn, type QueueRun } from '../lib/fal-queue.ts';
import { findOutputs, type CharacterFalPort, type RawOutput } from '../../../services/pipeline/src/steps/character.ts';
import { DEFAULT_CAPS, appendRow, capRefusal, isoNow, readLedger, totals, type LedgerLine, type LineCaps } from './ledger.ts';

// -- blob -----------------------------------------------------------------------------------------------------------------------

export function memoryBlob(): BlobPort & { keys(prefix?: string): string[] } {
  const store = new Map<string, { bytes: Uint8Array }>();
  const k = (b: Bucket, key: string): string => `${b}:${key}`;
  return {
    keys: (prefix = '') => [...store.keys()].filter((s) => s.startsWith(`PRIVATE:${prefix}`) || s.startsWith(`MEDIA:${prefix}`)),
    head: (b, key) => Promise.resolve(store.has(k(b, key)) ? { size: (store.get(k(b, key)) as { bytes: Uint8Array }).bytes.length } : null),
    get: (b, key) => Promise.resolve(store.get(k(b, key))?.bytes.slice() ?? null),
    put: (b, key, body) => Promise.resolve(void store.set(k(b, key), { bytes: body.slice() })),
    putStream: async (b, key, body) => {
      const chunks: Uint8Array[] = [];
      const reader = body.getReader();
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        chunks.push(r.value);
      }
      store.set(k(b, key), { bytes: Buffer.concat(chunks) });
    },
    copy: (from, to) => {
      const v = store.get(k(from.bucket, from.key));
      if (v === undefined) return Promise.resolve(null);
      store.set(k(to.bucket, to.key), { bytes: v.bytes.slice() });
      return Promise.resolve(v.bytes.length);
    },
  };
}

/** Work files in a directory: `PRIVATE:<key>` is `<root>/<key>`, `MEDIA` is `<root>/_media/<key>` (the CLI never writes it). */
export function fsBlob(root: string): BlobPort {
  const file = (b: Bucket, key: string): string => {
    if (key.split('/').includes('..') || path.isAbsolute(key)) throw new Error(`blob key ${key} leaves the work directory`);
    return b === 'PRIVATE' ? path.join(root, key) : path.join(root, '_media', key);
  };
  return {
    head: (b, key): Promise<BlobHead | null> => {
      const f = file(b, key);
      return Promise.resolve(existsSync(f) && statSync(f).isFile() ? { size: statSync(f).size } : null);
    },
    get: (b, key) => {
      const f = file(b, key);
      return Promise.resolve(existsSync(f) && statSync(f).isFile() ? new Uint8Array(readFileSync(f)) : null);
    },
    put: (b, key, body) => {
      const f = file(b, key);
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(f, body);
      return Promise.resolve();
    },
    putStream: async (b, key, body) => {
      const f = file(b, key);
      mkdirSync(path.dirname(f), { recursive: true });
      const chunks: Uint8Array[] = [];
      const reader = body.getReader();
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        chunks.push(r.value);
      }
      writeFileSync(f, Buffer.concat(chunks));
    },
    copy: (from, to) => {
      const src = file(from.bucket, from.key);
      if (!existsSync(src)) return Promise.resolve(null);
      const bytes = readFileSync(src);
      const dst = file(to.bucket, to.key);
      mkdirSync(path.dirname(dst), { recursive: true });
      writeFileSync(dst, bytes);
      return Promise.resolve(bytes.length);
    },
  };
}

export function listFiles(root: string, rel: string): string[] {
  const dir = path.join(root, rel);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort();
}

export function removeTree(root: string, rel: string): void {
  rmSync(path.join(root, rel), { recursive: true, force: true });
}

// -- fal ------------------------------------------------------------------------------------------------------------------------

/**
 * fal through the queue client of the spike (submit, poll, fetch the result). `submit` runs the whole call because the CLI polls rather
 * than waits for a webhook; `status` and `outputs` answer from what it read. The CDN files are fetched with no Authorization header.
 */
export class QueueFalPort implements CharacterFalPort {
  private readonly runs = new Map<string, QueueRun>();

  constructor(private readonly o: { key: string; fetch: FetchFn; sleep: (ms: number) => Promise<void>; now: () => number; lifecycleHeader: string; pollMs?: number; timeoutMs?: number }) {}

  async submit(endpointId: string, input: Record<string, unknown>, opts: { jobKey: string }): Promise<FalSubmission> {
    const run = await runQueued(
      { key: this.o.key, fetch: this.o.fetch, sleep: this.o.sleep, now: this.o.now, lifecycleHeader: this.o.lifecycleHeader, pollMs: this.o.pollMs ?? 3000, timeoutMs: this.o.timeoutMs ?? 20 * 60_000 },
      endpointId,
      input,
    );
    const requestId = run.requestId ?? `failed-${opts.jobKey.slice(0, 16)}`;
    this.runs.set(requestId, run);
    return { requestId, statusUrl: '', responseUrl: '', cancelUrl: '' };
  }

  status(sub: FalSubmission): Promise<FalStatus> {
    const run = this.runs.get(sub.requestId);
    if (run === undefined) return Promise.reject(new Error(`no run for ${sub.requestId}`));
    if (run.errorType !== null || !run.retrievable) {
      const http = run.httpStatus === 0 ? '' : `HTTP ${run.httpStatus} `;
      return Promise.resolve({ status: 'COMPLETED', errorType: run.errorType ?? `http_${run.httpStatus}`, error: `${http}${run.error ?? ''}`.trim() });
    }
    return Promise.resolve({ status: 'COMPLETED' });
  }

  outputs(sub: FalSubmission): Promise<RawOutput[]> {
    const run = this.runs.get(sub.requestId);
    if (run === undefined) return Promise.reject(new Error(`no run for ${sub.requestId}`));
    return Promise.resolve(findOutputs(run.result));
  }

  async fetchFile(url: string): Promise<Uint8Array> {
    const res = await this.o.fetch(url);
    if (!res.ok) throw new Error(`download of an output answered HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  result(): Promise<never> {
    return Promise.reject(new Error('QueueFalPort has no video result'));
  }
  cancel(): Promise<void> {
    return Promise.resolve();
  }
  fetchStream(): Promise<never> {
    return Promise.reject(new Error('QueueFalPort does not stream'));
  }
  keyframe(): Promise<never> {
    return Promise.reject(new Error('QueueFalPort has no keyframe call'));
  }
}

// -- budget ---------------------------------------------------------------------------------------------------------------------

/** BudgetPort over the ledger file for one line. `reserve` holds an estimate until `settle` replaces it with a row. */
export class LedgerBudget implements BudgetPort {
  private readonly held = new Map<string, number>();
  private readonly tags = new Map<string, { slug: string; stage: string }>();

  constructor(private readonly o: { file: string; line: LedgerLine; clock: ClockPort; caps?: LineCaps }) {}

  tag(jobId: string, slug: string, stage: string): void {
    this.tags.set(jobId, { slug, stage });
  }

  private totalsNow(): ReturnType<typeof totals> {
    const t = totals(readLedger(this.o.file));
    const inflight = [...this.held.values()].reduce((a, b) => a + b, 0);
    return { ...t, [this.o.line]: t[this.o.line] + inflight, total: t.total + inflight };
  }

  reserve(_vendor: Vendor, estMicros: number, jobId: string): Promise<{ ok: boolean; level: GovLevel }> {
    const refusal = capRefusal(this.totalsNow(), this.o.line, estMicros, this.o.caps ?? DEFAULT_CAPS);
    if (refusal !== null) return Promise.resolve({ ok: false, level: 3 });
    this.held.set(jobId, estMicros);
    return Promise.resolve({ ok: true, level: 0 });
  }

  settle(jobId: string, actualMicros: number, requestId?: string): Promise<void> {
    this.held.delete(jobId);
    const tag = this.tags.get(jobId);
    if (actualMicros > 0) {
      appendRow(this.o.file, {
        schema: 'fal-spend/1', kind: 'settle', at: isoNow(this.o.clock.now()), line: this.o.line, usdMicros: actualMicros, ref: jobId,
        ...(tag !== undefined ? { slug: tag.slug, stage: tag.stage } : {}), ...(requestId !== undefined ? { requestId } : {}),
      });
    }
    return Promise.resolve();
  }

  level(): Promise<GovLevel> {
    const t = this.totalsNow();
    return Promise.resolve((t.total >= (this.o.caps ?? DEFAULT_CAPS).program ? 3 : 0) as GovLevel);
  }
}

// -- roster ---------------------------------------------------------------------------------------------------------------------

/** RosterPort over prepared entries (the subjects the plan loaded plus the kill flags). */
export function mapRoster(entries: ReadonlyMap<string, RosterEntry>): RosterPort {
  return { lookup: (id) => Promise.resolve(entries.get(id) ?? null) };
}
