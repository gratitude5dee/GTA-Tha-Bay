import { collectDiagnosticSignals, createPlatform, fetchBootRegion, formatDiagnostics, parseQaFlags } from '@dv/engine';
import { storyBoot } from './story-content.ts';
import { bootEngine, type EngineHandle } from '@dv/engine/client/boot';
import type { WorkerPort } from '@dv/engine/assets/client';
import type { WorkerLike } from '@dv/engine/sim';
import { bootChoice } from '@dv/world/sim/boot';
import { hasWorldIndex, prepareWorld, type PreparedWorld } from '@dv/world/client';
import platformFlags from '../../../config/platform-flags.json';
import { createVoicePreview, creatorVoiceRef, CREATOR_VOICES, loadPrefs, memoryPrefs, defaultPrefs, mountShell, registerTexts, t, type CreatorStagePort, type PrefsStore, type ShellHandle, type ShellHooks, type ShellProps, type VoicePreview } from '@dv/ui';
import type { TtsAudioHost } from '@dv/npc/voice';
import { TERMS_VERSION } from '../../../config/terms.ts';
import { installIdentityBridge, wireIdentity } from './identity.ts';
import type { CutsceneGlue } from './cutscene.ts';
import { createEnginePort, createPlatformPort, createSavesPort } from './shell-ports.ts';
import './engine.css';
import { createPwaUpdateController } from './pwa-update.ts';
// The M01f gray-box fixture packs, as hashed static files (M01e replaces this with the pack store).
import grayboxL0Url from '../../../tests/fixtures/world/civic-graybox/l0-64-64.pack?url';
import grayboxP0Url from '../../../tests/fixtures/world/civic-graybox/p0-64-64.pack?url';

const QA = import.meta.env.VITE_DV_QA === '1';
// Tier decisions are re-run when the build changes (11-platform.md section 5.3); vite.config.ts sets VITE_DV_BUILD.
const BUILD = import.meta.env.VITE_DV_BUILD ?? (QA ? 'qa' : 'prod');
const flags = parseQaFlags(location.search);

const root = document.getElementById('app');
if (!root) throw new Error('missing #app');

const PLAY_CLASS = 'dv-engine-canvas dv-engine-canvas--play';
const BACKDROP_CLASS = 'dv-engine-canvas dv-engine-canvas--backdrop';

const update = 'serviceWorker' in navigator
  ? createPwaUpdateController({ container: navigator.serviceWorker, reload: () => location.reload() })
  : null;

// The QA play bypass (M04b1, DL-650): `?play=sandbox|story`, the QA-only key `dv-qa-play`, or `?scenario=<id>` skips the gates and starts
// that mode. It runs on an in-memory profile of preferences: nothing about the attestation or the Terms is persisted.
const qaPlay = QA && (flags.play === 'sandbox' || flags.play === 'story') ? ({ mode: flags.play } as const) : null;

// What the shell last asked of the engine and the canvas. The shell exists before the engine does, so these are applied when each appears.
const want = { play: qaPlay !== null || flags.debug, paused: false, view: qaPlay !== null || flags.debug };
let canvasRef: HTMLCanvasElement | null = null;
let engineRef: EngineHandle | null = null;
const applyView = (): void => {
  document.documentElement.classList.toggle('dv-playing', want.view);
  document.documentElement.classList.add('dv-world');
  if (canvasRef) canvasRef.className = want.view ? PLAY_CLASS : BACKDROP_CLASS;
};
const hooks: ShellHooks = {
  play: (on) => {
    want.play = on;
    engineRef?.setPlay(on);
  },
  setPaused: (p) => {
    want.paused = p;
    engineRef?.setPaused(p);
  },
  view: (on) => {
    want.view = on;
    applyView();
  },
  reload: () => location.reload(),
};

// The block check runs before anything else: a blocked device never boots the platform, the engine or any request (10-ui-pages.md 2.4 rule 4).
const prefs: PrefsStore = qaPlay
  ? memoryPrefs({ ...defaultPrefs(), age: { attested: '18p', attestedAt: Date.now(), blocked: false }, terms: { version: TERMS_VERSION, acceptedAt: Date.now() } })
  : await loadPrefs();

