import type { ComponentChildren } from 'preact';
import type {
  BootConfig, GameModeId, InputContextId, JsonObject, JsonValue, LastSaveStatus, PlatformSettings, ProfileId, ProfileMeta, ProfileSettings,
  PwaUpdateController, SaveResult, SlotId, UiCommand, ViewModelSource,
} from '@dv/shared';
import type { LocKey } from '../i18n/index.ts';
import type { CreatorStagePort } from '../creator/stage.ts';
import type { VoicePreview } from '../creator/voice-preview.ts';
import type { MapPort } from '../phone/map-port.ts';
import type { ScreenDef } from '../screen/types.ts';
import type { SettingsBinderApi } from './binder.ts';
import type { ShellEvent } from './machine.ts';
import type { OverlayHooks } from './overlay-hooks.ts';

export type { LocKey } from '../i18n/index.ts';

export type PageId =
  | 'boot' | 'unsupported' | 'title' | 'age' | 'blocked' | 'terms' | 'main' | 'load' | 'new' | 'creator'
  | 'modes' | 'garage' | 'npcs' | 'community' | 'experiences' | 'mods' | 'online' | 'profile' | 'saves'
  | 'settings' | 'credits' | 'legal' | 'help' | 'account' | 'pause' | 'phone' | 'loading' | 'error';

/** The states of the shell machine (10-ui.md section 2.4). `Account` is a full-page redirect, so it has no state here. */
export type ShellState =
  | 'Booting' | 'Unsupported' | 'Title' | 'AgeGate' | 'Blocked' | 'Terms' | 'Menu' | 'Loading' | 'InMode' | 'Paused' | 'Recovering' | 'Error';

export type GateResult =
  | { state: 'open' }
  | { state: 'hidden' }
  | { state: 'disabled'; reason: LocKey; cta?: { label: LocKey; to: PageId | { href: string } } };

export type IdentityTier = 'local' | 'device' | 'linked';
export interface IdentityState { tier: IdentityTier }

export interface GateCtx {
  flags: Partial<BootConfig['flags']> & Record<string, boolean | undefined>;
  region: BootConfig['region'];
  identity: IdentityState;
  online: boolean;
  unlocks: ReadonlySet<string>;
  attested: boolean;
  profile: ProfileMeta | null;
  headset: 'quest' | 'visionpro' | null;
}

/** What a gate needs to say about a page (the table of 10-ui.md section 2.5). */
export interface GateSpec {
  /** `BootConfig.flags` key; false or absent hides the page. */
  flag?: string;
  /** Needs the network: offline disables with the Offline reason. */
  online?: boolean;
  /** Hidden when `BootConfig.region` is 'blocked'. */
  regionSensitive?: boolean;
  /** Minimum identity tier; below it the page is disabled with a call to action. */
  tier?: IdentityTier;
  /** Needs an 18+ attestation. */
  attested?: boolean;
}

export type PageKind = 'menu' | 'overlay' | 'modal' | 'document';
export type PageComponent = (props: PageProps) => ComponentChildren;
export interface PageProps {
  page: PageId;
  shell: ShellApi;
  ctx: ShellContext;
  params: Readonly<Record<string, string>>;
}

export interface PageDef {
  id: PageId;
  route: string | null;
  titleKey: LocKey;
  kind: PageKind;
  gate(ctx: GateCtx): GateResult;
  xr: 'screen' | 'exit' | 'none';
  inputContext: InputContextId;
  load: () => Promise<{ default: PageComponent | (() => ScreenDef) }>;
  milestone: string;
}

export interface ToastSpec {
  id: string;
  kind: 'info' | 'success' | 'warning' | 'unlock' | 'error';
  text: LocKey;
  params?: Record<string, string | number>;
  action?: { label: LocKey; cmd: UiCommand | { nav: PageId } };
  ttlMs: number;
  icon: string;
}

export interface ModalSpec<T> {
  titleKey: LocKey;
  body: (close: (value: T | null) => void) => ComponentChildren;
}
export interface ConfirmSpec {
  titleKey: LocKey;
  bodyKey: LocKey;
  params?: Record<string, string | number>;
  confirmKey: LocKey;
  danger?: boolean;
  /** Type this text to enable the confirm button (delete with type-to-confirm). */
  typeToConfirm?: string;
}

export interface ShellApi {
  readonly state: ShellState;
  navigate(id: PageId, params?: Record<string, string>): void;
  back(): void;
  modal<T>(spec: ModalSpec<T>): Promise<T | null>;
  confirm(spec: ConfirmSpec): Promise<boolean>;
  toast(t: Partial<ToastSpec> & Pick<ToastSpec, 'text'>): void;
  announce(text: string, politeness?: 'polite' | 'assertive'): void;
  setSafePoint(kind: 'menu' | 'mission-end' | 'safehouse' | 'loading'): void;
}

// ---- Ports: what the shell needs from the app. Structural, so the shell imports no engine code.

