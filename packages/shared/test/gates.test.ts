import { describe, expect, it } from 'vitest';
import { assetRefOf, objectKey } from '../src/assets/c07.ts';
import { isCopyleft, judgeDependency, licenseAllowed } from '../src/assets/gates/license.ts';
import { editDistance, normalisedDistance, normalizeName } from '../src/assets/gates/names.ts';
import { isoBefore } from '../src/assets/gates/likeness.ts';
import { isBannedEndpoint, registryFindings, type GenAiRegistry } from '../src/genai/registry.ts';
import { isStringScanAllowlisted } from '../src/assets/gates/types.ts';
import registryJson from '../../../config/genai-endpoints.json' with { type: 'json' };

const registry = registryJson as unknown as GenAiRegistry;

describe('C07 helpers', () => {
  it('builds asset refs and validates ids', () => {
    expect(assetRefOf('ui', 'icon.main')).toBe('ui/icon.main');
    expect(() => assetRefOf('ui', 'Bad Id')).toThrow();
  });
  it('builds content-hashed object keys', () => {
    const sha = 'ab'.repeat(32);
    expect(objectKey('prop', 'lamp-01', 'mobile', sha, 'glb')).toBe('assets/prop/lamp-01/mobile.abababababab.glb');
    expect(objectKey('character', 'npc-one', 'desktop', sha, '.glb')).toBe('characters/npc-one/model/desktop.abababababab.glb');
    expect(objectKey('anim', 'npc-one.walk', 'default', sha, 'glb')).toBe('characters/npc-one/anim/default.abababababab.glb');
    expect(objectKey('audio_bark', 'x1', 'default', sha, 'opus')).toBe(`audio/barks/${sha}.opus`);
    expect(() => objectKey('prop', 'lamp-01', 'default', 'short', 'glb')).toThrow();
  });
});

describe('licence matching', () => {
  const allowed = ['MIT', 'Apache-2.0', 'LicenseRef-Vendor-*'];
  it('handles ids, wildcards and SPDX expressions', () => {
    expect(licenseAllowed('MIT', allowed)).toBe(true);
    expect(licenseAllowed('LicenseRef-Vendor-acme', allowed)).toBe(true);
    expect(licenseAllowed('GPL-3.0-only', allowed)).toBe(false);
    expect(licenseAllowed('(MIT OR GPL-3.0-only)', allowed)).toBe(true);
    expect(licenseAllowed('MIT AND GPL-3.0-only', allowed)).toBe(false);
    expect(licenseAllowed('', allowed)).toBe(false);
  });
  it('recognises the copyleft families', () => {
    for (const l of ['GPL-3.0-only', 'AGPL-3.0-or-later', 'LGPL-2.1', 'MIT OR GPL-2.0']) expect(isCopyleft(l)).toBe(true);
    for (const l of ['MIT', 'MPL-2.0', 'Apache-2.0', 'BSD-3-Clause']) expect(isCopyleft(l)).toBe(false);
  });
  it('judges dependencies by scope', () => {
    const policy = { prod: ['MIT'], devOnly: ['MPL-2.0'], exceptions: [{ package: 'bitecs', license: 'MPL-2.0', scope: 'prod' as const, reason: 'r' }] };
    expect(judgeDependency('a', 'MPL-2.0', 'dev', policy).ok).toBe(true);
    expect(judgeDependency('a', 'MPL-2.0', 'prod', policy).ok).toBe(false);
    expect(judgeDependency('bitecs', 'MPL-2.0', 'prod', policy).ok).toBe(true);
    expect(judgeDependency('x', 'GPL-3.0-only', 'dev', policy).rule).toBe('license-copyleft');
  });
});

describe('name distance', () => {
  it('normalises and measures', () => {
    expect(normalizeName('Zoë  Fixture-Name')).toBe('zoefixturename');
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(normalisedDistance('Alpha Beta', 'alpha-beta')).toBe(0);
    expect(normalisedDistance('abcd', 'wxyz')).toBe(1);
    expect(normalisedDistance('', '')).toBe(0);
  });
});

describe('small helpers', () => {
  it('compares ISO instants', () => {
    expect(isoBefore('2026-01-01T00:00:00Z', '2026-10-18T00:00:00Z')).toBe(true);
    expect(isoBefore('2027-01-01', '2026-10-18T00:00:00Z')).toBe(false);
  });
  it('applies the string-scan path allowlist', () => {
    expect(isStringScanAllowlisted('spec/a.md')).toBe(true);
    expect(isStringScanAllowlisted('config/ip-denylist.json')).toBe(true);
    expect(isStringScanAllowlisted('config/other.json')).toBe(false);
    expect(isStringScanAllowlisted('packages/ui/src/a.ts')).toBe(false);
  });
});

describe('genai registry (AC-8)', () => {
  it('has no findings', () => {
    expect(registryFindings(registry)).toEqual([]);
  });
  it('bans the required endpoints', () => {
    for (const id of ['minimax/h3-max/recast', 'bytedance/seedance-2.5/image-to-video', 'fal-ai/veo3', 'fal-ai/veo3/fast', 'acme/face-swap/v1']) {
      expect(isBannedEndpoint(registry, id), id).toBe(true);
    }
    expect(isBannedEndpoint(registry, 'fal-ai/minimax/voice-clone', 'voice_clone')).toBe(false);
    expect(isBannedEndpoint(registry, 'fal-ai/other/voice-clone', 'tts_draft')).toBe(true);
  });
  it('allows voice cloning only for the consented tier and keeps every video provider uncleared', () => {
    const clone = Object.values(registry.endpoints).filter((e) => e.role === 'voice_clone');
    expect(clone.map((e) => e.tiers)).toEqual([['consented']]);
    expect(Object.values(registry.videoProviders).some((p) => p.licence.status === 'cleared')).toBe(false);
    expect(registry.videoProviders['h3.partner']?.licence.status).toBe('pending');
    expect(registry.videoProviders['h3.maxTurbo']?.licence.status).toBe('blocked');
    expect(registry.videoProviders['h3.max']?.licence.status).toBe('blocked');
    expect(registry.defaults.videoFallbackOrder).toEqual(['ltx25.fast', 'gemini.omniFlash11']);
  });
  it('detects broken registries', () => {
    const bad = structuredClone(registry);
    bad.banned = bad.banned.filter((b) => b.id !== 'fal-ai/veo3');
    (bad.endpoints['fal-ai/minimax/voice-clone'] as { tiers: string[] }).tiers = ['consented', 'parody'];
    (bad.videoProviders['h3.max'] as { licence: { status: string } }).licence.status = 'cleared';
    expect(registryFindings(bad).map((f) => f.rule).sort()).toEqual(['banned-missing', 'video-provider-cleared', 'voice-clone-tiers']);
  });
});
