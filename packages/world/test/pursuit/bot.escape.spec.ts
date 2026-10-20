/**
 * M03c AC-8 (first half): on the `synth` bake the scripted bot of the line `pursuit-escape` commits infractions to heat 3 (a robotaxi
 * witness), breaks the units' line of sight, drives out of the search circle and escapes through the cooldown to level 0 within the line's
 * duration. Only streams `pursuit` and `police` are drawn by the pursuit code (the clock's `weather` stream is the only other).
 */
import { describe, expect, it } from 'vitest';
import { loadBake } from '../fixtures/bake.ts';
import { loadLine, playPursuit, type PursuitRunResult } from '../fixtures/pursuit-run.ts';

const bake = loadBake('synth', 'pursuit.bot.escape');
const suite = bake ? describe : describe.skip;

suite('AC-8: pursuit-escape, the bot escapes', () => {
  let r: PursuitRunResult;

  it('plays the line: heat 3, a pursuit, no bust', async () => {
    if (!bake) return;
    r = await playPursuit({ bake });
    const line = loadLine();
    expect(r.ticks).toBe(line.ticks);
    expect(r.maxLevel).toBe(3);
    expect(r.peakUnits).toBeGreaterThanOrEqual(5);
    expect(r.events['pursuit.busted'] ?? 0).toBe(0);
    expect(r.stallTicks).toBeGreaterThanOrEqual(0);
  }, 240_000);

  it('escapes through the cooldown to level 0 within the line, and the units are gone by its end', () => {
    if (!bake) return;
    const line = loadLine();
    expect(r.events['pursuit.escaped']).toBe(1);
    expect(r.escapedAt).toBeGreaterThan(0);
    const last = r.trace[r.trace.length - 1];
    expect(last?.level).toBe(0);
    expect(last?.phase).toBe('clear');
    expect(last?.units).toBe(0);
    // the cooldown ran through the `cooldown` phase for at least the level's 35 s outside the circle
    const cool = r.trace.filter((t) => t.phase === 'cooldown').length;
    expect(cool).toBeGreaterThanOrEqual(30);
    expect(r.escapedAt - (r.trace[0]?.tick ?? 0)).toBeLessThanOrEqual(line.ticks);
    expect(r.driven).toBeGreaterThan(500);
  });

  it('draws only the pursuit and police streams (besides the clock)', () => {
    if (!bake) return;
    // `pursuit` is drawn for pedestrian report delays only; the line's witness is a robotaxi, so only `police` (the spawn picks) is certain
    expect(r.rngStreams).toContain('police');
    expect(r.rngStreams.filter((s) => s !== 'pursuit' && s !== 'police' && s !== 'weather')).toEqual([]);
  });
});
