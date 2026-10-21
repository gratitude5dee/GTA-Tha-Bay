import { t } from '../i18n/index.ts';
import { Banner } from '../kit/widgets.tsx';

/**
 * Banners (10-ui.md section 5 rule 5): offline chip, "open in another tab", "Progress cannot be saved", and the non-blocking
 * notice when the page is not cross-origin isolated. Persistent; the other-tab banner also disables Play and save actions.
 */
export interface BannerState {
  online: boolean;
  otherTab: boolean;
  /** IndexedDB is unavailable: the session runs in memory. */
  noSave: boolean;
  /** `crossOriginIsolated` is false. */
  notIsolated: boolean;
}

export function Banners(props: BannerState) {
  return (
    <div class="dv-banners" data-testid="banners">
      {!props.online ? <Banner id="offline" icon="!" text={t('banner.offline')} /> : null}
      {props.otherTab ? <Banner id="other-tab" tone="warning" icon="!" text={t('banner.otherTab')} /> : null}
      {props.noSave ? <Banner id="no-save" tone="warning" icon="!" text={t('banner.noSave')} /> : null}
      {props.notIsolated ? <Banner id="not-isolated" icon="i" text={t('banner.notIsolated')} /> : null}
    </div>
  );
}

// ---- the other-tab guard (BroadcastChannel 'dv-instance')

export interface ChannelLike {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  close(): void;
}

interface Msg { t: 'hello' | 'owner'; id: string }
const isMsg = (x: unknown): x is Msg => typeof x === 'object' && x !== null && ((x as Msg).t === 'hello' || (x as Msg).t === 'owner') && typeof (x as Msg).id === 'string';

const CLAIM_MS = 150;

/**
 * The first tab on a profile owns it. A new tab says hello; an owner answers; a tab that hears an owner (or loses a simultaneous
 * hello on the lower id) is the other tab: read-only, Play and save actions off. No owner answer within 150 ms means this tab owns it.
 */
export class InstanceGuard {
  otherTab = false;
  private claimed = false;
  private timer: unknown = null;
  private readonly subs = new Set<(other: boolean) => void>();

  constructor(
    private readonly channel: ChannelLike | null,
    readonly id: string = Math.random().toString(36).slice(2) + Date.now().toString(36),
    private readonly after: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
  ) {}

  onChange(cb: (other: boolean) => void): () => void {
    this.subs.add(cb);
    return () => void this.subs.delete(cb);
  }

  start(): void {
    const ch = this.channel;
    if (!ch) {
      this.claimed = true;
      return;
    }
    ch.onmessage = (e) => {
      if (!isMsg(e.data) || e.data.id === this.id) return;
      if (e.data.t === 'owner') {
        if (!this.claimed) this.setOther();
      } else if (this.claimed) {
        ch.postMessage({ t: 'owner', id: this.id } satisfies Msg);
      } else if (e.data.id < this.id) {
        this.setOther();
      }
    };
    ch.postMessage({ t: 'hello', id: this.id } satisfies Msg);
    this.timer = this.after(() => {
      if (!this.otherTab) this.claimed = true;
    }, CLAIM_MS);
  }

  private setOther(): void {
    if (this.otherTab) return;
    this.otherTab = true;
    for (const cb of [...this.subs]) cb(true);
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer as ReturnType<typeof setTimeout>);
    this.channel?.close();
  }
}
