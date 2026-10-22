import type {
  CoreSlice, EconomyApi, GameModeDescriptor, GameModeId, GameModeSim, JsonObject, ModeEnterArgs, ModeExitReason, ModeOrigin, ModeResult, ProfileSettings,
  SandboxSlice, SaveReason, SimEvent, SimEventBus, SimProfile, SlotId, StorySlice,
} from '@dv/shared';
import type { ModeSaveBinding } from '../save-port.ts';
import { AutosavePolicy, type AutosaveEntry, type AutosaveGameState } from './autosave.ts';
import { capabilityOfMode } from './capability-bind.ts';
import { createModeContext, type ContextPorts } from './context.ts';
import { ModeStack, canEmbed, entryProfile, type ModeState, type StackEntry } from './stack.ts';
import type { UnlockRegistryImpl } from './unlocks.ts';

/** The live data of the open profile. The slices are mutated in place; the autosave policy decides when they are written. */
export interface SessionSlices {
  core: CoreSlice;
  story: StorySlice;
  sandbox: SandboxSlice;
  settings: ProfileSettings;
  /** The open profile, when a SaveService supplied the slices (published as `sys.profile`; M04b1). */
  profile?: { id: string; name: string; hasStory: boolean };
}

export interface ModeHostDeps {
  descriptors: readonly GameModeDescriptor[];
  slices(): SessionSlices;
  /** The services a mode context is built from (the host adds `saveRequest` and `startChild`). */
  ports: Omit<ContextPorts, 'saveRequest' | 'startChild'>;
  save: ModeSaveBinding;
  unlocks: UnlockRegistryImpl;
  economy: EconomyApi;
  /** The profile the running session was started with. */
  sessionProfile(): SimProfile;
  /** Rule 3: a top-level mode whose profile differs asks the page to restart the sim behind loading. Never called mid-mission. */
  restart(profile: SimProfile, then: GameModeId): void;
  /** Heat, pursuit and mission state for the autosave policy and the safe-point rule. `running` is filled in by the host. */
  game(): Omit<AutosaveGameState, 'running'>;
  tick(): number;
  /** Wall-clock ms for `firstEncounters`; wall time never enters the sim, so the worker injects it. */
  wallMs(): number;
  seed(): number;
  /** Build with QA flags: `?unlockAll=1` is honoured only then. */
  qa: boolean;
}

export type StartResult =
  | { ok: true; pending?: 'restart' }
  | { ok: false; reason: 'unknown' | 'coming-soon' | 'locked' | 'busy' | 'unsafe' | 'depth' | 'embed' };

export interface ModeListing {
  id: GameModeId;
  titleKey: string;
  order: number;
  art: string;
  status: GameModeDescriptor['status'];
  unlocked: boolean;
  standalone: boolean;
}

export interface HostObservation {
  state: ModeState;
  stack: { id: GameModeId; state: ModeState; history: ModeState[] }[];
  capability: string | null;
  unlocks: string[];
}

/**
 * ModeHost (C06 1.1, rules 1 to 8): runs a stack of at most two modes through `Idle, Loading, Entering, Running, Exiting`, with
 * `Suspended` for a parent while its child runs. One top-level mode exists at a time. Nothing blocks: `start` queues the load of the
 * sim half and `tick` (SimStage.Script) enters the mode once the sim is imported and the boot assets are ready. The session's save
 * capability follows the top-level mode. A mode gets only the `ModeContext` built here; it never makes its own world, renderer,
 * camera or store.
 */
export class ModeHost {
  readonly stack = new ModeStack();
  readonly autosave: AutosavePolicy;
  private readonly byId = new Map<GameModeId, GameModeDescriptor>();
  private readonly ports: ContextPorts;
  private restartPending = false;
  private returnTo: GameModeId | null = null;
  private lastPublished = '';
  /** Every start that was refused, newest last (QA). */
  readonly refusals: { id: string; reason: string }[] = [];

