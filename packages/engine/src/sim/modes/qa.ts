/**
 * The QA commands of the mode host (M04a2, `debug.modes`): the registry listing, the host state, the unlock helper, `?unlockAll`, and
 * wallet entries with QA keys. Installed by the QA worker entry only (`sim-worker-core.ts` behind `VITE_DV_QA`), so the production
 * sim bundle has none of it and `verify-dist` greps for `modes.reply.`.
 */
import type { ModesQaHandler } from './index.ts';

export const runModesQa: ModesQaHandler = (cx, cmd, send) => {
  const { host, economy, unlocks } = cx;
  const answer = (data: unknown): void => send(`modes.reply.${cmd.id}`, data);
  const a = (cmd.args ?? {}) as Record<string, unknown>;
  switch (cmd.op) {
    case 'list':
      answer({ ok: true, modes: host.list() });
      break;
    case 'state':
      answer({
        ok: true,
        host: host.observe(),
        balance: economy.balance(),
        ledger: economy.ledgerSize,
        unlockAll: unlocks.unlockAll,
        autosaves: host.autosave.log.slice(-20),
        refusals: host.refusals,
        telemetry: cx.telemetry.slice(-20),
        backlog: cx.ui?.backlog ?? 0,
        capability: host.observe().capability,
      });
      break;
    case 'unlock':
      answer({ ok: true, isNew: typeof a['id'] === 'string' && /^unlock\.[a-z0-9._]{1,60}$/.test(a['id']) ? unlocks.emit(a['id'] as `unlock.${string}`, { kind: 'debug', ref: 'qa' }) : false });
      break;
    case 'unlockAll':
      answer({ ok: true, took: host.setUnlockAll(a['on'] !== false) });
      break;
    case 'startQa': {
      // Starts a mode that is still `comingSoon` (QA builds only): `{id, params}`. Tycoon uses it (M09a1); racing has its own `racing.start`.
      const id = a['id'];
      const params = a['params'];
      answer(typeof id === 'string' ? host.startQa(id as never, (params ?? undefined) as never) : { ok: false, reason: 'startQa needs an id' });
      break;
    }
    case 'credit':
      answer({ ok: typeof a['cents'] === 'number' && typeof a['key'] === 'string' ? economy.credit(a['cents'], 'qa', a['key']) : false, balance: economy.balance() });
      break;
    case 'debit':
      answer({ ok: typeof a['cents'] === 'number' && typeof a['key'] === 'string' ? economy.debit(a['cents'], 'qa', a['key']) : false, balance: economy.balance() });
      break;
    default:
      // an op with a dot belongs to another module (`racing.start`); it answers under the same reply name
      if (cmd.op.includes('.')) return;
      answer({ ok: false, reason: `unknown op ${cmd.op}` });
  }
};
