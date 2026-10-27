/**
 * The sim.worker body: owns the world (ECS, physics, tick loop). It imports only `src/sim/**` (never `three` or the client).
 *
 * Start-up: the page posts one `init` message (config, boot payload, transport kind, the SharedArrayBuffers, optional transferred
 * ports). The worker attaches its transport end, loads exactly one Rapier build, builds the scenario, applies the domain modules
 * (`SimModule`, DL-651), tells the page `ready` and then waits for commands: `Atomics.waitAsync` on the SAB transport, `message`
 * events on the postMessage fallback.
 *
 * A failure inside the loop is reported as a `log` event and then rethrown from a timer so the page sees a worker
 * `error` event and runs its recovery (the "Recovering..." banner and a restart).
 *
 * M02b1 moved this body, unchanged, out of `sim.worker.ts` into `runSimWorker(scope, modules)`: the engine's own entry
 * (`sim.worker.ts`) passes no modules; `apps/web/src/workers/sim.worker.ts` passes the world streaming module. M05a1 adds the third
 * parameter: the story mode's sim wrapper (the engine never imports the mode packages).
 */
import { SimRuntime, type SimModule, type SimRuntimeEnv } from '../sim/runtime.ts';
import { isInitMessage, type InitMessage } from '../sim/sim-host.ts';
import { attachSabWorker } from '../sim/transport/sab-transport.ts';
import { attachPmWorker, type PortLike } from '../sim/transport/pm-transport.ts';
import type { WorkerTransport } from '../sim/transport/types.ts';
import { SaveControl } from '../sim/worker/save-control.ts';
import { createModesModule, defaultSandbox, defaultStory, type ModesModuleOptions, type SessionSlices } from '../sim/modes/index.ts';
import type { SaveServiceImpl } from '../sim/save/service.ts';

export interface WorkerScope extends PortLike {
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  setTimeout(fn: () => void, ms: number): number;
  postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
}

