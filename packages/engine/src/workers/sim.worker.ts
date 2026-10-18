/**
 * sim.worker: owns the world (ECS, physics, tick loop). It imports only `src/sim/**` (never `three` or the client).
 *
 * Start-up: the page posts one `init` message (config, boot payload, transport kind, the SharedArrayBuffers). The worker
 * attaches its transport end, loads exactly one Rapier build, builds the scenario, tells the page `ready` and then
 * waits for commands: `Atomics.waitAsync` on the SAB transport, `message` events on the postMessage fallback.
 *
 * A failure inside the loop is reported as a `log` event and then rethrown from a timer so the page sees a worker
 * `error` event and runs its recovery (the "Recovering..." banner and a restart).
 */
import { SimRuntime, type SimRuntimeEnv } from '../sim/runtime.ts';
import { isInitMessage, type InitMessage } from '../sim/sim-host.ts';
import { attachSabWorker } from '../sim/transport/sab-transport.ts';
import { attachPmWorker, type PortLike } from '../sim/transport/pm-transport.ts';
import type { WorkerTransport } from '../sim/transport/types.ts';

interface WorkerScope extends PortLike {
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  setTimeout(fn: () => void, ms: number): number;
  postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
}

const scope = globalThis as unknown as WorkerScope;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => scope.setTimeout(resolve, ms));

let started = false;
scope.addEventListener('message', (ev) => {
  if (started || !isInitMessage(ev.data)) return;
  started = true;
  void run(ev.data).catch((e: unknown) => fail(e));
});

function fail(e: unknown): void {
  const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  try {
    scope.postMessage({ v: 1, t: 'error', seq: 0, p: { message } });
  } catch {
    // The page may already be gone.
  }
  // An uncaught error from a timer reaches the page's `error` listener on the Worker object.
  scope.setTimeout(() => {
    throw e instanceof Error ? e : new Error(message);
  }, 0);
}

function envFor(init: InitMessage): SimRuntimeEnv {
  const wait = new Int32Array(new SharedArrayBuffer(4));
  return {
    now: () => performance.now(),
    blockFor: (ms) => void Atomics.wait(wait, 0, 0, ms),
    qa: init.p.qa,
    exclusive: true,
    retry: { sleep, jitter: () => Math.random() },
  };
}

async function run(init: InitMessage): Promise<void> {
  const { cfg, boot, transport: kind, sab } = init.p;

  if (import.meta.env.VITE_DV_QA === '1' && init.p.qa && boot.config['mode'] === 'determinism') {
    const { runDeterminismSuite } = await import('../sim/qa/determinism-suite.ts');
    const post = (name: string, data: unknown): void => scope.postMessage({ v: 1, t: 'qa', seq: 0, p: { name, data } });
    const result = await runDeterminismSuite({
      now: () => performance.now(),
      retry: { sleep, jitter: () => Math.random() },
      progress: (stage, done, total) => post('progress', { stage, done, total }),
    });
    post('determinism', result);
    return;
  }

  const transport: WorkerTransport = kind === 'sab' && sab ? attachSabWorker(sab) : attachPmWorker(scope);
  const runtime = new SimRuntime(transport, envFor(init));

  if (import.meta.env.VITE_DV_QA === '1' && init.p.qa && boot.config['bot'] !== undefined) {
    const { ScriptedBotInput, parseBotScript } = await import('../sim/input/bot-input.ts');
    runtime.bot = new ScriptedBotInput(parseBotScript(boot.config['bot']));
  }

  await runtime.boot(cfg, boot);
  scope.postMessage({ v: 1, t: 'ready', seq: 0, p: { physicsBuild: cfg.physicsBuild, transport: kind } });

  for (;;) {
    runtime.pump();
    const waiting = transport.waitForCommand();
    if (waiting) await waiting;
    else await sleep(4);
  }
}
