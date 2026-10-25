/** Settings: Data and privacy, Install and storage, About (10-ui-pages.md section 2.9). */
import { lk } from '../../i18n/index.ts';
import type { ScreenDef, Widget } from '../../screen/types.ts';
import type { SettingsEnv } from './index.ts';

export function privacyScreen(env: SettingsEnv): ScreenDef {
  const later = lk('settings.later');
  return {
    id: 'settings-privacy',
    title: lk('settings.privacy'),
    children: [
      { k: 'heading', text: lk('settings.privacy'), level: 2 },
      { k: 'toggle', id: 'priv-diagnostics', label: lk('terms.diagnostics'), bind: { scope: 'device', path: 'telemetryConsent.diagnostics' } },
      { k: 'toggle', id: 'priv-analytics', label: lk('terms.analytics'), bind: { scope: 'device', path: 'telemetryConsent.analytics' } },
      { k: 'toggle', id: 'priv-camera', label: lk('settings.privacy.camera'), hint: lk('settings.privacy.camera.hint'), bind: { scope: 'profile', path: 'privacy.cameraFeatures' } },
      { k: 'text', text: lk('settings.privacy.age'), params: { status: env.ageStatus }, tone: 'muted' },
      { k: 'button', id: 'priv-export', label: lk('settings.privacy.export'), style: 'secondary', onPress: { nav: 'saves' } },
      { k: 'button', id: 'priv-account-export', label: lk('settings.privacy.accountExport'), style: 'secondary', disabled: later, onPress: { call: 'account.export' } },
      { k: 'button', id: 'priv-forget', label: lk('settings.privacy.forget'), style: 'danger', disabled: later, onPress: { call: 'account.forget' } },
      { k: 'button', id: 'priv-delete', label: lk('settings.privacy.delete'), style: 'danger', onPress: { call: 'delete-local' } },
    ],
  };
}

export function installScreen(env: SettingsEnv): ScreenDef {
  const used = env.storage ? Math.round(env.storage.usage / (1024 * 1024)) : 0;
  const quota = env.storage ? Math.round(env.storage.quota / (1024 * 1024)) : 0;
  const children: Widget[] = [{ k: 'heading', text: lk('settings.install'), level: 2 }];
  if (env.standalone) children.push({ k: 'text', text: lk('settings.install.installed'), tone: 'muted' });
  else if (env.ios) children.push({ k: 'text', text: lk('settings.install.ios'), tone: 'normal' });
  else if (env.installable) children.push({ k: 'button', id: 'install', label: lk('settings.install.button'), style: 'primary', onPress: { call: 'install' } });
  else children.push({ k: 'text', text: lk('settings.install.unavailable'), tone: 'muted' });
  children.push(
    { k: 'text', text: lk('settings.storage.usage'), params: { used, quota }, tone: 'muted' },
    { k: 'text', text: env.storage?.persisted ? lk('settings.storage.persisted') : lk('settings.storage.notPersisted'), tone: 'muted' },
    { k: 'button', id: 'persist', label: lk('settings.storage.persist'), style: 'secondary', onPress: { call: 'persist' } },
  );
  children.push(...offlineRows(env));
  return { id: 'settings-install', title: lk('settings.install'), children };
}

const MIB = 1024 * 1024;
/** Megabytes with one decimal, as text for a string parameter. */
export function mbText(bytes: number): string {
  return (bytes / MIB).toFixed(1);
}