  constructor(private readonly d: ModeHostDeps) {
    for (const desc of d.descriptors) this.byId.set(desc.id, desc);
    this.ports = {
      ...d.ports,
      saveRequest: (reason) => void this.autosave.request(reason),
      startChild: (parent, id, args) => this.startChild(parent, id, args),
    };
    this.autosave = new AutosavePolicy({
      tick: () => d.tick(),
      game: () => ({ ...d.game(), running: this.stack.root !== null && !this.restartPending }),
      entries: (reason) => this.entries(reason),
      binding: d.save,
    });
    d.save.setCapability(IDLE_CAPABILITY);
    // A mode ends itself with `ctx.events.emit({t: 'mode.exit.request', s: reason})`; every other event goes to the running mode.
    d.ports.events.on('*', (e) => this.route(e));
  }

  // ---------------------------------------------------------------- queries

  get state(): ModeState {
    return this.stack.state;
  }

  descriptor(id: GameModeId): GameModeDescriptor | undefined {
    return this.byId.get(id);
  }

  /** Every registered mode in tile order, with whether it can be started now. */
  list(): ModeListing[] {
    return [...this.byId.values()]
      .sort((a, b) => a.tile.order - b.tile.order)
      .map((m) => ({
        id: m.id,
        titleKey: m.titleKey,
        order: m.tile.order,
        art: m.tile.art,
        status: m.status,
        unlocked: m.unlock === null || this.d.unlocks.has(m.unlock),
        standalone: m.standalone,
      }));
  }

  observe(): HostObservation {
    return {
      state: this.state,
      stack: this.stack.entries.map((e) => ({ id: e.id, state: e.state, history: [...e.history] })),
      capability: this.d.save.capability,
      unlocks: this.d.unlocks.list(),
    };
  }

  // ---------------------------------------------------------------- starting

  /** `UiCommand mode.start`: a top-level entry (rules 1, 3). */
  start(id: GameModeId, params?: ModeEnterArgs['params']): StartResult {
    const desc = this.byId.get(id);
    if (!desc) return this.refuse(id, 'unknown');
    if (desc.status === 'comingSoon') {
      this.d.ports.ui.toast({ id: `mode:${id}`, kind: 'info', text: 'mode.comingSoon', params: { mode: id } });
      return this.refuse(id, 'coming-soon');
    }
    if (desc.unlock !== null && !this.d.unlocks.has(desc.unlock)) return this.refuse(id, 'locked');
    const root = this.stack.root;
    if (root) {
      // Story to experience at a safe point (C06 1.1 rule 3): save `story:auto`, leave story, start the experience, come back after.
      if (!(root.id === 'story' && id.startsWith('exp:'))) return this.refuse(id, 'busy');
      if (this.stack.depth > 1 || this.unsafe()) return this.refuse(id, 'unsafe');
      this.exitEntry(root, 'quit');   // saves `story:auto` with reason `modeExit`
      this.returnTo = 'story';
    }
    const profile = entryProfile(desc, this.d.sessionProfile());
    if (profile !== this.d.sessionProfile()) {
      if (this.unsafe()) return this.refuse(id, 'unsafe');
      this.restartPending = true;
    }
    const seed = this.d.seed();
    this.begin(desc, { ...(params !== undefined ? { params } : {}), origin: { kind: 'menu' }, seed }, null);
    this.d.save.setCapability(capabilityOfMode(id) ?? IDLE_CAPABILITY);
    if (this.restartPending) this.d.restart(profile, id);
    this.publish();
    return this.restartPending ? { ok: true, pending: 'restart' } : { ok: true };
  }

  /**
   * QA only (`qa` true): starts a top-level mode as it is, past `comingSoon`, the unlock and the profile restart, so a mode that is
   * not offered to players yet (racing in M07a1) can be driven by the bridge and the tests. A production host refuses.
   */
  startQa(id: GameModeId, params?: ModeEnterArgs['params']): StartResult {
    if (!this.d.qa) return this.refuse(id, 'unknown');
    const desc = this.byId.get(id);
    if (!desc) return this.refuse(id, 'unknown');
    // The QA play bypass (M04b1) may already have started a sandbox or story root: a QA start replaces it.
    const root = this.stack.root;
    if (root) {
      if (this.stack.depth > 1) return this.refuse(id, 'busy');
      this.exitEntry(root, 'quit');
    }
    this.begin(desc, { ...(params !== undefined ? { params } : {}), origin: { kind: 'menu' }, seed: this.d.seed() }, null);
    this.d.save.setCapability(capabilityOfMode(id) ?? IDLE_CAPABILITY);
    this.publish();
    return { ok: true };
  }

