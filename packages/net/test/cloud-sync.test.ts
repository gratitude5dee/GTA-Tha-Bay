import { afterEach, describe, expect, it, vi } from 'vitest';
import { NullCloudSync } from '../src/index.ts';

afterEach(() => vi.unstubAllGlobals());

describe('NullCloudSync', () => {
  it('AC-7: syncNow resolves zeros, status is off and fetch is never called', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const sync = new NullCloudSync();
    expect(sync.kind).toBe('null');
    expect(sync.status()).toBe('off');
    await expect(sync.syncNow()).resolves.toEqual({ pushed: 0, pulled: 0 });
    expect(sync.status()).toBe('off');
    const cb = vi.fn();
    const off = sync.onStatus(cb);
    off();
    expect(cb).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
