/**
 * AC-4 and AC-9 (M02e): the look modules fetch nothing and import no image, texture or loader: every pattern is computed in TSL,
 * so the milestone adds no download. Also no GLSL string and no `ShaderMaterial`, and `onBeforeCompile` nowhere (the M00 lint rules
 * say the same; this reads the files the milestone added).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = new URL('../src/client/look/', import.meta.url);
const postDir = new URL('../../engine/src/platform/post/', import.meta.url);
const files = (d: URL): { name: string; text: string }[] =>
  readdirSync(d).filter((f) => f.endsWith('.ts')).map((name) => ({ name, text: readFileSync(new URL(name, d), 'utf8') }));

const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('look.no-fetch', () => {
  const all = [...files(dir), ...files(postDir)];

  it('has the modules of the milestone', () => {
    const names = files(dir).map((f) => f.name);
    for (const n of ['config.ts', 'surfaces.ts', 'noise.ts', 'facade.ts', 'roof.ts', 'ground.ts', 'water.ts', 'sun.ts', 'sky-physical.ts', 'shadows.ts', 'look-view.ts', 'shots.ts', 'markings.ts', 'road-layout.ts']) expect(names).toContain(n);
    expect(files(postDir).map((f) => f.name).sort()).toEqual(['grade.ts', 'index.ts', 'levels.ts', 'nodes.ts', 'stack.ts']);
  });

  it.each(all.map((f) => [f.name, f.text] as const))('%s: no fetch, loader, image import or texture file', (_name, text) => {
    const code = stripComments(text);
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/Loader\b/);
    expect(code).not.toMatch(/from\s+['"][^'"]+\.(png|jpe?g|webp|ktx2|exr|hdr|svg)['"]/);
    expect(code).not.toMatch(/new\s+(Image|XMLHttpRequest)\b/);
    expect(code).not.toMatch(/createImageBitmap/);
    expect(code).not.toMatch(/texture\//);
  });

  it.each(all.map((f) => [f.name, f.text] as const))('%s: TSL only (no GLSL, ShaderMaterial or onBeforeCompile)', (_name, text) => {
    const code = stripComments(text);
    expect(code).not.toMatch(/ShaderMaterial|onBeforeCompile|gl_FragColor|#version|precision (high|medium|low)p/);
  });
});
