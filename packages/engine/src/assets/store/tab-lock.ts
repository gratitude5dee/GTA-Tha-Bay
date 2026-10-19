/**
 * One writer per browser profile (11-platform-pwa.md section 5, rule 7). Tabs talk over `BroadcastChannel('dv-instance')`:
 * a new tab says hello and waits a short time; an older tab that is already the writer answers `owner`, and the new tab then
 * becomes read-only. When two tabs start together, the one with the smaller `(startedAt, id)` wins. Cross-tab sync-handle
 * behaviour is UNVERIFIED (U-PLT-16), so this design avoids concurrent writers rather than relying on handle semantics.
 */
export type TabMode = 'rw' | 'read-only';

export const INSTANCE_CHANNEL = 'dv-instance';
export const PROBE_MS = 200;

export interface ChannelLike {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  close(): void;
}

interface Hello {
  t: 'hello';
  id: string;
  ts: number;
}
interface Owner {
  t: 'owner';
  id: string;
  to: string;
}
type Msg = Hello | Owner;

function isMsg(v: unknown): v is Msg {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as { t?: unknown; id?: unknown };
  return (m.t === 'hello' || m.t === 'owner') && typeof m.id === 'string';
}

export interface TabLockOptions {
  /** Null where `BroadcastChannel` does not exist: the tab is the writer. */
  channel: ChannelLike | null;
  id: string;
  /** Epoch ms at which this tab started; the older tab wins a tie. */
  startedAt: number;
  probeMs?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
}

export class TabLock {
  private modeValue: TabMode = 'rw';
  private probing = true;
  private readonly listeners = new Set<(m: TabMode) => void>();
  private readonly o: TabLockOptions;

  constructor(o: TabLockOptions) {
    this.o = o;
  }

  get mode(): TabMode {
    return this.modeValue;
  }

  onChange(fn: (m: TabMode) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Resolves with the mode after the probe window. */
  start(): Promise<TabMode> {
    const ch = this.o.channel;
    if (!ch) {
      this.probing = false;
      return Promise.resolve(this.modeValue);
    }
    ch.onmessage = (e) => this.receive(e.data);
    ch.postMessage({ t: 'hello', id: this.o.id, ts: this.o.startedAt } satisfies Hello);
    const timer = this.o.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    return new Promise((resolve) => {
      timer(() => {
        this.probing = false;
        resolve(this.modeValue);
      }, this.o.probeMs ?? PROBE_MS);
    });
  }

  private receive(data: unknown): void {
    if (!isMsg(data) || data.id === this.o.id) return;
    if (data.t === 'hello') {
      // Answer when this tab is the writer, or is still probing but older than the sender.
      const older = this.o.startedAt < data.ts || (this.o.startedAt === data.ts && this.o.id < data.id);
      if (this.modeValue === 'rw' && (!this.probing || older)) {
        this.o.channel?.postMessage({ t: 'owner', id: this.o.id, to: data.id } satisfies Owner);
      }
    } else if (data.to === this.o.id && this.probing && this.modeValue === 'rw') {
      this.set('read-only');
    }
  }

  private set(m: TabMode): void {
    if (m === this.modeValue) return;
    this.modeValue = m;
    for (const fn of this.listeners) fn(m);
  }

  close(): void {
    if (this.o.channel) {
      this.o.channel.onmessage = null;
      this.o.channel.close();
    }
  }
}
