import { ClientAction, SimButton, type ControlsSettings, type JsonObject } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTROLS } from '../../src/client/input/defaults.ts';
import { ViewModelStore } from '../../src/client/ui/view-model-source.ts';
import { mergeControls, sanitizeOverrides } from '../../src/sim/input/remap-persist.ts';
import { freshSlices } from '../../src/sim/modes/index.ts';
import { CAM, makeRig as makeInputRig } from '../input-helpers.ts';
import { makeRig } from './fixture.ts';

const bit = (b: SimButton): number => 1 << b;

/** AC-6: `engine/modes.remap`. */
describe('controls remapping persistence (R-ENG-04)', () => {
  const controls = (overrides: ControlsSettings['overrides']): JsonObject => ({ ...DEFAULT_CONTROLS, overrides } as unknown as JsonObject);
  const rebind = controls({
    kbm: { onFoot: { 'sim.Jump': [{ control: 'key:KeyH' }], 'client.Pause': [] } },
  });

  it('save.settings stores the Jump override, drops the Pause unbind, saves the settings slot and publishes sys.controls', () => {
    const rig = makeRig();
    rig.dispatch({ t: 'save.settings', data: { controls: rebind } });
    const saved = rig.slices.settings.controls;
    expect(saved.overrides.kbm?.onFoot?.['sim.Jump']).toEqual([{ control: 'key:KeyH' }]);
    expect(saved.overrides.kbm?.onFoot?.['client.Pause']).toBeUndefined();
    const post = rig.posted.find((p) => p.slot === 'settings');
    expect(post?.reason).toBe('settings');
    expect((post?.data as { controls: ControlsSettings }).controls.overrides.kbm?.onFoot?.['sim.Jump']).toBeDefined();
    rig.ui.flushTick();
    const patch = rig.ui.takeOutbox()?.patches.find((p) => p.k === 'sys.controls');
    expect((patch?.v as unknown as ControlsSettings).overrides.kbm?.onFoot?.['sim.Jump']).toEqual([{ control: 'key:KeyH' }]);
  });

  it('after a reload the InputRouter holds the Jump override and Pause keeps its default binding', () => {
    const first = makeRig();
    first.dispatch({ t: 'save.settings', data: { controls: rebind } });
    // reload: a new session from what the save port was handed
    const stored = first.posted.filter((p) => p.slot === 'settings').at(-1)?.data as ReturnType<typeof freshSlices>['settings'];
    const slices = freshSlices();
    slices.settings = stored;
    const second = makeRig({ slices });
    second.ui.patch('sys.controls', slices.settings.controls as unknown as JsonObject);
    second.ui.flushTick();
    const vm = new ViewModelStore();
    vm.apply(second.ui.takeOutbox()?.patches ?? []);
    const applied = vm.get<JsonObject>('sys.controls') as unknown as ControlsSettings;

    const rig = makeInputRig();
    const seen: string[] = [];
    rig.router.onClientAction((a, phase) => seen.push(`${a}:${phase}`));
    rig.router.setOverrides(applied);
    rig.tap('KeyH');
    const f = rig.router.sample(1, CAM);
    expect(f.pressed & bit(SimButton.Jump)).not.toBe(0);
    rig.key('Space', true);
    expect(rig.router.sample(2, CAM).buttons & bit(SimButton.Jump)).toBe(0);   // Space no longer jumps
    rig.key('Space', false);
    rig.tap('Escape');
    rig.router.sample(3, CAM);
    expect(seen).toContain(`${ClientAction.Pause}:pressed`);
  });

  it('keeps a Pause rebind and ignores malformed blocks', () => {
    const o = sanitizeOverrides({ kbm: { onFoot: { 'client.Pause': [{ control: 'key:F1' }], 'sim.Bad name': [{ control: 'key:KeyA' }], 'sim.Jump': 'nope' } } });
    expect(o.kbm?.onFoot).toEqual({ 'client.Pause': [{ control: 'key:F1' }] });
    expect(mergeControls(DEFAULT_CONTROLS, { schema: 2 })).toBeNull();
    expect(mergeControls(DEFAULT_CONTROLS, 'x')).toBeNull();
    const merged = mergeControls(DEFAULT_CONTROLS, { schema: 1, lookSensitivity: { kbm: 99, gamepad: 'x' }, invertY: true });
    expect(merged?.lookSensitivity).toEqual({ kbm: 5, gamepad: DEFAULT_CONTROLS.lookSensitivity.gamepad, touch: DEFAULT_CONTROLS.lookSensitivity.touch });
    expect(merged?.invertY).toBe(true);
  });

  it('other settings sections merge and a language change is stored', () => {
    const rig = makeRig();
    rig.dispatch({ t: 'save.settings', data: { audio: { music: 0.2 }, language: 'es', bogus: { x: 1 } } });
    expect(rig.slices.settings.audio.music).toBe(0.2);
    expect(rig.slices.settings.audio.master).toBe(1);
    expect(rig.slices.settings.language).toBe('es');
    expect('bogus' in rig.slices.settings).toBe(false);
  });
});
