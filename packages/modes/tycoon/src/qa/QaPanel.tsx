/**
 * The QA text panel of Business Tycoon (M09a1; QA builds only): start a seeded run, issue commands, step a week, read the state, the
 * cap table and the state hash. Plain DOM through Preact; the player UI (dashboard, cap table, hiring board) arrives in M09b1.
 * Mounted by `installTycoonBridge()` behind `?tycoon=1`.
 */
import { render, type JSX } from 'preact';
import type { Command } from '@dv/shared/tycoon';
import type { TycoonView } from '../sim/TycoonModeSim.ts';

export interface PanelApi {
  start(seed: number): void;
  cmd(c: Command): void;
  step(n: number): void;
  speed(n: 1 | 2 | 4): void;
  pause(on: boolean): void;
  abandon(): void;
  view(): TycoonView | null;
  /** Copies the run (setup and choices) as JSON text for replay elsewhere. */
  runJson(): string;
}

const usd = (cents: number): string => `${cents < 0 ? '-' : ''}$${Math.abs(Math.round(cents / 100)).toLocaleString('en-US')}`;

const CSS = `.dv-tycoon-qa{position:fixed;top:8px;right:8px;z-index:20;width:360px;max-height:94vh;overflow:auto;background:#101418ee;color:#e8eef4;font:13px/1.35 ui-monospace,Menlo,monospace;border:1px solid #3a4652;border-radius:6px;padding:8px}
.dv-tycoon-qa h2{margin:0 0 6px;font:600 14px system-ui,sans-serif}
.dv-tycoon-qa button{font:inherit;margin:2px 3px 2px 0;padding:3px 7px;background:#26323d;color:inherit;border:1px solid #56687a;border-radius:4px;cursor:pointer}
.dv-tycoon-qa button:hover{background:#34475a}
.dv-tycoon-qa input{font:inherit;width:90px;background:#0b0e11;color:inherit;border:1px solid #56687a;border-radius:4px;padding:2px 4px}
.dv-tycoon-qa table{border-collapse:collapse;width:100%}.dv-tycoon-qa td{padding:1px 4px;border-bottom:1px solid #26323d}
.dv-tycoon-qa td:first-child{color:#8fa3b5}.dv-tycoon-qa .hash{word-break:break-all;color:#9be3a7}.dv-tycoon-qa .err{color:#ff9a8a}
.dv-tycoon-qa .note{color:#8fa3b5;font-size:12px}`;