/** The offline-download rows of Install and storage (M04b4): size, button, progress, result, caveat, downloaded, clear. */
function offlineRows(env: SettingsEnv): Widget[] {
  const o = env.offline ?? null;
  const plan = o?.plan ?? null;
  const job = o?.job ?? null;
  const running = job?.state === 'running';
  const out: Widget[] = [];
  out.push(
    plan
      ? { k: 'text', text: lk('settings.storage.offline.size'), params: { total: mbText(plan.totalBytes), missing: mbText(plan.missingBytes) }, tone: 'muted' }
      : { k: 'text', text: lk('settings.storage.offline.size.none'), tone: 'muted' },
  );
  let reason: string | null = null;
  let reasonParams: Record<string, string> | undefined;
  if (running) reason = lk('settings.storage.offline.disabled.running');
  else if (!plan) reason = lk('settings.storage.offline.disabled.size');
  else if (plan.store !== 'opfs') reason = lk('settings.storage.offline.disabled.store');
  else if (!plan.writable) reason = lk('settings.storage.offline.disabled.tab');
  else if (!plan.fits) {
    reason = lk('settings.storage.offline.disabled.space');
    reasonParams = { short: mbText(plan.shortfallBytes) };
  }
  out.push({
    k: 'button',
    id: 'offline',
    label: lk('settings.storage.offline'),
    style: 'secondary',
    onPress: { call: 'offline' },
    ...(reason ? { disabled: reason } : {}),
    ...(reasonParams ? { disabledParams: reasonParams } : {}),
  });
  if (running && job) {
    out.push(
      { k: 'progress', value: job.total > 0 ? job.done / job.total : 0, label: lk('settings.storage.offline.progress'), params: { done: job.done, total: job.total } },
      { k: 'text', text: lk('settings.storage.offline.progress'), params: { done: job.done, total: job.total }, tone: 'muted' },
      { k: 'button', id: 'offline-cancel', label: lk('settings.storage.offline.cancel'), style: 'secondary', onPress: { call: 'offline-cancel' } },
    );
  } else if (job) {
    if (job.state === 'done') out.push({ k: 'text', text: lk('settings.storage.offline.done'), tone: 'normal' });
    else if (job.state === 'cancelled') out.push({ k: 'text', text: lk('settings.storage.offline.stopped'), params: { done: job.done, total: job.total }, tone: 'normal' });
    else out.push({ k: 'text', text: job.reason === 'quota' ? lk('settings.storage.offline.failed.quota') : lk('settings.storage.offline.failed.other'), tone: 'warning' });
  }
  out.push(
    { k: 'text', text: lk('settings.storage.offline.caveat'), tone: 'muted' },
    {
      k: 'text',
      text: lk('settings.storage.offline.downloaded'),
      params: { mb: mbText(o?.downloaded.bytes ?? 0), files: o?.downloaded.files ?? 0 },
      tone: 'muted',
    },
  );
  const clearReason = !o
    ? lk('settings.storage.offline.disabled.size')
    : running
      ? lk('settings.storage.clear.disabled.running')
      : plan && !plan.writable
        ? lk('settings.storage.offline.disabled.tab')
        : null;
  out.push({ k: 'button', id: 'clear', label: lk('settings.storage.clear'), style: 'danger', onPress: { call: 'clear' }, ...(clearReason ? { disabled: clearReason } : {}) });
  return out;
}

export function aboutScreen(env: SettingsEnv): ScreenDef {
  return {
    id: 'settings-about',
    title: lk('settings.about'),
    children: [
      { k: 'heading', text: lk('settings.about'), level: 2 },
      { k: 'text', text: lk('common.build'), params: { build: env.build }, tone: 'muted' },
      { k: 'text', text: lk('settings.about.tier'), params: { tier: env.tierLine, backend: env.backend }, tone: 'muted' },
      { k: 'button', id: 'copy-tier', label: lk('settings.about.copyTier'), style: 'secondary', onPress: { call: 'copy-tier' } },
      env.updateReady
        ? { k: 'button', id: 'update', label: lk('update.apply'), style: 'primary', onPress: { call: 'update' } }
        : { k: 'text', text: lk('settings.about.upToDate'), tone: 'muted' },
      { k: 'button', id: 'licences', label: lk('settings.about.licences'), style: 'secondary', onPress: { nav: 'credits' } },
      { k: 'button', id: 'reset-ui', label: lk('settings.about.resetUi'), style: 'danger', onPress: { call: 'reset-ui' } },
    ],
  };
}
