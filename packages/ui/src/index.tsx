/**
 * The shell entry (M04b1): the S10 state machine, page registry, kit and pages (10-ui.md section 2.2). `mountShell` renders the shell
 * into the root element and returns a handle the app uses to attach the engine, the save port and the platform as they come up.
 * Pages are lazy chunks (`shell/registry.ts`); this entry holds the shell, the kit and the i18n layer.
 */
import { render } from 'preact';
import './kit/tokens.css';
import './kit/shell.css';
import './kit/kit.css';
import './kit/m04b2.css';
import './kit/m04b2-hud.css';
import './kit/m05c1-talk.css';
import './kit/m02c2-map.css';
import './dialogue/dialogue.css';
import { ShellApp } from './shell/app.tsx';
import type { ChannelLike } from './shell/banners.tsx';
import { ShellCore, type SimToast } from './shell/core.ts';
import type { EnginePort, PlatformPort, SavesPort, ShellProps } from './shell/types.ts';

export { t, lk, setLang, plural, formatNumber, formatDate, registerTexts, contentText } from './i18n/index.ts';
export type { LocKey } from './i18n/index.ts';
export * from './dialogue/index.ts';
export type { CreatorStagePort, MannequinParams } from './creator/stage.ts';
export { createVoicePreview, creatorVoiceRef, CREATOR_VOICES, detuneCents } from './creator/voice-preview.ts';
export type { VoiceClip, VoicePreview, VoicePreviewDeps } from './creator/voice-preview.ts';
export { loadPrefs, memoryPrefs, defaultPrefs } from './shell/prefs.ts';
export { LEGAL_DOCS, frameFor, hrefFor, PAGES } from './shell/registry.ts';
export type { EnginePort, PlatformPort, SavesPort, ShellHooks, ShellProps, UiPrefs, PrefsStore, SlotSummary, StorageInfo, OfflineJob, OfflinePlan, OfflinePort } from './shell/types.ts';

export interface ShellHandle {
  readonly core: ShellCore;
  attachEngine(engine: EnginePort | null): void;
  attachSaves(saves: SavesPort | null): void;
  attachPlatform(platform: PlatformPort | null): void;
  /** The engine's Pause action toggled the pause. */
  enginePaused(paused: boolean): void;
  onToast(toast: SimToast): void;
  crashed(): void;
  recovered(): void;
  /** The asset catalog or the world index cannot be loaded (BD-FU-A02); `detail` is the code the error page shows. */
  worldUnavailable(detail: string): void;
  unmount(): void;
}

function openChannel(): ChannelLike | null {
  try {
    return typeof BroadcastChannel === 'function' ? (new BroadcastChannel('dv-instance') as unknown as ChannelLike) : null;
  } catch {
    return null;
  }
}

export function mountShell(root: HTMLElement, props: ShellProps): ShellHandle {
  const core = new ShellCore(props, openChannel());
  render(<ShellApp core={core} />, root);
  return {
    core,
    attachEngine: (e) => core.attachEngine(e),
    attachSaves: (s) => core.attachSaves(s),
    attachPlatform: (p) => core.attachPlatform(p),
    enginePaused: (p) => core.enginePaused(p),
    onToast: (tst) => core.onEngineToast(tst),
    crashed: () => core.crashed(),
    recovered: () => core.recovered(),
    worldUnavailable: (detail) => core.worldUnavailable(detail),
    unmount: () => render(null, root),
  };
}
