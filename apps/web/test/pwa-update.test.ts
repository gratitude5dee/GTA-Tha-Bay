import { describe, expect, it, vi } from 'vitest';
import {
  createPwaUpdateController,
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