export type AgeBracket = '18p' | 'u18';

export interface UiPrefs {
  v: 1;
  lang: string | null;
  uiScale: number;
  highContrast: boolean;
  focusRing: 'default' | 'thick';
  hudScale: number;
  hudOpacity: number;
  hudSafeMarginPct: number;
  units: 'mph' | 'kph';
  showTips: boolean;
  announce: boolean;
  showFps: boolean;
  soundCaptions: boolean;
  seenTiles: string[];
  dismissed: string[];
  customTouchLayouts: Record<string, JsonObject>;
  age: { attested: '18p' | null; attestedAt: number | null; blocked: boolean };
  terms: { version: string; acceptedAt: number } | null;
}

export interface SlotSummary {
  slot: SlotId;
  gen: number;
  savedAt: number;
  bytes: number;
  fellBack: boolean;
}

/** The page's end of the C05 SaveService for profile rows, slots and export/import (BD-M04b1-02). */
export interface SavesPort {
  /** False on the in-memory fallback ("Progress cannot be saved"). */
  readonly persistent: boolean;
  list(): Promise<ProfileMeta[]>;
  create(name: string): Promise<ProfileMeta | SaveResult>;
  rename(id: ProfileId, name: string): Promise<SaveResult>;
  remove(id: ProfileId): Promise<SaveResult>;
  slots(id: ProfileId): Promise<SlotSummary[]>;
  /** Total bytes of the profile's live records. */
  usage(id: ProfileId): Promise<number>;
  exportProfile(id: ProfileId): Promise<Blob>;
  importProfile(b: Blob, mode: 'asNew' | 'replace', into?: ProfileId): Promise<SaveResult>;
  /** Undo the import into `id`: a replace restores the earlier saves; the profile an as-new import made is removed. */
  undoImport(id: ProfileId): Promise<SaveResult>;
  /** True when `undoImport(id)` can run (a replace import, or the profile the last as-new import made). */
  canUndo(id: ProfileId): boolean;
  /** The newest save of the profile, verified (the Continue line). */
  lastSave(id: ProfileId): Promise<LastSaveStatus | null>;
}

export interface StorageInfo { usage: number; quota: number; persisted: boolean | null }

/** What a city download would take on this device (M04b4). Sizes come from the catalog at run time. */
export interface OfflinePlan {
  totalBytes: number;
  files: number;
  missingBytes: number;
  missingFiles: number;
  /** Free quota in bytes; null when the browser gives no estimate. */
  freeBytes: number | null;
  fits: boolean;
  shortfallBytes: number;
  store: 'opfs' | 'memory-fallback';
  /** False in a read-only second tab. */
  writable: boolean;
}
export type OfflineJobState = 'running' | 'done' | 'cancelled' | 'failed';
export interface OfflineJob { done: number; total: number; state: OfflineJobState; reason?: string }

/** The city download as the Settings page uses it. The job lives in the port, so leaving the page neither stops nor loses it. */
export interface OfflinePort {
  /** Null while the catalog is not ready. */
  plan(): Promise<OfflinePlan | null>;
  downloaded(): Promise<{ bytes: number; files: number }>;
  /** Starts a download, or returns the running one. Resolves when the job ends. */
  start(): Promise<OfflineJob>;
  cancel(): void;
  job(): OfflineJob | null;
  onJob(cb: (j: OfflineJob) => void): () => void;
  clear(): Promise<void>;
}

/** The device-scoped platform settings and the quality service, as the Settings page and the Terms card use them. */
export interface PlatformPort {
  settings(): PlatformSettings;
  update(patch: Partial<PlatformSettings>): Promise<void>;
  /** The line "Quality: Desktop (auto)" and its reason, and the backend. */
  tierInfo(): { tier: string; source: string; backend: string };
  /** Tiers valid for the device class (the Quality choice). */
  tierChoices(): readonly string[];
  rerunBenchmark?(): Promise<void>;
  storage(): Promise<StorageInfo>;
  requestPersist?(): Promise<boolean>;
  /** The city download for offline play (M04b4). Absent where the pack store is not wired. */
  offline?: OfflinePort;
  /** The consent that governs telemetry now; the shell calls it with the stored value when Terms are accepted. */
  applyConsent(c: PlatformSettings['telemetryConsent']): void;
  /** Emits a telemetry event (the platform client drops it without consent). */
  emit(name: 'ui.page' | 'ui.onboard', props: Record<string, string | number | boolean>): void;
  deviceClass: 'desktop' | 'mobile' | 'xr';
  xrCapable: boolean;
  /** True once M11a1's FramePacer exists; until then the frame-cap row is disabled with its reason (M04b5). */
  framePacer?: boolean;
  /** Frame-rate samples, about once a second (the FPS chip, the `fps` shell signal). Returns the unsubscribe. */
  onFrameStats?(cb: (s: { fps: number; tier: string }) => void): () => void;
  install?: { canPrompt(): boolean; prompt(): Promise<void>; isIos: boolean; standalone: boolean };
}

