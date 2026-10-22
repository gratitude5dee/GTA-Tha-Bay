/**
 * Settings: Controls (10-ui-pages.md section 2.9, R-ENG-04): device tabs (keyboard and mouse, gamepad; touch and VR read-only notes),
 * action rows with up to two bindings, Rebind with a 5 s capture, a conflict dialog (Swap / Replace / Cancel), reset per row, group and
 * device, `client.Pause` locked, hold-to-toggle, sensitivity, invert Y and deadzones. The model is pure (unit-tested); the capture reads
 * the next key or pad button itself because the engine's binders are suspended while a menu is open.
 */
import { TouchSection } from '../../hud/touch-editor.tsx';
import type { PrefsStore } from '../../shell/types.ts';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ActionId, Binding, ContextBindings, ControlId, ControlsSettings, InputContextId } from '@dv/shared';
import kbmDefaults from '../../../../../config/input/defaults.kbm.json';
import padDefaults from '../../../../../config/input/defaults.gamepad.json';
import { lk, t } from '../../i18n/index.ts';
import { Button, Choice, Slider, Tabs, Toggle } from '../../kit/widgets.tsx';

export type PadDevice = 'kbm' | 'gamepad';
export type GroupId = 'onFoot' | 'vehicle';
export const GROUPS: readonly { id: GroupId; labelKey: string }[] = [
  { id: 'onFoot', labelKey: lk('settings.controls.onFoot') },
  { id: 'vehicle', labelKey: lk('settings.controls.vehicle') },
];
export const PAUSE_ACTION: ActionId = 'client.Pause';
/** Actions the rows list: the digital ones a player would rebind (axes and the debug toggle are not rebindable here). */
const HIDDEN = new Set<string>(['client.DebugToggle', 'client.Look']);
const MAX_BINDINGS = 2;

type DefaultsFile = { contexts: Partial<Record<InputContextId, ContextBindings>> };
const DEFAULTS: Record<PadDevice, DefaultsFile> = { kbm: kbmDefaults as unknown as DefaultsFile, gamepad: padDefaults as unknown as DefaultsFile };

export function defaultBindings(device: PadDevice, group: GroupId, action: ActionId): Binding[] {
  return [...(DEFAULTS[device].contexts[group]?.[action] ?? [])];
}

/** The rebindable actions of a group on a device, in the order of the default map. */
export function actionsOf(device: PadDevice, group: GroupId): ActionId[] {
  return (Object.keys(DEFAULTS[device].contexts[group] ?? {}) as ActionId[]).filter((a) => !a.startsWith('axis.') && !HIDDEN.has(a));
}

/** The bindings in force: the override when there is one, else the default. */
export function effective(c: ControlsSettings, device: PadDevice, group: GroupId, action: ActionId): Binding[] {
  return c.overrides[device]?.[group]?.[action] ?? defaultBindings(device, group, action);
}

const clone = (c: ControlsSettings): ControlsSettings => JSON.parse(JSON.stringify(c)) as ControlsSettings;

function put(c: ControlsSettings, device: PadDevice, group: GroupId, action: ActionId, list: Binding[] | null): ControlsSettings {
  const next = clone(c);
  const dev = (next.overrides[device] ??= {});
  const ctx = (dev[group] ??= {});
  if (list === null) delete ctx[action];
  else ctx[action] = list;
  if (Object.keys(ctx).length === 0) delete dev[group];
  if (Object.keys(dev).length === 0) delete next.overrides[device];
  return next;
}

/** `client.Pause` is always available (C03 rule 9): nothing here leaves it without a binding. */
export const isLocked = (action: ActionId): boolean => action === PAUSE_ACTION;

/** Replaces the binding in `slot` (0 or 1). Pause cannot be changed. Null removes the slot. */
export function setBinding(c: ControlsSettings, device: PadDevice, group: GroupId, action: ActionId, slot: 0 | 1, binding: Binding | null): ControlsSettings {
  if (isLocked(action)) return c;
  const list = effective(c, device, group, action).slice(0, MAX_BINDINGS);
  if (binding === null) list.splice(slot, 1);
  else list[Math.min(slot, list.length)] = binding;
  return put(c, device, group, action, list);
}