  /** `ModeContext.startChild` (rules 1, 2, 5). False when the child cannot run under this parent. */
  startChild(parentId: GameModeId, id: GameModeId, args: Omit<ModeEnterArgs, 'origin'>): boolean {
    const parent = this.stack.top;
    if (!parent || parent.id !== parentId || parent.state !== 'Running') return false;
    if (this.stack.depth >= 2) return false;
    const desc = this.byId.get(id);
    if (!desc || desc.status === 'comingSoon' || !canEmbed(desc, this.d.sessionProfile())) return false;
    const p = (args.params ?? {}) as JsonObject;
    const origin: ModeOrigin =
      parent.id === 'story'
        ? { kind: 'story', missionId: typeof p['missionId'] === 'string' ? p['missionId'] : '', hookId: typeof p['hookId'] === 'string' ? p['hookId'] : '' }
        : parent.args.origin;
    const hook = typeof p['unlockOnFirstEncounter'] === 'string' ? p['unlockOnFirstEncounter'] : null;
    parent.state = 'Suspended';
    parent.history.push('Suspended');
    this.begin(desc, { ...args, origin }, hook);
    this.publish();
    return true;
  }

  private begin(desc: GameModeDescriptor, args: ModeEnterArgs, hook: string | null): StackEntry {
    const entry: StackEntry = {
      id: desc.id,
      desc,
      args,
      ctx: createModeContext(this.ports, desc.id, args.origin),
      state: 'Loading',
      sim: null,
      failed: null,
      hookUnlock: hook,
      history: ['Loading'],
    };
    this.stack.push(entry);
    desc.sim().then(
      (m) => {
        entry.sim = m.default;
      },
      (e: unknown) => {
        entry.failed = e instanceof Error ? e.message : String(e);
      },
    );
    return entry;
  }

  // ---------------------------------------------------------------- running

  /** SimStage.Script, once per tick. */
  tick(): void {
    if (this.idleCoreRestore) {
      this.idleCoreRestore = false;
      if (!this.stack.root) this.d.save.setCapability(IDLE_CAPABILITY);
    }
    if (this.restartPending) return;
    for (const e of [...this.stack.entries]) {
      if (e.state === 'Loading') {
        if (e.failed !== null) {
          this.exitEntry(e, 'error');
          break;
        }
        if (e.sim && this.bootReady(e.desc)) this.enter(e, e.sim);
      } else if (e.state === 'Running') {
        this.guard(e, () => e.sim?.tick(e.ctx));
      } else if (e.state === 'Suspended') {
        this.guard(e, () => e.sim?.suspendedTick?.(e.ctx));
      }
    }
    this.autosave.onTick();
  }

  private bootReady(_d: GameModeDescriptor): boolean {
    return this.d.ports.assets.ready([]);
  }

  private enter(e: StackEntry, sim: GameModeSim): void {
    e.state = 'Entering';
    e.history.push('Entering');
    const isChild = this.stack.entries.indexOf(e) > 0;
    if (isChild && e.args.origin.kind === 'story') this.firstEncounter(e);
    try {
      sim.enter(e.ctx, e.args, this.sliceFor(e.desc));
      e.state = 'Running';
      e.history.push('Running');
      this.d.ports.telemetry.emit('mode.enter', { mode: e.id });
    } catch (err) {
      e.failed = err instanceof Error ? err.message : String(err);
      this.exitEntry(e, 'error');
    }
    this.publish();
  }