export interface EnginePort {
  readonly vm: ViewModelSource;
  sendUi(cmd: UiCommand): boolean;
  /** The device the player used last ('kbm' | 'gamepad' | 'touch'), for glyphs. */
  activeDevice(): string;
  audioUnlock(): void;
  /** The first gesture of the title: `FirstGestureUnlock` (audio context and the pool of three `<video>` elements, M04c, DL-663). Idempotent. */
  firstGesture(): void;
  /** Player actions as ActionIds (the onboarding tips dismiss on them). */
  onAction?(cb: (id: string) => void): () => void;
  /** Applies a touch layout (a shipped one or the player's custom one) with its localized button labels. */
  setTouchLayout?(layout: unknown, labels: Record<string, string>): void;
}

/** What the app does with the engine and the canvas as the shell changes state. All three are idempotent. */
export interface ShellHooks {
  /** Input reaches the game and the touch layer shows (a mode runs, or the pause menu is open over it). */
  play(on: boolean): void;
  /** The pause state of the sim. */
  setPaused(paused: boolean): void;
  /** The canvas takes the screen (true) or the shell sits over the world backdrop (false). */
  view(on: boolean): void;
  /** Reload the page (compatibility mode, update, delete local data). */
  reload(): void;
}

export interface QaPlayOptions { mode: 'sandbox' | 'story' }

export interface ShellProps {
  /** Builds the diagnostics string for the unsupported screen. */
  diagnostics: () => string;
  unsupported: boolean;
  update: PwaUpdateController | null;
  initialPath: string;
  /** Loaded before the first paint; see `loadPrefs`. */
  prefs: PrefsStore;
  /** `VITE_DV_QA=1`: ?unlockAll=1 and the play bypass exist only then. */
  qa: boolean;
  /** The QA play bypass, already resolved from the flags (null: normal flow). */
  qaPlay: QaPlayOptions | null;
  unlockAllFlag: boolean;
  hooks: ShellHooks;
  /** The age screen passed with this bracket: the app forwards it to `IdentityService.attestAge` (M04b3 rebinds `AgeAttestationPort.attest`). */
  onAttest?: (bracket: '18p') => void;
  /** Called after Terms are accepted or the age screen passes: the app boots the engine then (nothing boots for a blocked device). */
  onGatesPassed?: (phase: 'attested' | 'terms') => void;
  /** The Terms card's consent before the platform exists; the app applies it when the platform does. */
  onConsent?: (consent: PlatformSettings['telemetryConsent']) => void;
  /** The build id for the Title and About. */
  build: string;
  /** The read-only signal stream (M04b5); tests pass fakes, the app leaves it out for the window and `BroadcastChannel`. */
  overlay?: OverlayHooks;
  /** Flags the app knows before the engine (BootConfig.flags once fetched). */
  flags?: Record<string, boolean>;
  /** `?touch=1` (QA builds) forces the touch layer; the rotate overlay follows it. */
  forceTouch?: boolean;
  /** The creator preview on the shared canvas; null while the renderer host does not exist (M04b2). */
  stage?: () => CreatorStagePort | null;
  /** The creator's voice preview (M06a4): built from the audio service and the pack store once they exist; absent or null keeps the button disabled. */
  voicePreview?: ((onSubtitle: (text: string | null) => void) => VoicePreview | null) | null;
  /** The world's maps (M02c2): the phone Map app's full map, the search and the minimap's north-up switch; null while no baked world runs. */
  map?: () => MapPort | null;
}

export interface PrefsStore {
  get(): UiPrefs;
  set(patch: Partial<UiPrefs>): void;
  subscribe(cb: (p: UiPrefs) => void): () => void;
  /** Resolves when pending writes reached the store. */
  flush(): Promise<void>;
}

/** What pages read and call. Built by the shell host; fakes in tests. */
export interface ShellContext {
  readonly props: ShellProps;
  readonly prefs: PrefsStore;
  engine: EnginePort | null;
  saves: SavesPort | null;
  platform: PlatformPort | null;
  gate: GateCtx;
  /** Last value of a view model key, or undefined. */
  vm<T extends JsonValue>(key: string): T | undefined;
  settings: ProfileSettings | null;
  /** Reads and writes settings by scope (profile settings are debounced into `save.settings`). */
  binder: SettingsBinderApi;
  mode: { state: string; stack: { id: string; state: string }[] };
  profile: { id: string; name: string; hasStory: boolean } | null;
  /** True when this tab is not the one that owns the profile (another tab is open). */
  otherTab: boolean;
  sendUi(cmd: UiCommand): boolean;
  startMode(id: GameModeId, slot?: SlotId): void;
  /** The engine is attached (modes can start). */
  readonly engineReady: boolean;
  /** Feeds an event to the shell machine (the gate pages use it). */
  fire(e: ShellEvent['t']): void;
}
