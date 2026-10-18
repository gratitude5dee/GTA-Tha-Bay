import { collectDiagnosticSignals, formatDiagnostics, parseQaFlags } from '@dv/engine';
import { mountShell } from '@dv/ui';
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
