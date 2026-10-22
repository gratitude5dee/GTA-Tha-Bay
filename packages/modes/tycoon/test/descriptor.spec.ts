/** M09a2 AC-12 (build flavours): `status` is `available` in a QA build and `comingSoon` in any other; the sim half is unchanged. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tycoonDescriptor } from '../src/descriptor.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('tycoon descriptor status', () => {
  it('a production build (no VITE_DV_QA) shows comingSoon', () => {
    vi.stubEnv('VITE_DV_QA', '');
    expect(tycoonDescriptor().status).toBe('comingSoon');
    vi.stubEnv('VITE_DV_QA', '0');
    expect(tycoonDescriptor().status).toBe('comingSoon');
  });

  it('a QA build (VITE_DV_QA=1) is available, behind the unlock', () => {
    vi.stubEnv('VITE_DV_QA', '1');
    const d = tycoonDescriptor();
    expect(d.status).toBe('available');
    expect(d.unlock).toBe('unlock.tycoon');
    expect(d.standalone).toBe(true);
    expect(d.id).toBe('tycoon');
  });
});
