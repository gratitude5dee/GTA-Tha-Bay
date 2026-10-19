import { SimButton } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { CONTROL_STATE } from '../src/sim/control/states.ts';
import { VAULT_TICKS } from '../src/sim/control/vault.ts';
import type { PhysicsSim } from '../src/sim/sim-factory.ts';
import { createGrayboxSim } from './graybox-helpers.ts';
import { frame, player } from './walk-sim.ts';

const SOUTH = 32768; // forward is +Z
const JUMP = 1 << SimButton.Jump;
const SPRINT = 1 << SimButton.Sprint;

/** A box across the player's path at z 70..72 whose top is `heightM` above the local ground (16.2 m). */
async function simWithBox(heightM: number): Promise<PhysicsSim> {
  return createGrayboxSim((s) => {
    const base = 15.0;
    const top = 16.2 + heightM;
    s.backend.addChunkStatics('test.box', { prisms: new Float32Array([4, base, top - base, 84, 70, 94, 70, 94, 72, 84, 72]) });
  });
}

interface RunResult { states: number[]; anims: number[]; minZ: number; maxZ: number; vaultStartTick: number; z: number; y: number }

/** Settles on the ground, runs south and presses Jump 0.8 m before the box; records the control state of every tick. */
async function runIntoBox(sim: PhysicsSim, sprint = false): Promise<RunResult> {
  sim.step(40);
  const states: number[] = [];
  const anims: number[] = [];
  let pressedAt = -1;
  let vaultStartTick = -1;
  let maxZ = 0;
  for (let i = 0; i < 360; i++) {
    const p = player(sim);
    const press = pressedAt < 0 && p.z > 69.2;
    if (press) pressedAt = sim.tick;
    sim.step(1, (tick) => frame({
      tick, moveY: -127, camYaw: SOUTH,
      buttons: sprint ? SPRINT : 0,
      pressed: press ? JUMP : 0,
    }));
    const q = player(sim);
    states.push(q.state);
    anims.push(q.anim);
    if (q.state === CONTROL_STATE.vault && vaultStartTick < 0) vaultStartTick = sim.tick - 1;
    maxZ = Math.max(maxZ, q.z);
    if (pressedAt >= 0 && sim.tick - pressedAt > 80) break;
  }
  const end = player(sim);
  return { states, anims, minZ: 0, maxZ, vaultStartTick, z: end.z, y: end.y };
}

describe('the vault (AC-6)', () => {
  it('a 1.0 m box is vaulted: state 120 for 24 ticks, anim 7, and the player ends beyond the box', async () => {
    const sim = await simWithBox(1.0);
    const r = await runIntoBox(sim);
    const vaulting = r.states.filter((s) => s === CONTROL_STATE.vault).length;
    expect(vaulting).toBe(VAULT_TICKS);
    expect(r.anims).toContain(7);
    expect(r.vaultStartTick).toBeGreaterThan(0);
    // The player never stopped at the box: it is past its far face (z 72) and standing on the ground again.
    expect(r.z).toBeGreaterThan(72.3);
    expect(r.y).toBeLessThan(17.0);
    // The 24 ticks are one block.
    const first = r.states.indexOf(CONTROL_STATE.vault);
    expect(r.states.slice(first, first + VAULT_TICKS).every((s) => s === CONTROL_STATE.vault)).toBe(true);
    sim.dispose();
  });

  it('a sprinting player vaults too', async () => {
    const sim = await simWithBox(1.0);
    const r = await runIntoBox(sim, true);
    expect(r.states.filter((s) => s === CONTROL_STATE.vault).length).toBe(VAULT_TICKS);
    expect(r.z).toBeGreaterThan(72.3);
    sim.dispose();
  });

  it('a 1.4 m box blocks: no vault, and the player stays on this side', async () => {
    const sim = await simWithBox(1.4);
    const r = await runIntoBox(sim);
    expect(r.states).not.toContain(CONTROL_STATE.vault);
    expect(r.maxZ).toBeLessThan(70.0);
    sim.dispose();
  });

  it('a 3 m wall blocks as well', async () => {
    const sim = await simWithBox(3.0);
    const r = await runIntoBox(sim);
    expect(r.states).not.toContain(CONTROL_STATE.vault);
    expect(r.maxZ).toBeLessThan(70.0);
    sim.dispose();
  });

  it('a 0.3 m kerb is stepped over, not vaulted', async () => {
    const sim = await simWithBox(0.3);
    const r = await runIntoBox(sim);
    expect(r.states).not.toContain(CONTROL_STATE.vault);
    expect(r.maxZ).toBeGreaterThan(72.3);
    sim.dispose();
  });

  it('the vault state survives a checkpoint: restoring mid-vault replays the same hashes', async () => {
    const sim = await simWithBox(1.0);
    sim.step(40);
    let snap: Uint8Array | null = null;
    let pressed = false;
    const input = (tick: number) => {
      const p = player(sim);
      const press = !pressed && p.z > 69.2;
      if (press) pressed = true;
      return frame({ tick, moveY: -127, camYaw: SOUTH, pressed: press ? JUMP : 0 });
    };
    let inVault = 0;
    for (let i = 0; i < 300; i++) {
      sim.step(1, input);
      if (player(sim).state === CONTROL_STATE.vault && ++inVault === 10) {
        snap = sim.snapshot();
        break;
      }
    }
    expect(snap).not.toBeNull();
    const hashes: string[] = [];
    const replay = (): string[] => {
      const out: string[] = [];
      for (let i = 0; i < 40; i++) {
        sim.step(1, (tick) => frame({ tick, moveY: -127, camYaw: SOUTH }));
        out.push(sim.hash());
      }
      return out;
    };
    hashes.push(...replay());
    sim.restore(snap as Uint8Array);
    expect(replay()).toEqual(hashes);
    sim.dispose();
  });
});