const sameControl = (a: Binding, b: Binding): boolean => a.control === b.control && JSON.stringify(a.modifiers ?? []) === JSON.stringify(b.modifiers ?? []);

/** Another action of the group that already uses this binding, or null. */
export function findConflict(c: ControlsSettings, device: PadDevice, group: GroupId, action: ActionId, binding: Binding): ActionId | null {
  for (const other of actionsOf(device, group)) {
    if (other === action) continue;
    if (effective(c, device, group, other).some((b) => sameControl(b, binding))) return other;
  }
  return null;
}

/**
 * Applies a conflict choice. Replace: the other action loses the binding. Swap: the other action takes the binding this one had in
 * the slot. A locked action (Pause) is never the one that loses its binding: the new binding is refused instead.
 */
export function resolveConflict(
  c: ControlsSettings, device: PadDevice, group: GroupId, action: ActionId, slot: 0 | 1, binding: Binding, other: ActionId, mode: 'swap' | 'replace',
): ControlsSettings {
  if (isLocked(other)) return c;
  const old = effective(c, device, group, action)[slot];
  let next = c;
  const otherList = effective(next, device, group, other).filter((b) => !sameControl(b, binding));
  if (mode === 'swap' && old) otherList.push(old);
  next = put(next, device, group, other, otherList);
  return setBinding(next, device, group, action, slot, binding);
}

export const resetAction = (c: ControlsSettings, device: PadDevice, group: GroupId, action: ActionId): ControlsSettings => put(c, device, group, action, null);
export function resetGroup(c: ControlsSettings, device: PadDevice, group: GroupId): ControlsSettings {
  const next = clone(c);
  const dev = next.overrides[device];
  if (dev) delete dev[group];
  if (dev && Object.keys(dev).length === 0) delete next.overrides[device];
  return next;
}
export function resetDevice(c: ControlsSettings, device: PadDevice): ControlsSettings {
  const next = clone(c);
  delete next.overrides[device];
  return next;
}

const PAD_NAMES: Record<number, string> = { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 8: 'Back', 9: 'Start', 10: 'L3', 11: 'R3', 12: 'D-Up', 13: 'D-Down', 14: 'D-Left', 15: 'D-Right' };

/** A short label for a control id: `key:KeyH` is H, `pad:b0` is A. */
export function glyph(control: ControlId): string {
  if (control.startsWith('key:')) {
    const code = control.slice(4);
    return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, 'Arrow ').replace(/Left$/, ' Left').replace(/Right$/, ' Right').replace('  ', ' ');
  }
  if (control.startsWith('pad:b')) return PAD_NAMES[Number(control.slice(5))] ?? control.slice(4);
  if (control.startsWith('pad:a')) return `Stick ${control.slice(5)}`;
  if (control.startsWith('mouse:')) return `Mouse ${control.slice(6)}`;
  return control;
}

export function bindingLabel(b: Binding): string {
  return [...(b.modifiers ?? []), b.control].map(glyph).join(' + ');
}

// ---- capture

const MODIFIER_CODES = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);

