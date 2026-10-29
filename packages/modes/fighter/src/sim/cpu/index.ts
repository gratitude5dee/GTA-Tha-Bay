/**
 * `CpuDriver` (FC10): the CPU opponent as a producer of one `FighterInput` per tick. It sees the opponent through `Perception`
 * (a delayed copy of public state), decides on even ticks every 4 to 8 frames (`decide`), and plays its choice through the macro
 * executor (`MacroPlayer`). It has its own seeded stream; the match buffer is only read. The CPU plays the Classic scheme: its
 * macros are motions and buttons, the same inputs a human has. Sim code under the C02 lint.
 */
import { Rng, splitmix32, fnv32 } from '@dv/shared';
import { FB } from '@dv/shared/fight';
import { FF, FIGHTER_BASE } from '@dv/shared/fight';
import type { AiProfile } from '@dv/shared/fight';
import type { CpuLevel } from '../../types.ts';
import { decide, type Decision } from './decide.ts';
import { AI_DIVISOR, DECISION_MIN, DECISION_SPREAD, DECISION_STEP, levelParams, reactionRange, type CpuLevelParams } from './levels.ts';
import { MacroPlayer, blockWord } from './macro.ts';
import { dirBits, type KitInfo, type MacroStep } from './moves.ts';
import { Perception } from './perception.ts';
import { enabledHabits } from './habits.ts';

export { CPU_LEVELS, levelParams } from './levels.ts';
export { DEFAULT_HABITS } from './habits.ts';
export { kitInfo } from './moves.ts';
export type { KitInfo, MoveInfo } from './moves.ts';

export interface CpuOptions {
  slot: 0 | 1;
  level: CpuLevel;
  seed: number;
  kit: KitInfo;
  oppKit: KitInfo;
  ai?: AiProfile;
}

export class CpuDriver {
  readonly slot: 0 | 1;
  readonly level: CpuLevel;
  readonly params: CpuLevelParams;
  readonly perception: Perception;
  private readonly macro = new MacroPlayer();
  private readonly rng: Rng;
  private readonly kit: KitInfo;
  private readonly oppKit: KitInfo;
  private readonly ai: AiProfile;
  /** The habits this level knows: the first 3 / 5 / 8 / 12 of the kit's list. */
  readonly habits: ReadonlySet<string>;
  /** How often each habit proposed the action that was played (QA and the level tests). */
  readonly habitCounts = new Map<string, number>();
  private nextAt = 0;
  /** Ticks at which a decision was made (QA and the tests; the last 256). */
  readonly decisionTicks: number[] = [];
  /** The last decision, and how many punish decisions the CPU has made. */
  last: Decision | null = null;
  punishes = 0;
  delay = 12;

  constructor(o: CpuOptions) {
    this.slot = o.slot;
    this.level = o.level;
    this.params = levelParams(o.level);
    this.kit = o.kit;
    this.oppKit = o.oppKit;
    this.ai = o.ai ?? o.kit.def.ai;
    this.habits = enabledHabits(this.ai.habits, this.params.habits);
    this.perception = new Perception(o.slot);
    this.rng = new Rng(splitmix32((o.seed ^ fnv32(`cpu:${o.slot}`)) | 0));
  }

  /** The word for this tick. Call once per tick, before `step`, with the tick counter of the match (`FM.Tick`). */
  input(buf: Int32Array, tick: number): number {
    this.perception.push(buf, tick);
    if (tick % AI_DIVISOR === 0 && tick >= this.nextAt) this.think(buf, tick);
    return this.macro.next();
  }

  private think(buf: Int32Array, tick: number): void {
    // A move or a motion in progress is played out; the next look comes two ticks later.
    if (this.macro.active) { this.nextAt = tick + 2; return; }
    const [lo, hi] = reactionRange(this.ai.reaction, this.params);
    this.delay = lo + Math.min(hi - lo, Math.trunc(this.rng.nextFloat() * (hi - lo + 1)));
    const percept = this.perception.at(tick, this.delay);
    const d = decide({
      me: this.slot, buf, kit: this.kit, oppKit: this.oppKit, ai: this.ai, level: this.params, rng: this.rng, percept, delay: this.delay,
      habits: this.habits,
    });
    this.last = d;
    if (d.habit !== '') this.habitCounts.set(d.habit, (this.habitCounts.get(d.habit) ?? 0) + 1);
    if (d.punish) this.punishes++;
    this.decisionTicks.push(tick);
    if (this.decisionTicks.length > 256) this.decisionTicks.shift();
    this.apply(d, buf);
    this.nextAt = tick + DECISION_MIN + DECISION_STEP * Math.min(DECISION_SPREAD - 1, Math.trunc(this.rng.nextFloat() * DECISION_SPREAD));
  }

  private apply(d: Decision, buf: Int32Array): void {
    const facing = buf[(FIGHTER_BASE[this.slot] as number) + FF.Facing] as number;
    const err = this.params.errorPct;
    switch (d.kind) {
      case 'idle': this.macro.setHold(0); break;
      case 'walkF': this.macro.setHold(dirBits(6, facing)); break;
      case 'walkB': this.macro.setHold(dirBits(4, facing)); break;
      case 'block': this.macro.setHold(blockWord(facing, false)); break;
      case 'crouchBlock': this.macro.setHold(blockWord(facing, true)); break;
      case 'jumpF': this.macro.start([{ d: 9, b: 0, n: 1 }], facing, 0, this.rng); break;
      case 'dashF': this.macro.start([{ d: 6, b: 0, n: 1 }, { d: 5, b: 0, n: 1 }, { d: 6, b: 0, n: 1 }], facing, err, this.rng); break;
      case 'dashB': this.macro.start([{ d: 4, b: 0, n: 1 }, { d: 5, b: 0, n: 1 }, { d: 4, b: 0, n: 1 }], facing, err, this.rng); break;
      case 'jumpIn': this.macro.start([{ d: 9, b: 0, n: 1 }, { d: 5, b: 0, n: 12 }, { d: 5, b: FB.MP, n: 2 }], facing, err, this.rng); break;
      case 'taunt': this.macro.start([{ d: 5, b: FB.TA, n: 2 }], facing, err, this.rng); break;
      case 'check': this.macro.start([{ d: 5, b: FB.MP | FB.MK, n: 2 }], facing, err, this.rng); break;
      case 'clear': this.macro.start([{ d: 5, b: FB.HP | FB.HK, n: 2 }], facing, err, this.rng); break;
      case 'move': {
        const m = this.kit.moves[d.move];
        if (!m) break;
        let steps: readonly MacroStep[] = d.ex && m.exMacro !== null ? m.exMacro : m.macro;
        // A charge move is held on its charge frame: a short, a medium or a long hold.
        if (m.charge) {
          const hold = [2, 18, 32][Math.min(2, Math.trunc(this.rng.nextFloat() * 3))] as number;
          const last = steps[steps.length - 1] as MacroStep;
          steps = [...steps.slice(0, -1), { ...last, n: hold }];
        }
        this.macro.start(steps, facing, err, this.rng);
        break;
      }
    }
  }

  /** Macro scripts started and how many of them were damaged or delayed by the level's execution error. */
  execStats(): { starts: number; errors: number } { return { starts: this.macro.starts, errors: this.macro.errors }; }

  /** Forgets everything (a new round or a rematch). */
  reset(): void {
    this.perception.reset();
    this.macro.clear();
    this.nextAt = 0;
    this.last = null;
  }
}