/** Starts the sim worker on `scope` (the worker's global scope; tests pass a stand-in). `modules` apply to the `SimRuntime` the game boots. */
export function runSimWorker(scope: WorkerScope, modules: readonly SimModule[], extras: Pick<ModesModuleOptions, 'descriptors' | 'unlockDefs' | 'wrapStory'> & {
  /** QA builds only: registers the QA parts of a mode package (its scenario loader, bot and command handler) before a QA run or boot. */
  qaSetup?: () => Promise<void>;
} = {}): void {
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => scope.setTimeout(resolve, ms));

  let started = false;
  let saveService: Promise<SaveServiceImpl> | null = null;
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

  function envFor(init: InitMessage, all: readonly SimModule[]): SimRuntimeEnv {
    const wait = new Int32Array(new SharedArrayBuffer(4));
    return {
      now: () => performance.now(),
      blockFor: (ms) => void Atomics.wait(wait, 0, 0, ms),
      qa: init.p.qa,
      exclusive: true,
      retry: { sleep, jitter: () => Math.random() },
      modules: all,
      ports: init.p.ports ?? {},
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

    // `?run=<RunSpec>` of the determinism page (M04d): one canonical run on sims the runner builds itself, like the branch above.
    if (import.meta.env.VITE_DV_QA === '1' && init.p.qa && boot.config['mode'] === 'qa-run') {
      await extras.qaSetup?.();
      const { runQaSpec } = await import('../qa/browser.ts');
      const post = (name: string, data: unknown): void => scope.postMessage({ v: 1, t: 'qa', seq: 0, p: { name, data } });
      try {
        post('trace', await runQaSpec(boot.config, { sleep, jitter: () => Math.random() }));
      } catch (e) {
        post('trace-error', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      }
      return;
    }

    if (import.meta.env.VITE_DV_QA === '1' && init.p.qa && boot.config['mode'] === 'save-kill') {
      const { runSaveKill } = await import('../sim/save/qa/save-kill.ts');
      const post = (name: string, data: unknown): void => scope.postMessage({ v: 1, t: 'qa', seq: 0, p: { name, data } });
      await runSaveKill(boot.config['phase'] === 'verify' ? 'verify' : 'loop', { post, sleep });
      return;
    }

    const transport: WorkerTransport = kind === 'sab' && sab ? attachSabWorker(sab) : attachPmWorker(scope);
    // The modes module (M04a2) goes last, so the world and pursuit modules it binds to have started when its `onInit` runs.
    const openSave = (): Promise<SaveServiceImpl> =>
      (saveService ??= (async () => {
        const { SaveServiceImpl } = await import('../sim/save/index.ts');
        return SaveServiceImpl.open({ buildId: import.meta.env.VITE_DV_BUILD ?? 'dev', worldBake: cfg.worldBake });
      })());
    const modes = createModesModule({
      ...(extras.wrapStory ? { wrapStory: extras.wrapStory } : {}),
      ...(extras.descriptors ? { descriptors: extras.descriptors } : {}),
      ...(extras.unlockDefs ? { unlockDefs: extras.unlockDefs } : {}),
      wallMs: () => Date.now(),
      // The open profile: `profileId` when the shell selects one, else the most recently saved (made when there is none; M04b1).
      loadSlices: async (profileId?: string): Promise<SessionSlices> => {
        const svc = await openSave();
        let list = await svc.listProfiles();
        if (list.length === 0) {
          const made = await svc.createProfile('Player 1');
          if ('id' in made) list = [made];
        }
        const recent = [...list].sort((a, b) => (b.lastSave?.at ?? b.updatedAt) - (a.lastSave?.at ?? a.updatedAt))[0];
        const pick = (profileId ? list.find((p) => p.id === profileId) : undefined) ?? recent;
        if (!pick) throw new Error('no profile');
        const game = await svc.load(pick.id);
        return {
          core: game.core,
          settings: game.settings,
          story: game.story.auto ?? defaultStory(),
          sandbox: game.sandbox ?? defaultSandbox(),
          profile: { id: pick.id, name: game.profile.name, hasStory: game.story.auto !== undefined },
          modes: game.modes,
        };
      },
    });
    const env = envFor(init, [...modules, modes]);
    // Lines the runtime and the modules log reach the page through the event ring (`SimHostOptions.onLog`).
    env.log = (level, message) => void transport.postEvent({ v: 1, t: 'log', seq: 0, p: { level, message } });
    const runtime = new SimRuntime(transport, env);

    if (import.meta.env.VITE_DV_QA === '1' && init.p.qa) {
      const { ScriptedBotInput, parseBotScript } = await import('../sim/input/bot-input.ts');
      if (boot.config['bot'] !== undefined) runtime.bot = new ScriptedBotInput(parseBotScript(boot.config['bot']));
      // `debug.bot` (QA): a script whose ticks count from the tick it arrives on
      runtime.botFactory = (script, base) => new ScriptedBotInput(script.map((seg) => ({ ...seg, from: seg.from + base, to: seg.to + base })));
      // `debug.line` (QA): the input-line player and recorder (M03a1)
      const [{ LinePlayer }, { LineRecorder }, { validateLine }] = await Promise.all([
        import('../sim/lines/player.ts'), import('../sim/lines/recorder.ts'), import('../sim/lines/format.ts'),
      ]);
      const recorder = new LineRecorder();
      const { qaInspector } = await import('../sim/qa/inspector.ts');
      runtime.inspector = qaInspector;
      runtime.vehicleQa = (await import('../sim/vehicle/debug.ts')).vehicleQa;
      // `debug.pursuit` (QA): the pursuit module's command handler (M03c)
      // `debug.modes` (QA): the mode host's command handler (M04a2)
      modes.installQa((await import('../sim/modes/qa.ts')).runModesQa);
      await extras.qaSetup?.();
      const pursuit = (env.modules ?? []).find((m) => m.id === 'engine.pursuit') as (SimModule & { installQa?(h: unknown): void }) | undefined;
      if (pursuit?.installQa) pursuit.installQa((await import('../sim/pursuit/qa.ts')).runPursuitQa);
      runtime.lineTools = {
        play: (line, base, probe) => new LinePlayer(validateLine(line), base, probe),
        startRecording: (meta) => recorder.begin(meta),
        record: (f) => recorder.record(f),
        get recording() {
          return recorder.recording;
        },
        stopRecording: () => recorder.end(),
      };
    }

    // C05: the control-message handler and write port. The SaveService opens on first use; the autosave policy of the modes
    // module (M04a2) decides what to collect, and answers 'not-eligible' (null) when no save is due.
    runtime.saveControl = new SaveControl({
      service: openSave,
      collect: (reason) => modes.collect(reason),
    });

    await runtime.boot(cfg, boot);
    scope.postMessage({ v: 1, t: 'ready', seq: 0, p: { physicsBuild: cfg.physicsBuild, transport: kind } });

    for (;;) {
      runtime.pump();
      const waiting = transport.waitForCommand();
      if (waiting) await waiting;
      else await sleep(4);
    }
  }
}
