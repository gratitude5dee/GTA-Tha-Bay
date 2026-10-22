/**
 * Settings > Controls > Touch (10-ui-hud-xr.md 2.9 rule 6, M04b2): pick one of the shipped layouts or a saved custom one, edit a layout
 * (landscape only: drag the widgets, a size slider 40 to 96 px, opacity 20 to 100 %, an 8 px snap grid, overlap and safe-area warnings,
 * a Test mode, Reset, Save as `custom:n`), and the tilt toggle with its explainer. Each widget also has numeric X, Y and size steppers,
 * so the editor works from the keyboard and with a screen reader (no gesture-only path).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ControlsSettings, JsonObject } from '@dv/shared';
import { t } from '../i18n/index.ts';
import { Button, Slider, Toggle } from '../kit/widgets.tsx';
import { useShell } from '../shell/context.tsx';
import type { PrefsStore } from '../shell/types.ts';
import {
  OPACITY_RANGE, SHIPPED_IDS, SIZE_RANGE, SNAP_PX, asCustom, boxOf, editButton, layoutChoices, nextCustomSlot, resolveLayout, setOpacity, validateLayout,
  type ButtonWidget, type Fixture, type TouchLayout,
} from './touch.ts';

/** Reads the safe-area insets the browser reports, with a probe element (CSS `env()` has no JS API). */
export function readInsets(): Fixture['insets'] {
  if (typeof document === 'undefined') return { top: 0, right: 0, bottom: 0, left: 0 };
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  document.body.append(probe);
  const cs = getComputedStyle(probe);
  const px = (s: string): number => Number.parseFloat(s) || 0;
  const out = { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
  probe.remove();
  return out;
}

const layoutName = (id: string, nameKey: string): string => (id.startsWith('custom:') ? t('touch.layout.custom', { n: id.slice(7) }) : t(nameKey));

export function TouchSection(props: { controls: ControlsSettings; setControls(next: ControlsSettings): void; prefs: PrefsStore }) {
  const { shell } = useShell();
  const [editing, setEditing] = useState<TouchLayout | null>(null);
  const customs = props.prefs.get().customTouchLayouts;
  const current = props.controls.touch.layout;
  const choices = layoutChoices(customs);
  const setLayoutId = (id: string): void => props.setControls({ ...props.controls, touch: { ...props.controls.touch, layout: id } });
  const setTilt = async (on: boolean): Promise<void> => {
    if (!on) {
      props.setControls({ ...props.controls, touch: { ...props.controls.touch, tiltSteer: false } });
      return;
    }
    // The explainer comes before the browser's own motion-sensor prompt, and the prompt only runs when the player turns tilt on.
    const ok = await shell.confirm({ titleKey: 'touch.tilt.title', bodyKey: 'touch.tilt.body', confirmKey: 'touch.tilt.confirm' });
    if (!ok) return;
    let granted = typeof DeviceOrientationEvent !== 'undefined';
    const req = (globalThis as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent?.requestPermission;
    if (typeof req === 'function') {
      try {
        granted = (await req()) === 'granted';
      } catch {
        granted = false;
      }
    }
    if (!granted) {
      shell.toast({ id: 'touch.tilt', kind: 'warning', text: 'touch.tilt.denied' });
      props.setControls({ ...props.controls, touch: { ...props.controls.touch, tiltSteer: false } });
      return;
    }
    props.setControls({ ...props.controls, touch: { ...props.controls.touch, tiltSteer: true } });
  };
  if (editing) {
    return (
      <TouchEditor
        initial={editing}
        onClose={() => setEditing(null)}
        onSave={(layout) => {
          const n = layout.id.startsWith('custom:') ? Number(layout.id.slice(7)) : nextCustomSlot(customs);
          const saved = asCustom(layout, n);
          props.prefs.set({ customTouchLayouts: { ...customs, [saved.id]: saved as unknown as JsonObject } });
          setLayoutId(saved.id);
          setEditing(null);
          shell.toast({ id: 'touch.saved', kind: 'success', text: 'touch.saved' });
        }}
      />
    );
  }
  return (
    <section class="dv-card" data-testid="touch-section">
      <h3>{t('touch.section')}</h3>
      <div class="dv-segmented" role="radiogroup" aria-label={t('touch.layout')}>
        {choices.map((id) => {
          const l = resolveLayout(id, customs);
          return (
            <button key={id} type="button" role="radio" class="dv-seg" aria-checked={id === current ? 'true' : 'false'} data-fid={`touch.layout.${id}`} data-testid={`touch-layout-${id}`} onClick={() => setLayoutId(id)}>
              {layoutName(id, l.nameKey)}
            </button>
          );
        })}
      </div>
      <Button id="touch-edit" label={t('touch.edit')} onPress={() => setEditing(structuredClone(resolveLayout(current, customs)))} testId="touch-edit" />
      <Toggle id="touch-tilt" label={t('touch.tilt')} hint={t('touch.tilt.hint')} scope="profile" on={props.controls.touch.tiltSteer} onChange={(on) => void setTilt(on)} />
    </section>
  );
}

interface EditorProps {
  initial: TouchLayout;
  onSave(layout: TouchLayout): void;
  onClose(): void;
}

export function TouchEditor(props: EditorProps) {
  const [layout, setLayout] = useState<TouchLayout>(props.initial);
  const [sel, setSel] = useState<string | null>(null);
  const [test, setTest] = useState(false);
  const [down, setDown] = useState<string | null>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const insets = useRef(readInsets());
  const drag = useRef<{ id: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const on = (): void => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const portrait = size.h > size.w;
  const fx: Fixture = { viewport: { width: size.w, height: size.h }, insets: insets.current };
  const problems = validateLayout(layout, fx);
  const buttons = layout.widgets.filter((w): w is ButtonWidget => w.kind === 'button');
  const chosen = buttons.find((b) => b.id === sel) ?? null;
  const edit = (id: string, patch: { dx?: number; dy?: number; sizePx?: number }): void => setLayout((l) => editButton(l, id, patch));

  if (portrait) {
    return (
      <div class="dv-touch-edit" data-testid="touch-editor-portrait">
        <p class="dv-muted">{t('touch.edit.landscape')}</p>
        <Button id="touch-edit-close" label={t('common.back')} onPress={props.onClose} />
      </div>
    );
  }
  return (
    <div class="dv-touch-edit" role="dialog" aria-label={t('touch.edit')} data-testid="touch-editor">
      <div
        class="dv-touch-edit-stage"
        data-testid="touch-editor-stage"
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || test) return;
          const w = buttons.find((b) => b.id === d.id);
          if (!w) return;
          const ddx = e.clientX - d.x;
          const ddy = e.clientY - d.y;
          if (Math.abs(ddx) < 1 && Math.abs(ddy) < 1) return;
          drag.current = { id: d.id, x: e.clientX, y: e.clientY };
          const sx = w.at.corner[1] === 'l' ? 1 : -1;
          const sy = w.at.corner[0] === 't' ? 1 : -1;
          edit(d.id, { dx: w.at.dx + sx * ddx, dy: w.at.dy + sy * ddy });
        }}
        onPointerUp={() => {
          drag.current = null;
          setDown(null);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDown(null);
        }}
      >
        <div class="dv-touch-edit-safe" style={{ left: `${insets.current.left}px`, top: `${insets.current.top}px`, right: `${insets.current.right}px`, bottom: `${insets.current.bottom}px`, position: 'absolute' }} />
        {layout.widgets.map((w) => {
          if (w.kind === 'stick' || w.kind === 'lookzone') {
            return (
              <div key={w.id} class="dv-touch-edit-zone" style={{ left: `${w.zone.x * 100}%`, top: `${w.zone.y * 100}%`, width: `${w.zone.w * 100}%`, height: `${w.zone.h * 100}%` }}>
                {w.kind === 'stick' ? t('touch.zone.move') : t('touch.zone.look')}
              </div>
            );
          }
          if (w.kind !== 'button') return null;
          const b = boxOf(w, fx);
          const warn = problems.some((p) => p.widget === w.id || p.widget.split('+').includes(w.id));
          return (
            <button
              key={w.id}
              type="button"
              class="dv-touch-edit-w"
              style={{ left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px`, opacity: layout.opacity ?? 1, background: down === w.id ? 'var(--dv-color-accent)' : undefined }}
              aria-pressed={sel === w.id ? 'true' : 'false'}
              data-warn={warn ? '1' : '0'}
              data-fid={`touch.edit.${w.id}`}
              data-testid={`touch-edit-w-${w.id}`}
              onPointerDown={(e) => {
                setSel(w.id);
                if (test) setDown(w.id);
                else {
                  drag.current = { id: w.id, x: e.clientX, y: e.clientY };
                  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                }
              }}
              onClick={() => setSel(w.id)}
            >
              {t(w.label ?? w.id)}
            </button>
          );
        })}
      </div>
      <div class="dv-touch-edit-panel">
        {chosen ? (
          <>
            <strong data-testid="touch-edit-selected">{t(chosen.label ?? chosen.id)}</strong>
            <Stepper id="x" label={t('touch.edit.x')} value={chosen.at.dx} step={SNAP_PX} min={0} onChange={(v) => edit(chosen.id, { dx: v })} />
            <Stepper id="y" label={t('touch.edit.y')} value={chosen.at.dy} step={SNAP_PX} min={0} onChange={(v) => edit(chosen.id, { dy: v })} />
            <Slider id="touch-size" label={t('touch.edit.size')} value={chosen.sizePx} min={SIZE_RANGE.min} max={SIZE_RANGE.max} step={2} unit=" px" onChange={(v) => edit(chosen.id, { sizePx: v })} />
          </>
        ) : (
          <span class="dv-muted">{t('touch.edit.pick')}</span>
        )}
        <Slider id="touch-opacity" label={t('touch.edit.opacity')} value={Math.round((layout.opacity ?? 1) * 100)} min={OPACITY_RANGE.min * 100} max={100} step={5} unit="%" onChange={(v) => setLayout((l) => setOpacity(l, v / 100))} />
        <span role="status" data-testid="touch-edit-warnings">{problems.length === 0 ? t('touch.edit.ok') : t('touch.edit.warnings', { n: problems.length })}</span>
        <Button id="touch-edit-test" label={test ? t('touch.edit.testOff') : t('touch.edit.test')} onPress={() => setTest(!test)} />
        <Button id="touch-edit-reset" label={t('touch.edit.reset')} onPress={() => setLayout(structuredClone(resolveLayout(SHIPPED_IDS.includes(props.initial.id) ? props.initial.id : 'default-right', {})))} />
        <Button id="touch-edit-save" style="primary" label={t('touch.edit.save')} onPress={() => props.onSave(layout)} />
        <Button id="touch-edit-close" label={t('common.cancel')} onPress={props.onClose} />
      </div>
    </div>
  );
}

function Stepper(props: { id: string; label: string; value: number; step: number; min: number; onChange(v: number): void }) {
  return (
    <div class="dv-row" role="group" aria-label={props.label}>
      <span class="dv-row-text">{props.label}</span>
      <Button id={`touch-${props.id}-minus`} label="-" onPress={() => props.onChange(Math.max(props.min, props.value - props.step))} />
      <span data-testid={`touch-val-${props.id}`}>{props.value}</span>
      <Button id={`touch-${props.id}-plus`} label="+" onPress={() => props.onChange(props.value + props.step)} />
    </div>
  );
}