// The P0 identity (M04b3): opens behind the Title, never blocks it; the age page forwards its attestation here.
const identity = wireIdentity(prefs);
// The creator preview (M04b2): built once the renderer host exists; the shell asks for it each time the creator opens.
let creatorStage: CreatorStagePort | null = null;
// The world's maps (M02c2): the phone Map app, its search and the minimap's north-up switch; set once the baked world is prepared.
let mapPort: ReturnType<NonNullable<ShellProps['map']>> = null;

// The creator's voice preview (M06a4): built once the audio service and the pack catalog exist; null keeps the Preview button disabled.
let voicePreviewFactory: ((onSubtitle: (text: string | null) => void) => VoicePreview) | null = null;

const shellProps = (unsupported: boolean): ShellProps => ({
  stage: () => creatorStage,
  voicePreview: (onSubtitle) => voicePreviewFactory?.(onSubtitle) ?? null,
  map: () => mapPort,
  forceTouch: flags.touch,
  diagnostics: () => formatDiagnostics(collectDiagnosticSignals(BUILD)),
  unsupported,
  update,
  initialPath: location.pathname,
  prefs,
  qa: QA,
  qaPlay,
  unlockAllFlag: flags.unlockAll,
  hooks,
  build: BUILD,
  onConsent: (c) => {
    pendingConsent = c;
    applyPendingConsent();
  },
  onAttest: (bracket) => identity.attest(bracket),
  onGatesPassed: (phase) => {
    if (phase === 'attested') attestedOpen();
    else termsAccepted();
  },
});
const shell: ShellHandle = mountShell(root, shellProps(flags.unsupported));
applyView();
if (QA) installIdentityBridge(identity);

/** The reload prompt after a second device loss (11-platform.md section 5.8). */
function showReloadPrompt(): void {
  if (document.getElementById('dv-reload-prompt')) return;
  const box = document.createElement('div');
  box.id = 'dv-reload-prompt';
  box.className = 'dv-engine-banner';
  box.setAttribute('role', 'alertdialog');
  const text = document.createElement('span');
  text.textContent = `${t('engine.reload')} `;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = t('engine.reload.action');
  button.addEventListener('click', () => location.reload());
  box.append(text, button);
  document.body.append(box);
}

/** The non-blocking notice for a second tab (M01e, 11-platform-pwa.md section 5 rule 7). */
function showReadOnlyNotice(): void {
  if (document.getElementById('dv-readonly-notice')) return;
  const box = document.createElement('div');
  box.id = 'dv-readonly-notice';
  box.className = 'dv-engine-banner';
  box.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = `${t('engine.readonly')} `;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = t('engine.readonly.action');
  button.addEventListener('click', () => box.remove());
  box.append(text, button);
  document.body.append(box);
}

