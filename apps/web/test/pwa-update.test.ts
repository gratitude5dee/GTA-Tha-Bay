import { describe, expect, it, vi } from 'vitest';
import {
  afterWindowLoad,
  createPwaUpdateController,
  isRegistration,
  SKIP_WAITING_MESSAGE,
  type ContainerLike,
  type RegistrationLike,
  type WorkerLike,
} from '../src/pwa-update.ts';

function mockWorker(state = 'installed') {
  const listeners: Array<() => void> = [];
  const worker: WorkerLike & { state: string; fire(): void } = {
    state,
    postMessage: vi.fn<(message: unknown) => void>(),
    addEventListener: (_type, fn) => {
      listeners.push(fn);
    },
    fire: () => listeners.forEach((fn) => fn()),
  };
  return worker;
}

function mockRegistration(initial: { waiting?: WorkerLike | null; installing?: WorkerLike | null } = {}) {
  const handlers: Array<() => void> = [];
  const reg: RegistrationLike & { waiting: WorkerLike | null; installing: WorkerLike | null; fireUpdateFound(): void } = {
    waiting: initial.waiting ?? null,
    installing: initial.installing ?? null,
    addEventListener: (_type, fn) => {
      handlers.push(fn);
    },
    fireUpdateFound: () => handlers.forEach((fn) => fn()),
  };
  return reg;
}

function mockContainer(controller: unknown = {}) {
  const once: Array<() => void> = [];
  const container: ContainerLike & { fireControllerChange(): void } = {
    controller,
    addEventListener: (_type, fn) => {
      once.push(fn);
    },
    fireControllerChange: () => once.splice(0).forEach((fn) => fn()),
  };
  return container;
}

describe('PwaUpdateController', () => {
  it('refuses to apply while unsafe, offers and applies after a safe point', async () => {
    const waiting = mockWorker();
    const container = mockContainer();
    const reload = vi.fn();
    const offers: boolean[] = [];

    const controller = createPwaUpdateController({ container, reload });
    controller.onChange((available) => offers.push(available));
    controller.markUnsafe();
    controller.attach(mockRegistration({ waiting }));

    expect(controller.updateAvailable).toBe(true);
    expect(offers).toEqual([]); // waiting, but not offered while unsafe

    await expect(controller.applyNow()).rejects.toThrow(/safe point/);
    expect(waiting.postMessage).not.toHaveBeenCalled();

    controller.markSafePoint('menu');
    expect(offers).toEqual([true]); // the toast shows

    await expect(controller.applyNow()).resolves.toBeUndefined();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: SKIP_WAITING_MESSAGE });

    expect(reload).not.toHaveBeenCalled();
    container.fireControllerChange();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('withdraws the offer when the game becomes unsafe again', () => {
    const offers: boolean[] = [];
    const controller = createPwaUpdateController({ container: mockContainer(), reload: vi.fn() });
    controller.onChange((available) => offers.push(available));
    controller.attach(mockRegistration({ waiting: mockWorker() }));
    controller.markUnsafe();
    controller.markSafePoint('mission-end');
    expect(offers).toEqual([true, false, true]);
  });

  it('applies while unsafe only when forced', async () => {
    const waiting = mockWorker();
    const controller = createPwaUpdateController({ container: mockContainer(), reload: vi.fn() });
    controller.attach(mockRegistration({ waiting }));
    controller.markUnsafe();
    await expect(controller.applyNow()).rejects.toThrow();
    await expect(controller.applyNow({ force: true })).resolves.toBeUndefined();
    expect(waiting.postMessage).toHaveBeenCalledTimes(1);
  });

  it('rejects when nothing is waiting', async () => {
    const controller = createPwaUpdateController({ container: mockContainer(), reload: vi.fn() });
    controller.attach(mockRegistration());
    expect(controller.updateAvailable).toBe(false);
    await expect(controller.applyNow()).rejects.toThrow(/no update/);
  });

  it('detects a worker that finishes installing after attach, but not the first install', () => {
    const installing = mockWorker('installing');
    const reg = mockRegistration();
    const withController = createPwaUpdateController({ container: mockContainer({}), reload: vi.fn() });
    withController.attach(reg);
    reg.installing = installing;
    reg.fireUpdateFound();
    installing.state = 'installed';
    reg.waiting = installing;
    installing.fire();
    expect(withController.updateAvailable).toBe(true);

    const first = mockWorker('installing');
    const firstReg = mockRegistration();
    const firstInstall = createPwaUpdateController({ container: mockContainer(null), reload: vi.fn() });
    firstInstall.attach(firstReg);
    firstReg.installing = first;
    firstReg.fireUpdateFound();
    first.state = 'installed';
    firstReg.waiting = null; // a first install activates directly, nothing waits
    first.fire();
    expect(firstInstall.updateAvailable).toBe(false);
  });
});

// BD-FIX-CI6-C01: the entry module awaits its preferences at top level, so the window can finish loading before it asks to register.
describe('afterWindowLoad', () => {
  function mockWindow() {
    const listeners: Array<{ fn: () => void; once: boolean }> = [];
    return {
      listeners,
      addEventListener: (_type: 'load', fn: () => void, opts?: { once?: boolean }) => {
        listeners.push({ fn, once: opts?.once === true });
      },
      fireLoad: () => listeners.forEach((l) => l.fn()),
    };
  }

  it('runs at once when the load event has already fired', () => {
    const win = mockWindow();
    const fn = vi.fn();
    afterWindowLoad({ readyState: 'complete' }, win, fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(win.listeners).toHaveLength(0);
  });

  it('waits for the load event while the document is still loading', () => {
    for (const readyState of ['loading', 'interactive']) {
      const win = mockWindow();
      const fn = vi.fn();
      afterWindowLoad({ readyState }, win, fn);
      expect(fn).not.toHaveBeenCalled();
      expect(win.listeners).toEqual([{ fn, once: true }]);
      win.fireLoad();
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });
});

describe('isRegistration (BD-FIX-CI8-G03)', () => {
  it('rejects what register() resolves with in a context that blocks service workers', () => {
    expect(isRegistration(undefined)).toBe(false);
    expect(isRegistration(null)).toBe(false);
    expect(isRegistration({})).toBe(false);
    expect(isRegistration({ addEventListener: () => undefined })).toBe(false);
  });

  it('accepts a registration with addEventListener and update', () => {
    expect(isRegistration({ waiting: null, installing: null, addEventListener: () => undefined, update: () => Promise.resolve() })).toBe(true);
  });
});