  /** Rule 5: the first entry of an embedded mode from story records the encounter, emits the hook's unlock, saves with `unlock` and toasts once. */
  private firstEncounter(e: StackEntry): void {
    const core = this.d.slices().core;
    if (core.firstEncounters[e.id] !== undefined) return;
    core.firstEncounters[e.id] = this.d.wallMs();
    const id = (e.hookUnlock ?? e.desc.unlock) as `unlock.${string}` | null;
    if (id) this.d.unlocks.emit(id, { kind: 'mode', ref: e.id });
    else this.autosave.request('unlock');
  }

  private sliceFor(d: GameModeDescriptor): JsonObject | null {
    const s = this.d.slices();
    if (d.saveSlot === 'story:auto') return s.story as unknown as JsonObject;
    if (d.saveSlot === 'sandbox') return s.sandbox as unknown as JsonObject;
    return null;
  }

  private guard(e: StackEntry, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      e.failed = err instanceof Error ? err.message : String(err);
      this.exitEntry(e, 'error');
    }
  }

  private route(ev: SimEvent): void {
    if (ev.t === 'mode.exit.request') {
      const top = this.stack.top;
      if (top?.state === 'Running') this.exitEntry(top, (ev.s as ModeExitReason | undefined) ?? 'completed');
      return;
    }
    const top = this.stack.top;
    if (top?.state === 'Running' && top.sim?.onEvent) {
      const sim = top.sim;
      this.guard(top, () => sim.onEvent?.(top.ctx, ev));
    }
  }

  // ---------------------------------------------------------------- leaving

  /** `UiCommand mode.quit`: the child (if any) leaves with `parentExit`, then the top-level mode with `quit`. */
  quit(): boolean {
    const root = this.stack.root;
    if (!root) return false;
    this.restartPending = false;
    const child = this.stack.entries[1];
    if (child) this.exitEntry(child, 'parentExit');
    this.exitEntry(root, 'quit');
    return true;
  }

  /** Ends the top mode with `reason`: a child returns to its parent, a top-level mode to `Idle`. */
  exitTop(reason: ModeExitReason): boolean {
    const top = this.stack.top;
    if (!top) return false;
    this.exitEntry(top, reason);
    return true;
  }

  private exitEntry(e: StackEntry, reason: ModeExitReason): ModeResult {
    const isRoot = this.stack.entries.indexOf(e) === 0;
    if (isRoot && this.stack.depth > 1) {
      const child = this.stack.entries[1];
      if (child) this.exitEntry(child, 'parentExit');
    }
    const wasRunning = e.sim !== null && e.history.includes('Running');
    e.state = 'Exiting';
    e.history.push('Exiting');
    let result: ModeResult = { outcome: 'abort' };
    if (wasRunning && e.sim) {
      try {
        result = e.sim.exit(e.ctx, reason);
      } catch (err) {
        reason = 'error';
        e.failed = err instanceof Error ? err.message : String(err);
      }
    }
    const cash = result.rewards?.cashCents;
    if (cash && cash > 0) this.d.economy.credit(cash, `mode:${e.id}`, `mode:${e.id}:${e.args.seed}:${this.d.tick()}`);
    if (e.id === 'fighter' && result.outcome === 'win') this.d.slices().core.stats.fightsWon++;
    if (wasRunning) this.d.ports.telemetry.emit('mode.exit', { mode: e.id, reason });
    if (isRoot && wasRunning) this.autosave.request('modeExit');
    this.stack.pop();
    e.history.push('Idle');
    if (isRoot) {
      this.d.save.setCapability(IDLE_CAPABILITY);
    } else {
      const parent = this.stack.top;
      if (parent) {
        parent.state = 'Running';
        parent.history.push('Running');
        this.d.ports.events.emit({ t: 'mode.childExit', tick: this.d.tick(), s: e.id, n: ['win', 'lose', 'finish', 'quit', 'abort'].indexOf(result.outcome) });
      }
    }
    this.publish();
    if (isRoot && this.returnTo) {
      const back = this.returnTo;
      this.returnTo = null;
      this.start(back);
    }
    return result;
  }

  // ---------------------------------------------------------------- saving

  /** The slots to write for `reason` from the running top-level mode, or null when there is none. */
  /**
   * Saves the `core` slice (the avatar) when no mode runs: the creator's Done happens in the menu, where the idle capability may not write
   * `core`. The capability is raised for this one post only (M04b2, BD-M04b2-03). While a mode runs the normal policy applies.
   */
  saveCore(): boolean {
    if (this.stack.root) return this.autosave.request('manual');
    // The write is flushed after this tick, so the idle capability comes back at the start of the next tick.
    this.d.save.setCapability('story');
    this.idleCoreRestore = true;
    return this.d.save.post('core', this.d.slices().core, 'manual').ok;
  }

  private idleCoreRestore = false;

  private entries(reason: SaveReason): AutosaveEntry[] | null {
    const s = this.d.slices();
    if (reason === 'settings') return [{ slot: 'settings', data: s.settings }];
    if (reason === 'unlock') return this.d.save.capability === 'story' ? [{ slot: 'core', data: s.core }] : null;
    const root = this.stack.root;
    if (!root || !root.sim) return root ? [] : null;
    const cap = this.d.save.capability;
    const own = (() => {
      try {
        return root.sim.saveSlice(root.ctx);
      } catch {
        return null;
      }
    })();
    const out: AutosaveEntry[] = [];
    if (cap === 'story') {
      out.push({ slot: 'core', data: s.core }, { slot: 'story:auto', data: own ?? s.story });
    } else if (cap === 'sandbox') {
      out.push({ slot: 'sandbox', data: own ?? s.sandbox });
    } else if (cap?.startsWith('standalone:')) {
      out.push({ slot: 'core', data: s.core });
      if (own && root.desc.saveSlot) out.push({ slot: root.desc.saveSlot as SlotId, data: own });
    } else if (cap?.startsWith('exp:') && own) {
      out.push({ slot: `mod:${cap.slice(4)}`, data: own });
    }
    return out;
  }

  // ---------------------------------------------------------------- misc

  /** QA `?unlockAll=1`: honoured only in a QA build, in memory only. Returns whether it took effect. */
  setUnlockAll(on: boolean): boolean {
    if (!this.d.qa) return false;
    this.d.unlocks.setUnlockAll(on);
    return true;
  }

  private unsafe(): boolean {
    const g = this.d.game();
    return g.pursuit || g.heat > 0 || g.mission;
  }

  private refuse(id: string, reason: Extract<StartResult, { ok: false }>['reason']): StartResult {
    this.refusals.push({ id, reason });
    if (this.refusals.length > 32) this.refusals.shift();
    return { ok: false, reason };
  }

  /** `sys.mode`: the state of the host and of each stack entry, for the shell and the QA bridge. */
  publish(): void {
    const v = { state: this.state, stack: this.stack.entries.map((e) => ({ id: e.id, state: e.state })) };
    const key = JSON.stringify(v);
    if (key === this.lastPublished) return;
    this.lastPublished = key;
    this.d.ports.ui.patch('sys.mode', v);
  }
}

/** With no mode running only settings may be written: `sandbox` allows `settings`, `sandbox` and `mod:*`, and nothing saves the others. */
const IDLE_CAPABILITY = 'sandbox' as const;

/** The `SimEventBus` of a session: events go to the subscribers at once and to `forward` (the page's event stream). */
export class ModeEventBus implements SimEventBus {
  private readonly subs = new Map<string, Set<(e: SimEvent) => void>>();

  constructor(private readonly forward: (e: SimEvent) => void) {}

  emit(e: SimEvent): void {
    for (const cb of [...(this.subs.get(e.t) ?? [])]) cb(e);
    for (const cb of [...(this.subs.get('*') ?? [])]) cb(e);
    this.forward(e);
  }

  on(t: string, cb: (e: SimEvent) => void): () => void {
    let set = this.subs.get(t);
    if (!set) this.subs.set(t, (set = new Set()));
    set.add(cb);
    return () => set.delete(cb);
  }
}

