import { collectDiagnosticSignals, createPlatform, formatDiagnostics, parseQaFlags } from '@dv/engine';
import { bootEngine, type EngineHandle } from '@dv/engine/client/boot';
import type { WorkerPort } from '@dv/engine/assets/client';
import type { WorkerLike } from '@dv/engine/sim';
import { bootChoice } from '@dv/world/sim/boot';
import { hasWorldIndex, prepareWorld, type PreparedWorld } from '@dv/world/client';
import platformFlags from '../../../config/platform-flags.json';
import { mountShell, t, type ShellProps } from '@dv/ui';
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

// The title screen at "/" sits over the live world (M01b2); ?debug=1 (QA) goes straight to play. Other routes keep the corner view.
const ON_HOME = location.pathname === '/';
const PLAY_CLASS = 'dv-engine-canvas dv-engine-canvas--play';
const BACKDROP_CLASS = 'dv-engine-canvas dv-engine-canvas--backdrop';

const update = 'serviceWorker' in navigator
  ? createPwaUpdateController({ container: navigator.serviceWorker, reload: () => location.reload() })
  : null;

const shellProps = (unsupported: boolean): ShellProps => ({
  diagnostics: () => formatDiagnostics(collectDiagnosticSignals(BUILD)),
  unsupported,
  update,
  initialPath: location.pathname,
});
mountShell(root, shellProps(flags.unsupported));

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
  canvas.className = flags.debug ? PLAY_CLASS : ON_HOME ? BACKDROP_CLASS : 'dv-engine-canvas';
  if (ON_HOME || flags.debug) document.documentElement.classList.add('dv-world');
  if (flags.debug) document.documentElement.classList.add('dv-playing');
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
      events: {
        unsupported: () => mountShell(root as HTMLElement, shellProps(true)),
        reloadPrompt: showReloadPrompt,
      },
    });
  } catch (error) {
    console.error('platform failed to start', error);
    mountShell(root as HTMLElement, shellProps(true));
    return;
  }

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
      });
    } catch (error) {
      console.error('the baked world could not be prepared', error);
    }
  }
  let engineRef: EngineHandle | null = null;
  // True once the player pressed Start (or ?debug=1 skipped the title): from then on Pause brings the title back and Start resumes.
  let started = flags.debug;
  const setPlayView = (playing: boolean): void => {
    document.documentElement.classList.toggle('dv-playing', playing);
    canvas.className = playing ? PLAY_CLASS : BACKDROP_CLASS;
  };
  const engine = await bootEngine({
    container,
    qa: QA,
    flags,
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
    play: flags.debug,
    forceTouch: flags.touch,
    // The sim queues mode.enter, mode.exit and unlock.emit (M04a2); the platform client applies consent and batching.
    onTelemetry: (name, props) => platform.telemetry.emit(name as never, props),
    // Pausing brings the title back over the world; Start resumes.
    onPausedChange: (paused) => {
      if (started) setPlayView(!paused);
    },
  }).catch((error: unknown) => {
    console.error('engine failed to start', error);
    return null;
  });
  engineRef = engine;
  if (engine) platform.bindEngine({ setPaused: (p) => engine.setPaused(p), resetClock: () => engine.resetClock() });
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

  // Start on the title screen: the world becomes the game.
  document.addEventListener('click', (e) => {
    const hit = (e.target as Element | null)?.closest?.('[data-testid="title-start"]');
    if (!hit || !engineRef) return;
    started = true;
    document.documentElement.classList.add('dv-world');
    engineRef.setPaused(false);
    engineRef.setPlay(true);
    setPlayView(true);
  });

  // QA builds only: window.__dvBridge. The literal comparison lets production builds drop the branch.
  if (import.meta.env.VITE_DV_QA === '1') {
    const [{ installEngineBridge }, { installPlatformBridge }, { installAssetsBridge }] = await Promise.all([
      import('@dv/engine/client/debug/bridge'),
      import('@dv/engine/platform/probe'),
      import('@dv/engine/assets/bridge'),
    ]);
    if (engine) installEngineBridge(engine);
    if (assets) installAssetsBridge(assets);
    document.documentElement.dataset.dvEngine = 'ready';
    const bridge = installPlatformBridge(platform, flags, prepared ? { worldDriver: () => (prepared as PreparedWorld).view.scenarioDriver() } : {});
    if (prepared) (await import('@dv/world/client/bridge')).installWorldBridge(prepared.view, platform.quality.tier.id);
    // ?racing=1 (M07a1): __dvBridge.racing; ?racing=demo also starts the straight demo race at once.
    if (flags.racing) {
      const racing = (await import('@dv/mode-racing/qa/bridge')).installRacingBridge();
      if (flags.racingDemo) void racing.demo().catch((e: unknown) => console.warn('racing demo failed', e));
    }
    // ?scenario=<id> starts that perf scenario at boot (path duration).
    if (flags.scenario) void bridge.perf.run(flags.scenario).catch((e: unknown) => console.warn('perf scenario failed', e));
    if (flags.probe === 'gpu') {
      const result = await bridge.gpuProbe();
      console.info('dv-gpu-probe', JSON.stringify(result));
      document.documentElement.dataset.dvProbe = 'done';
    }
  }
}

if (!flags.unsupported && typeof Worker !== 'undefined') void boot();

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
