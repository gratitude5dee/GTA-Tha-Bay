import { collectDiagnosticSignals, formatDiagnostics, parseQaFlags } from '@dv/engine';
import { bootEngine } from '@dv/engine/client/boot';
import { mountShell, t } from '@dv/ui';
import './engine.css';
import { createPwaUpdateController } from './pwa-update.ts';

const BUILD = import.meta.env.VITE_DV_QA === '1' ? 'qa' : 'prod';
const flags = parseQaFlags(location.search);

const root = document.getElementById('app');
if (!root) throw new Error('missing #app');

const update = 'serviceWorker' in navigator
  ? createPwaUpdateController({ container: navigator.serviceWorker, reload: () => location.reload() })
  : null;

mountShell(root, {
  diagnostics: () => formatDiagnostics(collectDiagnosticSignals(BUILD)),
  unsupported: flags.unsupported,
  update,
  initialPath: location.pathname,
});

// The engine: sim.worker with one Rapier build, the transport, and the debug cube view in the page corner.
// Skipped on the unsupported screen. The GPU probe and the XR emulation page drive their own renderer, so the
// engine runs without a view there.
if (!flags.unsupported && typeof Worker !== 'undefined') {
  const host = document.createElement('div');
  host.id = 'dv-engine';
  document.body.append(host);
  bootEngine({
    container: host,
    qa: import.meta.env.VITE_DV_QA === '1',
    flags,
    ...(flags.profile ? { profile: flags.profile } : {}),
    labels: { recovering: t('engine.recovering') },
    headless: flags.xrEmulate !== null || flags.probe !== null,
  })
    .then(async (engine) => {
      // QA builds only: window.__dvBridge.engine. The literal comparison lets production builds drop the branch.
      if (import.meta.env.VITE_DV_QA === '1') {
        const { installEngineBridge } = await import('@dv/engine/client/debug/bridge');
        installEngineBridge(engine);
        document.documentElement.dataset.dvEngine = 'ready';
      }
    })
    .catch((error: unknown) => console.error('engine failed to start', error));
}

// QA builds only: the GPU and XR probe and window.__dvBridge. The literal comparison lets production
// builds drop the whole branch, including three and the IWER emulator.
if (import.meta.env.VITE_DV_QA === '1') {
  void import('@dv/engine/platform/probe').then(async ({ installPlatformBridge }) => {
    const bridge = installPlatformBridge(flags, () => {
      const canvas = document.createElement('canvas');
      canvas.id = 'dv-probe-canvas';
      canvas.width = 64;
      canvas.height = 64;
      canvas.hidden = true;
      document.body.append(canvas);
      return canvas;
    });
    if (flags.probe === 'gpu') {
      const result = await bridge.gpuProbe();
      console.info('dv-gpu-probe', JSON.stringify(result));
      document.documentElement.dataset.dvProbe = 'done';
    }
  });
}

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
