import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { InkRunner } from '../src/ink/ink-runner.ts';
import { npcTestInk, repoRoot } from './helpers.ts';

// M06a3 AC-10 (ink part) and the ink size line of the milestone: knots play, a missing knot falls back, the JSON stays small.
describe('InkRunner', () => {
  it('plays the five required knots of a shipped NPC', async () => {
    const r = await InkRunner.create(npcTestInk());
    expect(r.play('greeting')).toEqual([{ text: 'Good day. Please confirm the lot is clear.', tags: [] }]);
    expect(r.play('smalltalk')[0]?.text).toBe('Noted. The forecast on the clipboard says clear.');
    expect(r.play('busy')[0]?.text).toContain('item four');
    expect(r.play('deflect')[0]?.text).toContain('outside the script');
    expect(r.play('farewell')[0]?.text).toBe('Checklist complete. Good day.');
    for (const k of ['greeting', 'smalltalk', 'busy', 'deflect', 'farewell'] as const) expect(r.has(k)).toBe(true);
  });

  it('plays a knot again and again with the same lines', async () => {
    const r = await InkRunner.create(npcTestInk());
    expect(r.play('greeting')).toEqual(r.play('greeting'));
    expect(r.play('farewell')).toEqual(r.play('farewell'));
    expect(r.play('greeting')).toEqual(r.play('greeting'));
  });

  it('accepts the compiled story as parsed JSON too', async () => {
    const r = await InkRunner.create(JSON.parse(npcTestInk()) as object);
    expect(r.play('greeting')).toHaveLength(1);
  });

  it('falls back from a mission knot the story does not define to smalltalk, then greeting, then busy', async () => {
    const r = await InkRunner.create(npcTestInk());
    expect(r.has('mission_m_first_talk_boss')).toBe(false);
    expect(r.resolve('mission_m_first_talk_boss')).toBe('smalltalk');
    expect(r.play('mission_m_first_talk_boss')).toEqual(r.play('smalltalk'));
  });

  it('plays nothing for a story that has none of the fallback knots', async () => {
    const r = await InkRunner.create(JSON.stringify({ inkVersion: 21, root: [['done', null], 'done', { other: ['^Only this.', '\n', 'end', null] }], listDefs: {} }));
    expect(r.resolve('smalltalk')).toBeNull();
    expect(r.play('smalltalk')).toEqual([]);
  });

  it('loads inkjs only when the first story is made', () => {
    const src = readFileSync(path.join(import.meta.dirname, '../src/ink/ink-runner.ts'), 'utf8');
    expect(src).not.toMatch(/^import .* from 'inkjs/m);
    expect(src).toMatch(/import\('inkjs'\)/);
  });

  it('keeps the compiled ink of every shipped NPC under 50 KB', () => {
    const base = path.join(repoRoot, 'assets/src/data');
    const dirs = readdirSync(base).filter((d) => d.startsWith('ink.'));
    expect(dirs.length).toBeGreaterThan(0);
    for (const d of dirs) expect(statSync(path.join(base, d, 'ink.json')).size, d).toBeLessThan(50 * 1024);
  });
});