function Panel({ api, view, seed, setSeed }: { api: PanelApi; view: TycoonView | null; seed: number; setSeed: (n: number) => void }): JSX.Element {
  const v = view;
  const rows: [string, string][] = v
    ? [
        ['week / phase', `${v.week} / ${v.phase}${v.awaiting ? ` (waiting: ${v.awaiting})` : ''}${v.paused ? ' (paused)' : ''}`],
        ['cash', usd(v.cash)],
        ['MRR / users', `${usd(v.mrr)} / ${v.users}`],
        ['team / runway', `${v.headcount} / ${v.runwayWeeks >= 999 ? 'profitable' : `${v.runwayWeeks} wk`}`],
        ['valuation ref', usd(v.valuationRef)],
        ['SAFEs / rounds', `${v.safes} / ${v.rounds}`],
        ['pool left / FD', `${v.poolAvailable.toLocaleString('en-US')} / ${v.totalFd.toLocaleString('en-US')}`],
        ['speed', `${v.speed}x   week clock ${v.weekTicks}/${v.weekTicksNeeded}`],
        ['choices', String(v.choices)],
      ]
    : [];
  const pool = v?.vcPool ?? [];
  const eng = v?.candidates.find((c) => c.role === 'eng');
  return (
    <div>
      <h2>Tycoon QA (AI investor sim · game ruleset, not financial advice)</h2>
      <div>
        seed <input type="number" value={seed} data-testid="tycoon-seed" onInput={(e) => setSeed(Number((e.currentTarget as HTMLInputElement).value) || 1)} />
        <button data-testid="tycoon-start" onClick={() => api.start(seed)}>Start run</button>
        <button data-testid="tycoon-abandon" onClick={() => api.abandon()}>Quit run</button>
      </div>
      <div>
        <button data-testid="tycoon-step1" onClick={() => api.step(1)}>Step 1 wk</button>
        <button data-testid="tycoon-step5" onClick={() => api.step(5)}>5 wk</button>
        <button data-testid="tycoon-step20" onClick={() => api.step(20)}>20 wk</button>
        <button onClick={() => api.speed(1)}>1x</button>
        <button onClick={() => api.speed(2)}>2x</button>
        <button onClick={() => api.speed(4)}>4x</button>
        <button onClick={() => api.pause(!(v?.paused ?? false))}>{v?.paused ? 'Resume' : 'Pause'}</button>
      </div>
      <div>
        <button data-testid="tycoon-alloc" onClick={() => api.cmd({ t: 'setAllocation', features: 60, refactor: 25, infra: 15 })}>Allocation 60/25/15</button>
        <button onClick={() => api.cmd({ t: 'setMarketing', perWeek: 20_000 })}>Marketing $200/wk</button>
        <button onClick={() => api.cmd({ t: 'setCrunch', on: true })}>Crunch on</button>
        <button onClick={() => api.cmd({ t: 'setCrunch', on: false })}>Crunch off</button>
      </div>
      <div>
        <button data-testid="tycoon-raise" onClick={() => api.cmd({ t: 'startRaise', kind: 'safe', targetCents: 15_000_000 })}>Start SAFE raise ($150k)</button>
        <button onClick={() => api.cmd({ t: 'startRaise', kind: 'seed', targetCents: 30_000_000 })}>Start seed raise ($300k)</button>
        {pool.map((id) => (
          <button key={id} onClick={() => api.cmd({ t: 'scheduleMeeting', vcId: id })}>meet {id.replace('vc-', '')}</button>
        ))}
      </div>
      {v?.meeting ? (
        <div>
          <div class="note">
            offer from {v.meeting.vcId}: {usd(v.meeting.amount)} {v.meeting.preMoney > 0 ? `at ${usd(v.meeting.preMoney)}` : ''} (the envelope midpoint)
          </div>
          <button data-testid="tycoon-accept" onClick={() => api.cmd({ t: 'accept', meetingId: v.meeting?.id ?? '' })}>Accept</button>
          <button onClick={() => api.cmd({ t: 'walk', meetingId: v.meeting?.id ?? '' })}>Walk</button>
        </div>
      ) : null}
      <div>
        {eng ? <button onClick={() => api.cmd({ t: 'hireOffer', candidateId: eng.id, salaryYr: eng.askYr, optionBp: 50 })}>Offer eng {eng.id} ({usd(eng.askYr)}/yr)</button> : null}
        <button onClick={() => api.cmd({ t: 'boardVote', motion: 'approveBudget' })}>Board: approve</button>
        <button onClick={() => api.cmd({ t: 'bridge', accept: true })}>Bridge: accept</button>
        <button onClick={() => api.cmd({ t: 'exploreSale' })}>Explore sale</button>
      </div>
      <table data-testid="tycoon-state">
        <tbody>
          {rows.map(([k, val]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{val}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {v ? (
        <table data-testid="tycoon-captable">
          <tbody>
            {v.holders.map((h) => (
              <tr key={h.id}>
                <td>{h.id}</td>
                <td>
                  {h.shares.toLocaleString('en-US')} ({((h.shares / Math.max(1, v.totalFd)) * 100).toFixed(2)} %)
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div class="note">No run yet. Press Start run.</div>
      )}
      {v?.result ? <div data-testid="tycoon-result">Run ended: {v.result.kind} ({v.result.win ? 'win' : 'loss'}), score {v.result.score}, founder payout {usd(v.result.founderPayoutCents)}</div> : null}
      {v?.lastError ? <div class="err">last command refused: {v.lastError}</div> : null}
      {v ? <div class="hash" data-testid="tycoon-hash">state hash {v.hash}{v.unverifiable ? ' (unverifiable)' : ''}</div> : null}
      <div>
        <button onClick={() => void navigator.clipboard?.writeText(api.runJson())}>Copy run JSON</button>
      </div>
    </div>
  );
}

/** Mounts the panel and polls the view model four times a second. Returns a function that removes it. */
export function mountTycoonPanel(host: Document, api: PanelApi): () => void {
  const style = host.createElement('style');
  style.textContent = CSS;
  const root = host.createElement('div');
  root.className = 'dv-tycoon-qa';
  root.dataset['testid'] = 'tycoon-qa';
  host.head.append(style);
  host.body.append(root);
  let seed = 1;
  let last = '';
  const draw = (): void => {
    const v = api.view();
    const key = JSON.stringify(v);
    if (key === last && root.childElementCount > 0) return;
    last = key;
    render(<Panel api={api} view={v} seed={seed} setSeed={(n) => (seed = n)} />, root);
  };
  draw();
  const timer = setInterval(draw, 250);
  return () => {
    clearInterval(timer);
    render(null, root);
    root.remove();
    style.remove();
  };
}
