import { collectDiagnosticSignals, createPlatform, formatDiagnostics, parseQaFlags } from '@dv/engine';
import { bootEngine } from '@dv/engine/client/boot';
import { mountShell, t, type ShellProps } from '@dv/ui';
import './engine.css';
import { createPwaUpdateController } from './pwa-update.ts';

const QA = import.meta.env.VITE_DV_QA === '1';
// Tier decisions are re-run when the build changes (11-platform.md section 5.3); vite.config.ts sets VITE_DV_BUILD.
const BUILD = import.meta.env.VITE_DV_BUILD ?? (QA ? 'qa' : 'prod');
const flags = parseQaFlags(location.search);

const root = document.getElementById('app');
if (!root) throw new Error('missing #app');

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

// The platform (device probe, tier decision, renderer host, telemetry) and the engine (sim.worker, Rapier, the debug cube
// view on the host's scene). Skipped on the unsupported screen. WebGL2 failing as well shows the unsupported page.
async function boot(): Promise<void> {
  const container = document.createElement('div');
  container.id = 'dv-engine';
  document.body.append(container);
  const canvas = document.createElement('canvas');
  canvas.id = 'dv-engine-canvas';
  canvas.className = flags.debug ? 'dv-engine-canvas dv-engine-canvas--play' : 'dv-engine-canvas';
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

  // The XR emulation page and the GPU probe drive the host themselves, so the engine runs without a view there.
  const headless = flags.xrEmulate !== null || flags.probe !== null;
  const engine = await bootEngine({
    container,
    qa: QA,
    flags,
    host: platform.host,
    tier: platform.quality.tier.id,
    ...(flags.profile ? { profile: flags.profile } : {}),
    labels: { recovering: t('engine.recovering') },
    headless,
  }).catch((error: unknown) => {
    console.error('engine failed to start', error);
    return null;
  });
  if (engine) platform.bindEngine({ setPaused: (p) => engine.setPaused(p), resetClock: () => engine.resetClock() });

  // QA builds only: window.__dvBridge. The literal comparison lets production builds drop the branch.
  if (import.meta.env.VITE_DV_QA === '1') {
    const [{ installEngineBridge }, { installPlatformBridge }] = await Promise.all([
      import('@dv/engine/client/debug/bridge'),
      import('@dv/engine/platform/probe'),
    ]);
    if (engine) installEngineBridge(engine);
    document.documentElement.dataset.dvEngine = 'ready';
    const bridge = installPlatformBridge(platform, flags);
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
