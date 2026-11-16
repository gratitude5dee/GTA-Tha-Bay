/** M10d4 AC-7 (engine half): the part reader and the assembled creator figure (one skeleton, three skinned meshes, the face's 24 morph targets). */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Texture, type BufferAttribute } from 'three/webgpu';
import { HUMANOID_BONES } from '@dv/shared';
import { ASSEMBLY_TEXTURES_MAX, ASSEMBLY_TRIANGLES_MAX, assembleAvatar, classColor, type AssembledPart, type AssemblySlot } from '../src/client/avatar/assemble.ts';
import { parsePersonGlb, PersonGlbError } from '../src/client/avatar/person-glb.ts';

const repo = path.resolve(import.meta.dirname, '../../..');
const load = (id: string, variant = 'mobile'): ReturnType<typeof parsePersonGlb> => parsePersonGlb(new Uint8Array(readFileSync(path.join(repo, 'assets/src/character', id, `${variant}.glb`))));

const PARTS: [AssemblySlot, string][] = [
  ['body', 'pc-body-athletic'], ['face', 'pc-face-karl'], ['hair', 'pc-hair-waves'], ['top', 'pc-top-hoodie'], ['bottom', 'pc-bottom-jeans'], ['shoes', 'pc-shoes-boots'], ['accessory', 'pc-acc-cap'],
];
const COLORS = { skin: 0xc58c5f, hair: 0x2a1c14, top: 0x141414, bottom: 0x262c3f, shoes: 0x8b8e93, accessory: 0xaa3322 };
const parts = (): AssembledPart[] => PARTS.map(([slot, id]) => ({ slot, mesh: load(id) }));

describe('parsePersonGlb', () => {
  it('reads a skinned part: positions, dequantized normals and uv, joints below 22 and weights that sum to one', () => {
    const m = load('pc-top-hoodie');
    const n = m.position.length / 3;
    expect(n).toBeGreaterThan(100);
    expect(m.normal?.length).toBe(n * 3);
    expect(m.uv?.length).toBe(n * 2);
    expect(m.index.length % 3).toBe(0);
    for (let i = 0; i < n; i++) {
      const len = Math.hypot(m.normal?.[i * 3] as number, m.normal?.[i * 3 + 1] as number, m.normal?.[i * 3 + 2] as number);
      expect(len).toBeGreaterThan(0.95);
      expect(len).toBeLessThan(1.05);
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += m.weights?.[i * 4 + k] as number;
        expect(m.joints?.[i * 4 + k] as number).toBeLessThan(22);
      }
      expect(sum).toBeCloseTo(1, 5);
    }
    for (const u of m.uv as Float32Array) {
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
    }
    for (const i of m.index) expect(i).toBeLessThan(n);
  });

  it('reads the 24 sparse morph targets of a face with finite deltas', () => {
    const m = load('pc-face-haight');
    expect(m.targets).toHaveLength(24);
    expect(m.targets[0]?.name).toBe('morph_brow_height');
    expect(m.targets[23]?.name).toBe('morph_age');
    for (const t of m.targets) {
      expect(t.position.length).toBe(m.position.length);
      expect(t.position.every(Number.isFinite)).toBe(true);
    }
    expect(Math.max(...(m.targets[6]?.position ?? [0]).map(Math.abs))).toBeGreaterThan(0.005);
  });

  it('refuses a file that is not a GLB and a far figure keeps its gait attributes', () => {
    expect(() => parsePersonGlb(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]))).toThrow(PersonGlbError);
    const far = parsePersonGlb(new Uint8Array(readFileSync(path.join(repo, 'assets/src/prop/ped.far.a/mobile.glb'))));
    expect(far.swing?.length).toBe(far.position.length / 3);
    expect(far.pivot?.length).toBe(far.position.length / 3);
    expect(far.index.length / 3).toBeLessThanOrEqual(300);
  });
});

describe('assembleAvatar', () => {
  const tex = (): Texture => new Texture();

  it('builds one skeleton of the 22 bones shared by the skin, cloth and hair meshes', () => {
    const a = assembleAvatar({ parts: parts(), colors: COLORS, textures: { skin: tex(), cloth: tex(), hair: tex() } });
    expect(a.meshes.map((m) => m.name)).toEqual(['avatar.skin', 'avatar.cloth', 'avatar.hair']);
    expect(a.skeleton.bones.map((b) => b.name)).toEqual([...HUMANOID_BONES]);
    for (const m of a.meshes) expect(m.skeleton).toBe(a.skeleton);
    expect(a.heightM).toBeCloseTo(1.82, 2);
    a.dispose();
  });

  it('stays at or under 40,000 triangles and three textures', () => {
    const a = assembleAvatar({ parts: parts(), colors: COLORS, textures: { skin: tex(), cloth: tex(), hair: tex() } });
    expect(a.triangles).toBeGreaterThan(1000);
    expect(a.triangles).toBeLessThanOrEqual(ASSEMBLY_TRIANGLES_MAX);
    expect(a.textures).toBe(3);
    expect(a.textures).toBeLessThanOrEqual(ASSEMBLY_TEXTURES_MAX);
    a.dispose();
  });

  it('merges the face targets into the skin mesh and drives them by catalog id', () => {
    const a = assembleAvatar({ parts: parts(), colors: COLORS, morphs: { 'nose-length': 0.5 } });
    const skin = a.meshes[0];
    expect(a.morphNames).toHaveLength(24);
    expect(skin?.morphTargetInfluences).toHaveLength(24);
    const i = skin?.morphTargetDictionary?.['morph_nose_length'] as number;
    expect(skin?.morphTargetInfluences?.[i]).toBe(0.5);
    a.setMorphs({ 'nose-length': -1, smile: 1 });
    expect(skin?.morphTargetInfluences?.[i]).toBe(-1);
    expect(skin?.morphTargetInfluences?.[skin.morphTargetDictionary?.['morph_smile'] as number]).toBe(1);
    // the body vertices carry zero deltas: the first morph attribute is as long as the merged mesh and starts with the body's zeros
    const m0 = skin?.geometry.morphAttributes['position']?.[0] as BufferAttribute;
    expect(m0.count).toBe(skin?.geometry.getAttribute('position').count);
    expect(m0.getX(0)).toBe(0);
    a.dispose();
  });

  it('bakes the colours into the vertex colours and recolours without rebuilding', () => {
    const a = assembleAvatar({ parts: parts(), colors: COLORS });
    const cloth = a.meshes[1]?.geometry.getAttribute('color') as BufferAttribute;
    const before = [cloth.getX(0), cloth.getY(0), cloth.getZ(0)];
    a.setColors({ ...COLORS, top: 0xffffff, bottom: 0xffffff, shoes: 0xffffff, accessory: 0xffffff });
    const after = [cloth.getX(0), cloth.getY(0), cloth.getZ(0)];
    expect(after[0]).toBeGreaterThanOrEqual(before[0] as number);
    expect(after.some((v, k) => v !== before[k])).toBe(true);
    expect(classColor(4, 'top', COLORS)).toEqual([1, 1, 1]);
    expect(classColor(2, 'top', COLORS)[0]).toBeLessThan(classColor(1, 'top', COLORS)[0] + 1e-9);
    a.dispose();
  });

  it('builds without textures (the figure still draws, untextured) and without a face (no morphs)', () => {
    const a = assembleAvatar({ parts: parts().filter((p) => p.slot !== 'face'), colors: COLORS });
    expect(a.textures).toBe(0);
    expect(a.morphNames).toEqual([]);
    expect(a.meshes.length).toBe(3);
    a.dispose();
  });
});
