import type { Platform } from '@dv/engine';
import type { EngineHandle } from '@dv/engine/client/boot';
import { readLastSave } from '@dv/engine/client/save-status';
import { SaveServiceImpl, type SlotInfo } from '@dv/engine/save';
import type { LastSaveStatus, PlatformSettings, ProfileId, QualityTierId, SlotId } from '@dv/shared';
import type { EnginePort, PlatformPort, SavesPort, SlotSummary, StorageInfo } from '@dv/ui';

/**
 * The adapters between the shell (`@dv/ui`, which imports no engine code) and the engine and platform objects. Kept in the app, so the
 * shell stays testable with fakes (BD-M04b1-02, BD-M04b1-03).
 */

const SLOTS: readonly SlotId[] = ['core', 'settings', 'sandbox', 'story:auto', 'story:1', 'story:2', 'story:3', 'mode:racing', 'mode:fighter', 'mode:tycoon'];

/**
 * Profile rows, slots, export and import on the page's own `SaveServiceImpl`. It never calls `load`, so it holds no session: it cannot
 * trip the sim's profile into read-only (writes are compare-and-swap, C05 rule 9), and the sim owns every slot write.
 */
export function createSavesPort(build: string): SavesPort {
  let service: Promise<SaveServiceImpl> | null = null;
  const open = (): Promise<SaveServiceImpl> => (service ??= SaveServiceImpl.open({ buildId: build }));
  let persistent = true;
  // The profile the latest as-new import made: its undo removes it (a replace import has C05's own undo).
  let lastAsNew: ProfileId | null = null;
  void open().then((s) => {
    persistent = s.persistent;
  });
  const slotInfo = async (id: ProfileId, slot: SlotId): Promise<SlotSummary | null> => {
    const info: SlotInfo | null = await (await open()).describeSlot(id, slot);
    return info ? { slot, gen: info.gen, savedAt: info.savedAt, bytes: info.bytes, fellBack: info.fellBack } : null;
  };
  return {
    get persistent() {
      return persistent;
    },
    list: async () => (await open()).listProfiles(),
    create: async (name) => (await open()).createProfile(name),
    rename: async (id, name) => (await open()).renameProfile(id, name),
    remove: async (id) => (await open()).deleteProfile(id),
    slots: async (id) => (await Promise.all(SLOTS.map((s) => slotInfo(id, s)))).filter((s): s is SlotSummary => s !== null),
    usage: async (id) => (await Promise.all(SLOTS.map((s) => slotInfo(id, s)))).reduce((n, s) => n + (s?.bytes ?? 0), 0),
    exportProfile: async (id) => (await open()).exportProfile(id),
    importProfile: async (b, mode, into) => {
      const svc = await open();
      const r = await svc.importProfile(b, mode, into);
      if (r.ok && mode === 'asNew') lastAsNew = svc.lastImport?.profileId ?? null;
      return r;
    },
    undoImport: async (id) => {
      const svc = await open();
      if (id === lastAsNew) {
        lastAsNew = null;
        return svc.deleteProfile(id);
      }
      return svc.undoImport(id);
    },
    canUndo: (id) => id === lastAsNew,
    lastSave: async (id): Promise<LastSaveStatus | null> => (await readLastSave(id))?.status ?? null,
  };
}

export function createEnginePort(engine: EngineHandle): EnginePort {
  return {
    vm: engine.vm,
    sendUi: (cmd) => engine.sendUi(cmd),
    activeDevice: () => engine.router?.active ?? 'kbm',
    audioUnlock: () => engine.audioUnlock(),
  };
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

/** The device-scoped side: `PlatformSettings` in `dv-platform`, the quality service, storage, and the install prompt. */
export function createPlatformPort(platform: Platform, emit: (name: 'ui.page' | 'ui.onboard', props: Record<string, string | number | boolean>) => void): PlatformPort {
  let current: PlatformSettings = platform.settings;
  let deferred: InstallPromptEvent | null = null;
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
  });
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  const cls = platform.profile.class;
  const deviceClass = cls === 'quest' || cls === 'avp' ? 'xr' : cls === 'iphone' || cls === 'ipad' || cls === 'android' ? 'mobile' : 'desktop';
  return {
    settings: () => current,
    update: async (patch) => {
      const next = { ...current, ...patch, v: 1 as const };
      const tierChanged = patch.tierOverride !== undefined && patch.tierOverride !== current.tierOverride;
      current = next;
      await platform.store.putSettings(next);
      if (patch.telemetryConsent) platform.telemetry.setConsent(patch.telemetryConsent);
      // An explicit tier is requested now and applies at the next safe point; "auto" is re-decided at the next boot.
      if (tierChanged && next.tierOverride !== 'auto') void platform.quality.setTier(next.tierOverride as QualityTierId, 'user-override').catch(() => undefined);
    },
    tierInfo: () => ({ tier: platform.quality.tier.id, source: platform.decision.source, backend: platform.backend }),
    tierChoices: () => (deviceClass === 'xr' ? ['xr-quest', 'xr-visionpro'] : deviceClass === 'mobile' ? ['mobile', 'mobile-low'] : ['desktop-ultra', 'desktop', 'mobile', 'mobile-low']),
    storage: async (): Promise<StorageInfo> => {
      try {
        const est = await navigator.storage.estimate();
        return { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted: (await navigator.storage.persisted?.()) ?? null };
      } catch {
        return { usage: 0, quota: 0, persisted: null };
      }
    },
    requestPersist: async () => (await navigator.storage.persist?.()) ?? false,
    applyConsent: (c) => platform.telemetry.setConsent(c),
    emit,
    deviceClass,
    xrCapable: platform.profile.xrCapable,
    install: {
      canPrompt: () => deferred !== null,
      prompt: async () => {
        const d = deferred;
        deferred = null;
        await d?.prompt();
      },
      isIos: ios,
      standalone,
    },
  };
}
