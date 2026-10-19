import type { AssetService } from './service.ts';
import type { FetchFn } from './store/fetch-retry.ts';

/**
 * Worker-side QA operations behind the `qa` RPC (VITE_DV_QA builds only; `asset.worker.ts` imports this file dynamically
 * behind that flag, so production bundles do not contain it). Fault injection, cap changes, store reopen and orphan files.
 */
interface FaultRule {
  status: number | 'network';
  times: number;
  match: string | null;
}

interface FaultState {
  rules: FaultRule[];
  installed: boolean;
}
const states = new WeakMap<AssetService, FaultState>();

function stateOf(svc: AssetService): FaultState {
  let s = states.get(svc);
  if (!s) {
    s = { rules: [], installed: false };
    states.set(svc, s);
  }
  return s;
}

function faultFetch(rules: FaultRule[], inner: FetchFn): FetchFn {
  return (url, init) => {
    for (const r of rules) {
      if (r.times <= 0 || (r.match !== null && !url.includes(r.match))) continue;
      r.times--;
      if (r.status === 'network') return Promise.reject(new TypeError('Failed to fetch (injected)'));
      return Promise.resolve(new Response(null, { status: r.status }));
    }
    return inner(url, init);
  };
}

export async function handleQa(svc: AssetService, name: string, args: unknown): Promise<unknown> {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'injectFaults': {
      const st = stateOf(svc);
      if (!st.installed) {
        svc.wrapFetch((inner) => faultFetch(st.rules, inner));
        st.installed = true;
      }
      const status = a['status'];
      if (status !== 'network' && typeof status !== 'number') throw new Error('injectFaults: status must be a number or "network"');
      const times = typeof a['times'] === 'number' ? a['times'] : 1;
      st.rules.push({ status, times, match: typeof a['match'] === 'string' ? a['match'] : null });
      return null;
    }
    case 'clearFaults':
      stateOf(svc).rules.length = 0;
      return null;
    case 'configure': {
      const cap = a['softCapBytes'];
      svc.setSoftCap(typeof cap === 'number' ? cap : null);
      return null;
    }
    case 'reopen':
      return svc.reopen(a['force'] === 'memory' ? 'memory' : undefined);
    case 'writeOrphan': {
      const sha = a['sha'];
      if (typeof sha !== 'string' || !svc.ports) throw new Error('writeOrphan: sha and an open store are required');
      await svc.ports.files.write(sha, new Uint8Array([0x6f, 0x72, 0x70, 0x68, 0x61, 0x6e]));
      return null;
    }
    case 'files':
      return svc.ports ? svc.ports.files.list() : [];
    case 'rows':
      return svc.ports ? svc.ports.index.all() : [];
    case 'removeFileOnly': {
      const sha = a['sha'];
      if (typeof sha !== 'string' || !svc.ports) throw new Error('removeFileOnly: sha and an open store are required');
      await svc.ports.files.remove(sha);
      return null;
    }
    case 'writePath':
      // 'sync' (createSyncAccessHandle) or 'writable' (the async fallback); null before the first write or on memory ports.
      return (svc.ports?.files as { lastWritePath?: string | null } | undefined)?.lastWritePath ?? null;
    case 'lanes':
      return { peak: { ...svc.lanes.peak }, limits: { ...svc.lanes.limits } };
    case 'settled':
      await svc.store.settled();
      return null;
    default:
      throw new Error(`unknown qa op: ${name}`);
  }
}
