import { fnv32 } from '@dv/shared';
import { scrub, type Telemetry } from './client.ts';

/**
 * Error capture (11-platform-pwa.md section 9): `window.onerror` becomes `err.js`, `unhandledrejection` becomes `err.promise`,
 * GPU errors become `err.gpu`. Every error is fingerprinted (message + top frame hash) and at most 5 events per fingerprint
 * go out per session. The message is scrubbed (query strings, emails, bearer tokens, long hex and base64 runs) and cut to 128
 * characters. File names keep the path only.
 */
export const MAX_PER_FINGERPRINT = 5;
const MSG_CHARS = 128;

export interface ErrorCounts {
  js: number;
  promise: number;
  gpuLost: number;
  uncaptured: number;
  gpuInit: number;
}

/** `file:line:col` of the first stack frame, without the origin and query string. */
export function topFrameOf(stack: string | undefined, fallback = ''): string {
  if (stack) {
    for (const line of stack.split('\n')) {
      const m = /(?:\(|@|\s)((?:https?:\/\/[^/\s)]+)?[^\s()]*?):(\d+):(\d+)\)?\s*$/.exec(line.trim());
      if (m && m[1]) return `${path(m[1])}:${m[2] ?? '0'}:${m[3] ?? '0'}`.slice(0, MSG_CHARS);
    }
  }
  return fallback.slice(0, MSG_CHARS);
}

function path(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '');
}

/** Stable 8-hex fingerprint of a message shape and its top frame (digits are folded so counters do not split groups). */
export function fingerprint(message: string, top: string): string {
  const shape = message.replace(/\d+/g, '#').slice(0, 256);
  return fnv32(`${shape}|${top}`).toString(16).padStart(8, '0');
}

export interface ErrorHandlerTarget {
  addEventListener(type: 'error' | 'unhandledrejection', fn: (e: never) => void): void;
  removeEventListener(type: 'error' | 'unhandledrejection', fn: (e: never) => void): void;
}

export class ErrorReporter {
  readonly counts: ErrorCounts = { js: 0, promise: 0, gpuLost: 0, uncaptured: 0, gpuInit: 0 };
  private readonly seen = new Map<string, number>();
  private off: (() => void) | null = null;

  constructor(private readonly telemetry: Pick<Telemetry, 'emit'>) {}

  /** True while this fingerprint is under its cap; counts the call. */
  private allow(key: string): boolean {
    const n = (this.seen.get(key) ?? 0) + 1;
    this.seen.set(key, n);
    return n <= MAX_PER_FINGERPRINT;
  }

  js(message: string, stack: string | undefined, where: string): void {
    this.counts.js += 1;
    const top = topFrameOf(stack, where);
    const fp = fingerprint(message, top);
    if (!this.allow(`js:${fp}`)) return;
    this.telemetry.emit('err.js', { fp, msg: scrub(message).slice(0, MSG_CHARS), top });
  }

  promise(reason: unknown): void {
    this.counts.promise += 1;
    const message = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
    const top = topFrameOf(reason instanceof Error ? reason.stack : undefined);
    const fp = fingerprint(message, top);
    if (!this.allow(`promise:${fp}`)) return;
    this.telemetry.emit('err.promise', { fp, msg: scrub(message).slice(0, MSG_CHARS), ...(top ? { top } : {}) });
  }

  gpu(kind: 'init' | 'lost' | 'uncaptured', message: string): void {
    if (kind === 'lost') this.counts.gpuLost += 1;
    else if (kind === 'uncaptured') this.counts.uncaptured += 1;
    else this.counts.gpuInit += 1;
    const msg = scrub(message).slice(0, MSG_CHARS);
    // Deduplicate by message shape (digits folded), at most 5 per shape per session.
    if (!this.allow(`gpu:${kind}:${fingerprint(msg, '')}`)) return;
    this.telemetry.emit('err.gpu', { kind, msg });
  }

  /** Installs `error` and `unhandledrejection` listeners on `target` (the window). Returns the uninstall function. */
  install(target: ErrorHandlerTarget = globalThis as unknown as ErrorHandlerTarget): () => void {
    this.off?.();
    const onError = (e: ErrorEvent): void => {
      this.js(e.message || 'error', e.error instanceof Error ? e.error.stack : undefined, `${path(e.filename || '')}:${e.lineno}:${e.colno}`);
    };
    const onRejection = (e: PromiseRejectionEvent): void => this.promise(e.reason);
    target.addEventListener('error', onError as (e: never) => void);
    target.addEventListener('unhandledrejection', onRejection as (e: never) => void);
    this.off = () => {
      target.removeEventListener('error', onError as (e: never) => void);
      target.removeEventListener('unhandledrejection', onRejection as (e: never) => void);
    };
    return this.off;
  }
}
