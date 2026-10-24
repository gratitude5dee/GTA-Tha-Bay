/**
 * ADR-0031 consistency (M03a2, AC-3): the `Decision:` line of the ADR, `SELECTED_WHEEL_PATH` and the `selected` of the
 * committed spike result (`golden/wheel-spike.json`, written by `wheel-spike.spec.ts` with `DV_UPDATE_GOLDEN=1`) must agree.
 * Also: only the selected implementation is reachable from `src` (no import of the losing file).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SELECTED_WHEEL_PATH } from '@dv/shared';

const ADR_DIR = new URL('../../../docs/decisions/', import.meta.url);
const SRC = new URL('../src/', import.meta.url);

function adrText(): string {
  const names = readdirSync(ADR_DIR).filter((n) => /^ADR-\d+-vehicle-wheel-force-path\.md$/.test(n));
  expect(names.length, 'exactly one ADR-*-vehicle-wheel-force-path.md').toBe(1);
  return readFileSync(new URL(names[0] as string, ADR_DIR), 'utf8');
}

function walk(dir: URL, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(new URL(`${e.name}/`, dir), out);
    else if (e.name.endsWith('.ts')) out.push(new URL(e.name, dir).pathname);
  }
}

describe('ADR-0031 vehicle wheel-force path', () => {
  it('its Decision: line equals SELECTED_WHEEL_PATH and the selected of the spike result', () => {
    const m = /^Decision: (castray|controller)\b/m.exec(adrText());
    expect(m, 'a "Decision: castray|controller" line').not.toBeNull();
    const golden = JSON.parse(readFileSync(new URL('./golden/wheel-spike.json', import.meta.url), 'utf8')) as { selected: string };
    expect(m?.[1]).toBe(SELECTED_WHEEL_PATH);
    expect(golden.selected).toBe(SELECTED_WHEEL_PATH);
  });

  it('records U-RAC-1 as verified or refuted and the proposed C06 1.2 member', () => {
    const t = adrText();
    expect(t).toMatch(/U-RAC-1[^\n]*(verified|refuted)/i);
    expect(t).toMatch(/applyWheelForces/);
    expect(t).toMatch(/proposed/i);
  });

  it('src imports only the selected wheel path', () => {
    const files: string[] = [];
    walk(SRC, files);
    const losing = SELECTED_WHEEL_PATH === 'castray' ? 'wheel-path-controller' : 'wheel-path-castray';
    for (const f of files) {
      expect(f.includes(losing), `${f} is the losing implementation`).toBe(false);
      expect(readFileSync(f, 'utf8'), f).not.toContain(losing);
    }
  });
});
