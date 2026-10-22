/**
 * Proves the lint rules fire. The banned sources live in strings (no fixture files are committed, so
 * `pnpm lint` on the repository stays clean) and go through the ESLint API with a filePath inside each
 * rule's glob.
 */
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../run.ts';

const eslint = new ESLint({ cwd: repoRoot });

const BANNED_SIM_SOURCE = `
import * as THREE from 'three';
export const a = Math.random();
export const b = Date.now();
export const c = 2 ** 3;
export const d = Math.sin(1);
export const e = performance.now();
export function f(o: Record<string, number>): number {
  let n = 0;
  for (const k in o) n += o[k] ?? 0;
  return n;
}
export const g = THREE;
`;

const GLSL_SOURCE = `
import { ShaderMaterial, RawShaderMaterial, Material } from 'three';
declare const glsl: (s: TemplateStringsArray) => string;
export const a = new ShaderMaterial({});
export const b = new RawShaderMaterial({});
export function c(m: Material): void {
  (m as unknown as { onBeforeCompile: () => void }).onBeforeCompile = () => {};
}
export const d = glsl\`void main() {}\`;
`;

async function lint(source: string, relPath: string) {
  const [result] = await eslint.lintText(source, { filePath: path.join(repoRoot, relPath) });
  return (result?.messages ?? []).filter((m) => m.ruleId !== null && !m.ruleId.startsWith('@typescript-eslint/'));
}

function has(messages: Awaited<ReturnType<typeof lint>>, ruleId: string, text: string): boolean {
  return messages.some((m) => m.ruleId === ruleId && m.message.includes(text));
}

describe('C02 determinism lint', () => {
  for (const file of [
    'packages/shared/src/__fixture__.ts',
    'packages/engine/src/sim/__fixture__.ts',
    'packages/modes/racing/src/sim/__fixture__.ts',
  ]) {
    it(`reports banned constructs in ${file}`, async () => {
      const messages = await lint(BANNED_SIM_SOURCE, file);
      expect(has(messages, 'no-restricted-properties', 'Math.random')).toBe(true);
      expect(has(messages, 'no-restricted-properties', 'Math.sin')).toBe(true);
      expect(has(messages, 'no-restricted-properties', 'performance.now')).toBe(true);
      expect(has(messages, 'no-restricted-globals', 'Date')).toBe(true);
      expect(has(messages, 'no-restricted-imports', 'three')).toBe(true);
      expect(has(messages, 'no-restricted-syntax', '**')).toBe(true);
      expect(has(messages, 'no-restricted-syntax', 'for...in')).toBe(true);
    });
  }

  it('exempts sim/save (async IO outside ticks)', async () => {
    const messages = await lint(BANNED_SIM_SOURCE, 'packages/engine/src/sim/save/__fixture__.ts');
    expect(messages).toEqual([]);
  });

  it('does not apply outside the sim scope', async () => {
    expect(await lint(BANNED_SIM_SOURCE, 'packages/engine/src/client/__fixture__.ts')).toEqual([]);
    expect(await lint(BANNED_SIM_SOURCE, 'packages/engine/test/__fixture__.ts')).toEqual([]);
    expect(await lint(BANNED_SIM_SOURCE, 'tools/ci/__fixture__.ts')).toEqual([]);
  });
});

describe('no-glsl-in-engine lint', () => {
  for (const file of ['packages/engine/src/platform/__fixture__.ts', 'packages/shared/src/__fixture__.ts']) {
    it(`reports GLSL constructs in ${file}`, async () => {
      const messages = await lint(GLSL_SOURCE, file);
      expect(has(messages, 'no-restricted-syntax', 'ShaderMaterial is not allowed')).toBe(true);
      expect(has(messages, 'no-restricted-syntax', 'RawShaderMaterial')).toBe(true);
      expect(has(messages, 'no-restricted-syntax', 'onBeforeCompile')).toBe(true);
      expect(has(messages, 'no-restricted-syntax', 'glsl templates')).toBe(true);
    });
  }

  it('does not apply outside packages/**', async () => {
    expect(await lint(GLSL_SOURCE, 'tools/ci/__fixture__.ts')).toEqual([]);
  });
});

// M02c2 (DL-676, DL-689): no map SDK in game or web code. The banned sources are strings importing modules that are not installed.
describe('map SDK import ban (DL-676)', () => {
  const MAPLIBRE = "import maplibregl from 'maplibre-gl';\nexport const m = maplibregl;\n";
  const MAPBOX = "import mapboxgl from 'mapbox-gl';\nimport { Draw } from '@mapbox/mapbox-gl-draw';\nexport const m = [mapboxgl, Draw];\n";
  const GOOGLE = "import { Loader } from '@googlemaps/js-api-loader';\nimport { TilesRenderer } from '3d-tiles-renderer';\nexport const m = [Loader, TilesRenderer];\n";
  const files = ['packages/world/src/client/__fixture__.ts', 'packages/ui/src/__fixture__.tsx', 'apps/web/src/__fixture__.ts'];

  for (const file of files) {
    it(`reports mapbox-gl, @mapbox/mapbox-gl-*, @googlemaps/* and 3d-tiles-renderer in ${file}`, async () => {
      expect(has(await lint(MAPBOX, file), 'no-restricted-imports', 'mapbox-gl')).toBe(true);
      const g = await lint(GOOGLE, file);
      expect(g.filter((m) => m.ruleId === 'no-restricted-imports').length).toBeGreaterThanOrEqual(2);
      expect(has(g, 'no-restricted-imports', '@googlemaps/*')).toBe(true);
    });
  }

  for (const file of ['packages/world/src/client/__fixture__.ts', 'packages/engine/src/client/__fixture__.ts', 'apps/web/src/__fixture__.ts']) {
    it(`reports maplibre-gl in ${file}`, async () => {
      expect(has(await lint(MAPLIBRE, file), 'no-restricted-imports', 'maplibre-gl')).toBe(true);
    });
  }

  it('reports the bans in sim code, where the determinism block has its own import list', async () => {
    const sim = 'packages/world/src/sim/__fixture__.ts';
    expect(has(await lint(MAPLIBRE, sim), 'no-restricted-imports', 'maplibre-gl')).toBe(true);
    expect(has(await lint(MAPBOX, sim), 'no-restricted-imports', 'mapbox-gl')).toBe(true);
  });

  it('keeps maplibre-gl allowed outside the game page packages (the web surfaces of M13b2) and the tools unrestricted', async () => {
    expect(has(await lint(MAPLIBRE, 'packages/ui/src/__fixture__.tsx'), 'no-restricted-imports', 'maplibre-gl')).toBe(false);
    expect(has(await lint(MAPBOX, 'tools/map/src/__fixture__.ts'), 'no-restricted-imports', 'mapbox-gl')).toBe(false);
  });
});
