import { describe, expect, it } from 'vitest';
import { InMemoryDataPort } from '../../src/data-port.memory.ts';
import { NotImplementedError } from '../../src/data-port.ts';
import { runDataPortContract } from './contract.ts';

// AC-5: the same contract suite the Supabase implementation runs.
runDataPortContract('InMemoryDataPort', () => Promise.resolve({ port: new InMemoryDataPort({ env: 'test' }), env: 'test' }));

describe('InMemoryDataPort', () => {
  it('seeds the catalog from catalogKeys', async () => {
    const port = new InMemoryDataPort({ catalogKeys: ['a'.repeat(64)] });
    expect(await port.cutscenes.inCatalog('a'.repeat(64))).toBe(true);
    expect(await port.cutscenes.inCatalog('b'.repeat(64))).toBe(false);
  });

  it('stamps its env on a ledger row that carries none', async () => {
    const port = new InMemoryDataPort({ env: 'staging' });
    await port.ledger.append([{ ts: 1, vendor: 'fal', model: 'm', kind: 'cutscene', usdMicros: 5, settled: true, jobId: 'j', env: '' }]);
    expect(port.ledgerRows()[0]?.env).toBe('staging');
  });

  it('a later member rejects instead of throwing synchronously', async () => {
    const port = new InMemoryDataPort();
    const call = port.roster.flags();
    await expect(call).rejects.toBeInstanceOf(NotImplementedError);
    await expect(call).rejects.toThrow('M06a1');
  });
});