/** Waits for the next key (kbm) or pad button (gamepad). Escape cancels; the timeout resolves null. */
export function captureBinding(device: PadDevice, timeoutMs: number, win: Window = window): Promise<Binding | null> {
  return new Promise((resolve) => {
    let done = false;
    let raf = 0;
    const finish = (b: Binding | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
      win.removeEventListener('keydown', onKey, true);
      resolve(b);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const held = new Set<string>();
    const onKey = (e: KeyboardEvent): void => {
      if (device !== 'kbm') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') return finish(null);
      if (MODIFIER_CODES.has(e.code)) {
        held.add(e.code);
        // A modifier alone is a binding on key up of everything else; keep waiting for a chord partner for a moment.
        setTimeout(() => {
          if (held.has(e.code) && !done) finish({ control: `key:${e.code}` });
        }, 350);
        return;
      }
      const mods = [...held].map((c) => `key:${c}` as ControlId);
      finish(mods.length > 0 ? { control: `key:${e.code}`, modifiers: mods } : { control: `key:${e.code}` });
    };
    win.addEventListener('keydown', onKey, true);
    if (device === 'gamepad') {
      const baseline = new Set<number>();
      let first = true;
      const poll = (): void => {
        if (done) return;
        const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
        for (const p of pads) {
          if (!p) continue;
          p.buttons.forEach((b, i) => {
            if (first) {
              if (b.pressed) baseline.add(i);
            } else if (b.pressed && !baseline.has(i) && !done) finish({ control: `pad:b${i}` as ControlId });
          });
        }
        first = false;
        raf = requestAnimationFrame(poll);
      };
      raf = requestAnimationFrame(poll);
    }
  });
}

// ---- component

export interface ControlsPanelProps {
  /** The preferences store: the touch layouts the player saved live in it (`UiPrefs.customTouchLayouts`). */
  prefs?: PrefsStore;
  controls: ControlsSettings;
  setControls(next: ControlsSettings): void;
  capture?: (device: PadDevice, ms: number) => Promise<Binding | null>;
}

type Pending = { device: PadDevice; group: GroupId; action: ActionId; slot: 0 | 1; binding: Binding; other: ActionId };

export function ControlsPanel(props: ControlsPanelProps) {
  const [device, setDevice] = useState<string>('kbm');
  const [capturing, setCapturing] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState('');
  const c = props.controls;
  const live = useRef(c);
  live.current = c;
  useEffect(() => () => setCapturing(null), []);
  const tabs = [
    { id: 'kbm', label: t('settings.controls.kbm') },
    { id: 'gamepad', label: t('settings.controls.gamepad') },
    { id: 'touch', label: t('settings.controls.touch') },
    { id: 'vr', label: t('settings.controls.vr') },
  ];
  const rebind = async (dev: PadDevice, group: GroupId, action: ActionId, slot: 0 | 1): Promise<void> => {
    const key = `${dev}.${group}.${action}.${slot}`;
    setCapturing(key);
    setNotice('');
    const got = await (props.capture ?? captureBinding)(dev, 5000);
    setCapturing(null);
    if (!got) return;
    const other = findConflict(live.current, dev, group, action, got);
    if (other) {
      if (isLocked(other)) {
        setNotice(t('settings.controls.pauseTaken'));
        return;
      }
      setPending({ device: dev, group, action, slot, binding: got, other });
      return;
    }
    props.setControls(setBinding(live.current, dev, group, action, slot, got));
  };
  const sens = c.lookSensitivity;
  const dz = c.deadzones;
  return (
    <div class="dv-controls" data-testid="controls">
      <h2>{t('settings.controls')}</h2>
      <Tabs id="controls-device" tabs={tabs} active={device} onSelect={setDevice} />
      {device === 'touch' && props.prefs ? <TouchSection controls={c} setControls={props.setControls} prefs={props.prefs} /> : null}
      {(device === 'touch' && !props.prefs) || device === 'vr' ? <p class="dv-muted" data-testid="controls-note">{t(device === 'touch' ? 'settings.controls.touch.note' : 'settings.controls.vr.note')}</p> : null}
      {device === 'kbm' || device === 'gamepad' ? (
        <>
          <p aria-live="polite" class="dv-sr" data-testid="capture-status">{capturing ? t('settings.controls.press') : ''}</p>
          {notice ? <p class="dv-warn" role="status">{notice}</p> : null}
          {GROUPS.map((g) => (
            <section key={g.id} class="dv-card" data-testid={`group-${g.id}`}>
              <h3>{t(g.labelKey)}</h3>
              {actionsOf(device as PadDevice, g.id).map((action) => {
                const list = effective(c, device as PadDevice, g.id, action);
                const locked = isLocked(action);
                return (
                  <div key={action} class="dv-row" data-testid={`row-${g.id}-${action}`}>
                    <span class="dv-row-text">{t(`action.${action}`)}</span>
                    {([0, 1] as const).map((slot) => {
                      const key = `${device}.${g.id}.${action}.${slot}`;
                      const b = list[slot];
                      if (locked) {
                        return b ? <span key={slot} class="dv-keycap" data-testid={`binding-${action}-${slot}`}>{bindingLabel(b)}</span> : null;
                      }
                      return (
                        <button
                          key={slot}
                          type="button"
                          class="dv-btn dv-btn-secondary dv-keycap"
                          data-fid={`bind.${g.id}.${action}.${slot}`}
                          data-testid={`bind-${g.id}-${action}-${slot}`}
                          onClick={() => void rebind(device as PadDevice, g.id, action, slot)}
                        >
                          <span class="dv-sr">{t('settings.controls.rebind', { action: t(`action.${action}`) })}: </span>
                          {capturing === key ? t('settings.controls.press') : b ? bindingLabel(b) : t('settings.controls.unbound')}
                        </button>
                      );
                    })}
                    {locked ? (
                      <span class="dv-lock" data-testid={`lock-${action}`} title={t('settings.controls.locked')}>
                        {'\u{1F512}'} <small>{t('settings.controls.locked')}</small>
                      </span>
                    ) : (
                      <Button id={`reset-${g.id}-${action}`} label={t('settings.controls.resetRow')} onPress={() => props.setControls(resetAction(c, device as PadDevice, g.id, action))} />
                    )}
                  </div>
                );
              })}
              <Button id={`reset-group-${g.id}`} label={t('settings.controls.resetGroup')} onPress={() => props.setControls(resetGroup(c, device as PadDevice, g.id))} />
            </section>
          ))}
          <Button id="reset-device" style="danger" label={t('settings.controls.resetDevice')} onPress={() => props.setControls(resetDevice(c, device as PadDevice))} />
        </>
      ) : null}
      <h3>{t('settings.controls.feel')}</h3>
      {(['kbm', 'gamepad', 'touch'] as const).map((d) => (
        <Slider key={d} id={`sens-${d}`} label={t('settings.controls.sens', { device: t(`settings.controls.${d}`) })} value={sens[d]} min={0.1} max={3} step={0.1} scope="profile" onChange={(v) => props.setControls({ ...c, lookSensitivity: { ...sens, [d]: v } })} />
      ))}
      <Toggle id="invert-y" label={t('settings.controls.invertY')} scope="profile" on={c.invertY} onChange={(on) => props.setControls({ ...c, invertY: on })} />
      <Slider id="dz-inner" label={t('settings.controls.dzInner')} value={dz.stickInner} min={0} max={0.5} step={0.05} scope="profile" onChange={(v) => props.setControls({ ...c, deadzones: { ...dz, stickInner: v } })} />
      <Slider id="dz-outer" label={t('settings.controls.dzOuter')} value={dz.stickOuter} min={0.5} max={1} step={0.05} scope="profile" onChange={(v) => props.setControls({ ...c, deadzones: { ...dz, stickOuter: v } })} />
      <Choice
        id="fighter-scheme"
        label={t('settings.controls.fighter')}
        scope="profile"
        options={[{ key: 'classic', label: t('settings.controls.classic'), on: (c.fighterScheme ?? 'classic') === 'classic' }, { key: 'simple', label: t('settings.controls.simple'), on: c.fighterScheme === 'simple' }]}
        onPick={(i) => props.setControls({ ...c, fighterScheme: i === 0 ? 'classic' : 'simple' })}
      />
      {pending ? (
        <div class="dv-overlay" data-dv-modal>
          <div class="dv-dialog" role="dialog" aria-modal="true" aria-labelledby="conflict-title" data-testid="conflict">
            <h2 id="conflict-title">{t('settings.controls.conflict.title')}</h2>
            <p>{t('settings.controls.conflict.body', { control: bindingLabel(pending.binding), other: t(`action.${pending.other}`) })}</p>
            <div class="dv-actions">
              <button type="button" class="dv-btn dv-btn-secondary" data-testid="conflict-cancel" data-fid="conflict.cancel" onClick={() => setPending(null)}>{t('common.cancel')}</button>
              <button type="button" class="dv-btn dv-btn-secondary" data-testid="conflict-swap" data-fid="conflict.swap" onClick={() => { props.setControls(resolveConflict(c, pending.device, pending.group, pending.action, pending.slot, pending.binding, pending.other, 'swap')); setPending(null); }}>{t('settings.controls.swap')}</button>
              <button type="button" class="dv-btn dv-btn-primary" data-testid="conflict-replace" data-fid="conflict.replace" onClick={() => { props.setControls(resolveConflict(c, pending.device, pending.group, pending.action, pending.slot, pending.binding, pending.other, 'replace')); setPending(null); }}>{t('settings.controls.replace')}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