// The platform (device probe, tier decision, renderer host, telemetry) and the engine (sim.worker, Rapier, the debug cube
// view on the host's scene). Skipped on the unsupported screen. WebGL2 failing as well shows the unsupported page.
async function boot(): Promise<void> {
  const container = document.createElement('div');
  container.id = 'dv-engine';
  document.body.append(container);
  const canvas = document.createElement('canvas');
  canvas.id = 'dv-engine-canvas';
  canvasRef = canvas;
  applyView();
  canvas.setAttribute('aria-hidden', 'true');
  container.append(canvas);

  // QA builds only: the IWER emulator has to exist before the device probe and the renderer. The literal comparison lets
  // production builds drop the branch, including the emulator.
  if (import.meta.env.VITE_DV_QA === '1' && flags.xrEmulate !== null) {
    const { installIwer } = await import('@dv/engine/platform/probe');
    await installIwer();
  }

  let platform;
  try {
    platform = await createPlatform({
      canvas,
      flags,
      build: BUILD,
      // The composed asset worker: the engine's pack store plus the world jobs (M02b1).
      spawnAssetWorker: () => new Worker(new URL('./workers/asset.worker.ts', import.meta.url), { type: 'module', name: 'asset' }) as unknown as WorkerPort,
      // Before the Terms are accepted nothing is sent: consent starts off and the Terms card sets it (10-ui-pages.md 2.4 rule 6).
      ...(termsOk ? {} : { consent: { diagnostics: false, analytics: false } }),
      // The region probe (`GET /api/v1/boot`) waits for the age screen to pass; a device that is blocked never asks (BD-M04b1-04).
      region: bootRegion,
      events: {
        unsupported: () => shell.core.fire('unsupported'),
        reloadPrompt: showReloadPrompt,
      },
    });
  } catch (error) {
    console.error('platform failed to start', error);
    shell.core.fire('unsupported');
    return;
  }
  void import('@dv/engine/client/creator-stage').then((m) => {
    creatorStage = m.createCreatorStage(platform.host) as unknown as CreatorStagePort;
  });
  platformPort = createPlatformPort(platform, (name, props) => platform.telemetry.emit(name, props));
  shell.attachPlatform(platformPort);
  applyPendingConsent();

  // A second tab never writes the pack store; say so without blocking anything.
  const assets = platform.assets;
  if (assets) {
    if (assets.mode === 'read-only') showReadOnlyNotice();
    assets.onMode((m) => {
      if (m === 'read-only') showReadOnlyNotice();
    });
  }


  // The GPU probe drives the host itself, so the engine runs without a view there.
  const headless = flags.probe !== null;
  // The boot rule (M02b1, DL-668): a catalog with data/world-index boots the baked world, the gray-box Civic Center block otherwise;
  // an explicit ?world=<id> (QA builds only) wins and boots that engine scenario on the gray-box path.
  const choice = bootChoice(flags.world, !headless && assets !== null && (await hasWorldIndex(assets)));
  let prepared: PreparedWorld | null = null;
  if (choice === 'baked' && assets) {
    try {
      prepared = await prepareWorld({
        assets,
        tier: platform.quality.tier.id,
        flags: { cards: platformFlags['world.cards'] !== false, massing: platformFlags['world.massing'] !== false },
        // The sky (M02b2): world.rain (default true) and world.atmosphere (default false); ?sky=0 (QA builds) draws the world without it
        // for the on/off cost comparison of the device checklists.
        sky: {
          rain: platformFlags['world.rain'] !== false,
          atmosphere: platformFlags['world.atmosphere'] === true,
          enabled: !(QA && new URLSearchParams(location.search).get('sky') === '0'),
        },
        // The look pass (M02e): `world.look` (default true) is the full rollback switch; WebKit never bakes the sky environment.
        look: {
          // `?look=0` (QA builds) boots with the look off, the cost and request comparison of the e2e and the device checklists.
          enabled: platformFlags['world.look'] !== false && !(QA && new URLSearchParams(location.search).get('look') === '0'),
          browser: platform.profile.browser,
          backend: platform.backend,
          postLevel: platform.quality.dynamic.postLevel,
        },
        labels: { redownload: t('world.redownload'), offline: t('world.offline') },
        container,
        emit: (name, props) => platform.telemetry.emit(name, props),
        qa: QA,
        // The neighbourhood banner (M02c2): the HUD shows `hud.area` { key: 'nhood.<slug>' }, at most once per 3 s.
        onArea: (p) => engineRef?.vm.setLocal('hud.area', { key: p.key, name: p.slug }),
      });
      const layer = prepared.view.map;
      if (layer) {
        mapPort = {
          open: (canvas, onChange) => layer.openFullMap(canvas, onChange),
          search: (text, limit) => layer.search(text, limit),
          northUp: () => layer.northUpOn,
          setNorthUp: (on) => layer.setNorthUp(on),
        };
      }
    } catch (error) {
      console.error('the baked world could not be prepared', error);
    }
  }
  // The chunks the page needs once the engine is up start loading now, all at once, before the engine starts its render loop. An
  // `await import()` taken after that waits for a frame, and a software-GL frame at the desktop tiers takes seconds, so one import after
  // another kept window.__dvBridge.platform back past the perf harness's 90 s wait (BD-FIX-CI3-C01). Awaiting a settled promise costs no frame.
  const cutsceneChunk = import('./cutscene.ts');
  // QA builds only (the literal comparison lets production builds drop the branch): the QA bridges and panels.
  const qaChunks =
    import.meta.env.VITE_DV_QA === '1'
      ? {
          missions: import('./qa/missions.ts'),
          bridges: Promise.all([import('@dv/engine/client/debug/bridge'), import('@dv/engine/platform/probe'), import('@dv/engine/assets/bridge')]),
          media: import('./qa/media-game.ts'),
          cutscene: import('./qa/cutscene-bridge.ts'),
          mission: Promise.all([import('@dv/mode-story/debug'), import('@dv/mode-story/debug/overlay')]),
          ui: import('@dv/ui/xr-qa'),
          world: prepared ? import('@dv/world/client/bridge') : null,
        }
      : null;
  // QA `?mission=<id>` (M05a1): the compiled mission the story mode starts at boot; QA builds only.
  const qaMission = qaChunks && flags.mission ? await qaChunks.missions.then((m) => m.qaMissionBundle(flags.mission as string)) : null;
  // The cutscene protocol (M05b2): a mission that starts at boot emits cut.request before the engine handle exists, so the events are
  // caught from the first tick and handed to the CutscenePlayer once it is installed.
  const cutBacklog: { t: string; tick: number; n?: number; s?: string }[] = [];
  let cutSink: CutsceneGlue['handleEvents'] | null = null;
  const story = storyBoot(!QA || flags.story);
  registerTexts(story.lines);
  if (qaMission && typeof qaMission['lines'] === 'object') registerTexts(qaMission['lines'] as Record<string, string>);
  const engine = await bootEngine({
    onSimEvents: (events) => {
      const cuts = events.filter((e) => e.t === 'cut.request' || e.t === 'cut.done');
      if (cuts.length === 0) return;
      if (cutSink) cutSink(cuts);
      else cutBacklog.push(...cuts);
    },
    container,
    qa: QA,
    flags,
    ...(qaMission ? { mission: qaMission } : {}),
    // The Act 1 mission catalog: the Jobs list, the start markers and the auto start (M05c1). A QA build turns the triggers on with `?story=1`.
    story: story,
    host: platform.host,
    tier: platform.quality.tier.id,
    ...(flags.profile ? { profile: flags.profile } : {}),
    labels: { recovering: t('engine.recovering') },
    // The composed sim worker: the engine sim plus the world streaming module (M02b1, DL-651); the literal form Vite bundles.
    spawn: () => new Worker(new URL('./workers/sim.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
    headless,
    ...(prepared
      ? { world: prepared.boot }
      : choice === 'scenario'
        ? { scenario: flags.world as string }
        : { graybox: { p0: grayboxP0Url, l0: grayboxL0Url } }),
    play: want.play,
    forceTouch: flags.touch,
    // The sim queues mode.enter, mode.exit and unlock.emit (M04a2); the platform client applies consent and batching.
    onTelemetry: (name, props) => platform.telemetry.emit(name as never, props),
    // The Pause action opens or closes the shell's pause menu.
    onPausedChange: (paused) => shell.enginePaused(paused),
    // The Phone action opens or closes the shell's phone.
    onPhone: () => shell.core.togglePhone(),
    // Toasts the sim raises (unlocks, refused modes, boundary notices) are drawn by the shell.
    onToast: (toast) => shell.onToast(toast),
  }).catch((error: unknown) => {
    console.error('engine failed to start', error);
    return null;
  });
  engineRef = engine;
  // The creator's voice preview (M06a4): the clips are `audio_bark/creator-voice.<partId>` assets rendered by the staging TTS probe. A part whose
  // clip is not in the catalog keeps its button disabled. The check runs once the catalog is ready and costs one resolve per voice part.
  if (engine?.audioService && assets) {
    const audioHost = engine.audioService as unknown as TtsAudioHost;
    const media = engine.media;
    const have = new Set<string>();
    void (async () => {
      try {
        if ((await assets.loadCatalog()) !== 'ready') return;
        await Promise.all(
          Object.keys(CREATOR_VOICES.voices).map(async (id) => {
            try {
              await assets.resolve(creatorVoiceRef(id));
              have.add(id);
            } catch {
              // no clip for this part
            }
          }),
        );
      } catch {
        // the catalog is not available: every Preview button stays disabled
      }
    })();
    void import('@dv/npc/voice').then(({ TtsPlayer }) => {
      const player = new TtsPlayer({ audio: audioHost });
      voicePreviewFactory = (onSubtitle) =>
        createVoicePreview({
          hasClip: (id) => have.has(id),
          loadClip: async (id) => ({ bytes: new Uint8Array(await assets.get(creatorVoiceRef(id))), codec: 'mp3' }),
          play: (clip, o) => player.playClip(clip, { detuneCents: o.detuneCents, onEnded: o.onEnded }),
          unlocked: () => media.state().unlocked,
          subtitle: onSubtitle,
        });
    });
  }
  // The map palette follows the HUD palette setting (default, deutan, protan, tritan; M02c2).
  if (engine && prepared?.view.map) {
    const map = prepared.view.map;
    const apply = (v: unknown): void => {
      const name = (v as { accessibility?: { hudPalette?: string } } | undefined)?.accessibility?.hudPalette;
      if (name === 'default' || name === 'deutan' || name === 'protan' || name === 'tritan') map.setPalette(name);
    };
    apply(engine.vm.get('sys.settings'));
    engine.vm.subscribe('sys.settings', apply);
  }
  // The CutscenePlayer (M05b2): answers the sim's cut.request with the clip or the in-engine fallback. QA builds also hand it the
  // bundled index and the sample mission's line texts.
  let cutscenes: CutsceneGlue | null = null;
  if (engine) {
    const qaMod = qaChunks ? await qaChunks.missions : null;
    const { installCutscenes } = await cutsceneChunk;
    cutscenes = installCutscenes(engine, platform, {
      qa: QA,
      beats: flags.beats,
      ...(qaMod ? { index: qaMod.qaCutsceneIndex(), lines: qaMod.qaLines() } : {}),
    });
    cutSink = cutscenes.handleEvents;
    if (cutBacklog.length > 0) cutscenes.handleEvents(cutBacklog.splice(0));
  }
  if (engine) {
    platform.bindEngine({ setPaused: (p) => engine.setPaused(p), resetClock: () => engine.resetClock() });
    engine.setPaused(want.paused);
    shell.attachEngine(createEnginePort(engine));
  }
  // The governor's atmosphereLevel knob drives the sky (M02b2): clouds, rain streak counts and decals follow it.
  if (prepared) {
    const view = prepared.view;
    view.setAtmosphereLevel(platform.quality.dynamic.atmosphereLevel);
    platform.quality.onDynamicChange((q) => {
      view.setAtmosphereLevel(q.atmosphereLevel);
      // The governor's postLevel moves the post stack (M02e; the effective level is capped by look.json postLevelCap).
      view.lookView?.setPostLevel(q.postLevel);
    });
  }

  // QA builds only: window.__dvBridge. The literal comparison lets production builds drop the branch.
  if (import.meta.env.VITE_DV_QA === '1' && qaChunks) {
    const [{ installEngineBridge }, { installPlatformBridge }, { installAssetsBridge }] = await qaChunks.bridges;
    if (engine) installEngineBridge(engine);
    // The flat cutscene path (M04c): F9 plays the test clip over the game, and window.__dvBridge.media drives it. QA builds only.
    if (engine) (await qaChunks.media).installGameMedia(engine, platform);
    // The CutscenePlayer's bridge (M05b2): window.__dvBridge.cutscene.
    if (engine && cutscenes) (await qaChunks.cutscene).installCutsceneBridge(cutscenes, engine);
    // The mission debugger (M05a1): window.__dvBridge.mission and the overlay, QA builds only.
    if (engine) {
      const [{ installMissionBridge }, { mountMissionOverlay }] = await qaChunks.mission;
      const host = { vm: engine.vm, sendUi: (c: Parameters<typeof engine.sendUi>[0]) => engine.sendUi(c), step: (n: number) => engine.step(n), setPaused: (p: boolean) => engine.setPaused(p) };
      mountMissionOverlay(host, installMissionBridge(host));
    }
    // The UI skeleton's test panel (M04b2, AC-11): only where the engine has a panels host (QA builds with a renderer).
    if (engine?.xrPanels) {
      const { createUiQaBridge } = await qaChunks.ui;
      const ui = createUiQaBridge(engine.xrPanels as never, engine.vm as never);
      const w = window as unknown as { __dvBridge?: Record<string, unknown> };
      w.__dvBridge = { ...(w.__dvBridge ?? {}), ui };
    }
    // The NPC dialogue panel (M06a3): window.__dvBridge.npc and a "Talk to npc_test" box, QA builds only. Failure here never stops the game.
    const npcAudio = !engine?.audioService ? null : { host: engine.audioService as unknown as TtsAudioHost, unlock: () => engine.audioUnlock() };
    void import('./qa/npc.ts').then((m) => m.installNpcQa(identity, npcAudio)).catch((e: unknown) => console.warn('npc qa panel failed', e));
    if (assets) installAssetsBridge(assets);
    document.documentElement.dataset.dvEngine = 'ready';
    const bridge = installPlatformBridge(platform, flags, prepared ? { worldDriver: () => (prepared as PreparedWorld).view.scenarioDriver() } : {});
    if (prepared && qaChunks.world) (await qaChunks.world).installWorldBridge(prepared.view, platform.quality.tier.id);
    // ?racing=1 (M07a1): __dvBridge.racing; ?racing=demo also starts the straight demo race at once.
    if (flags.racing) {
      const racing = (await import('@dv/mode-racing/qa/bridge')).installRacingBridge();
      if (flags.racingDemo) void racing.demo().catch((e: unknown) => console.warn('racing demo failed', e));
    }
    // ?tycoon=1 (M09a1): the Business Tycoon QA panel and __dvBridge.tycoon (text panel, seeded runs, the cross-browser det check).
    if (flags.tycoon) (await import('@dv/mode-tycoon/qa/bridge')).installTycoonBridge();
    // ?scenario=<id> starts that perf scenario at boot (path duration).
    if (flags.scenario) void bridge.perf.run(flags.scenario).catch((e: unknown) => console.warn('perf scenario failed', e));
    if (flags.probe === 'gpu') {
      const result = await bridge.gpuProbe();
      console.info('dv-gpu-probe', JSON.stringify(result));
      document.documentElement.dataset.dvProbe = 'done';
    }
  }
}

// The platform and the engine boot at page load, behind the Title, on every device that is not blocked: a blocked device boots nothing
// and makes no request. Nothing goes to the Worker API (the region probe) until the age screen has passed, and no telemetry leaves before
// the Terms are accepted.
let started = false;
let attestedOpen: () => void = () => undefined;
const attestedGate = new Promise<void>((resolve) => {
  attestedOpen = resolve;
});
// One region probe serves the platform and the play-token client.
const bootRegion = attestedGate.then(() => fetchBootRegion(fetch, location.origin)).then((r) => {
  identity.setRegion(r);
  return r;
});
if (prefs.get().age.attested === '18p' && !prefs.get().age.blocked) attestedOpen();
let platformPort: ReturnType<typeof createPlatformPort> | null = null;
let pendingConsent: { diagnostics: boolean; analytics: boolean } | null = null;
const termsOk = qaPlay !== null || prefs.get().terms?.version === TERMS_VERSION;

function applyPendingConsent(): void {
  if (platformPort && pendingConsent) {
    const c = pendingConsent;
    pendingConsent = null;
    void platformPort.update({ telemetryConsent: c });
    platformPort.applyConsent(c);
  }
}

function startEngine(): void {
  if (started || flags.unsupported || typeof Worker === 'undefined' || prefs.get().age.blocked) return;
  started = true;
  shell.attachSaves(createSavesPort(BUILD));
  void boot();
}

function termsAccepted(): void {
  applyPendingConsent();
}

startEngine();

if (update && import.meta.env.PROD) {
  addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        update.attach(registration);
        const check = (): void => void registration.update().catch(() => {});
        setInterval(check, 60 * 60 * 1000);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check();
        });
      })
      .catch((error: unknown) => console.warn('service worker registration failed', error));
  });
}
