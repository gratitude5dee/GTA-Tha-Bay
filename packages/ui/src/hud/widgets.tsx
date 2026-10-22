/**
 * The shared HUD widgets (10-ui-hud-xr.md 2.10). Every status widget pairs colour with an icon, a shape or text; data comes from the
 * `hud.*` view-model keys. Low-rate values go through state; high-rate values (the prompt's hold progress, the speed) update
 * `textContent` or a style through refs so the tree is not re-rendered per frame.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JsonValue, VmKey } from '@dv/shared';
import { t } from '../i18n/index.ts';
import { useShell } from '../shell/context.tsx';
import {
  STATUS, clockText, dollars, heatStatus, litStars, promptGlyph, promptTextKey,
  type HudClock, type HudHeat, type HudPrompt, type HudVehicle, type HudWallet, type StatusDef,
} from './model.ts';

/** Subscribes to a view-model key; undefined while the key is unset. */
export function useVm<T extends JsonValue>(key: string): T | undefined {
  const { ctx } = useShell();
  const vm = ctx.engine?.vm;
  const [v, setV] = useState<T | undefined>(() => vm?.get<T>(key as VmKey));
  useEffect(() => {
    setV(vm?.get<T>(key as VmKey));
    return vm?.subscribe(key as VmKey, (nv) => setV(nv as T | undefined));
  }, [vm, key]);
  return v;
}

/** A value that changes every frame: writes `format(value)` into the element's text node and re-renders nothing. */
export function LiveText<T extends JsonValue>(props: { vmKey: string; format(v: T | undefined): string; class?: string; testId?: string }) {
  const { ctx } = useShell();
  const ref = useRef<HTMLSpanElement>(null);
  const vm = ctx.engine?.vm;
  useEffect(() => {
    const paint = (v: JsonValue | undefined): void => {
      if (ref.current) ref.current.textContent = props.format(v as T | undefined);
    };
    paint(vm?.get(props.vmKey as VmKey));
    return vm?.subscribe(props.vmKey as VmKey, paint);
  }, [vm, props.vmKey]);
  return <span ref={ref} class={props.class} data-testid={props.testId} />;
}

/** One status: an icon, text and the semantic colour. A chip without an icon does not type-check, which is the lint of 2.13 rule 4. */
export function StatusChip(props: { status: StatusDef; icon?: string; label?: string; testId?: string; extra?: ComponentChildren }) {
  const s = props.status;
  return (
    <span class="dv-schip" data-tone={s.tone} data-status={s.id} data-testid={props.testId}>
      <span class="dv-schip-icon" aria-hidden="true">{props.icon ?? s.icon}</span>
      <span class="dv-schip-text">{props.label ?? t(s.textKey)}</span>
      {props.extra}
    </span>
  );
}

// ---- heat

/** Five stars, a distinct scripted-6 icon, the phase text and a ring for the cooldown progress (C06 `HeatState`). */
export function HeatStars(props: { heat: HudHeat | undefined }) {
  const h = props.heat;
  const level = h?.level ?? 0;
  const status = heatStatus(h);
  const lit = litStars(level);
  const cooling = h?.phase === 'cooldown';
  const ring = Math.round((h?.cooldown ?? 0) * 100);
  return (
    <div class="dv-heat" data-testid="hud-heat" data-level={level} data-phase={h?.phase ?? 'clear'} role="group" aria-label={t('hud.heat.label')}>
      <span class="dv-stars" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} class={i <= lit ? 'dv-star dv-star-on' : 'dv-star'} data-tone={i <= lit ? status.tone : 'neutral'}>{i <= lit ? '★' : '☆'}</span>
        ))}
        {level >= 6 ? <span class="dv-star dv-star-script" data-testid="hud-heat-scripted">{'✦'}</span> : null}
      </span>
      <StatusChip status={status} testId="hud-heat-phase" label={level >= 6 ? t('hud.heat.scripted') : level > 0 ? t('hud.heat.level', { level }) + ' · ' + t(status.textKey) : t(status.textKey)} />
      {cooling ? (
        <span class="dv-ring" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={ring} aria-label={t('hud.heat.cooldown')} data-testid="hud-heat-ring">
          <svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" class="dv-ring-bg" /><circle cx="18" cy="18" r="15" class="dv-ring-fg" stroke-dasharray={`${ring * 0.942} 100`} /></svg>
        </span>
      ) : null}
    </div>
  );
}

// ---- wallet, clock, area, objective

export function Wallet(props: { wallet: HudWallet | undefined }) {
  const w = props.wallet;
  const last = useRef<number | null>(null);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (w === undefined) return undefined;
    if (last.current !== null && last.current !== w.cashCents) {
      setChanged(true);
      const id = setTimeout(() => setChanged(false), 4000);
      last.current = w.cashCents;
      return () => clearTimeout(id);
    }
    last.current = w.cashCents;
    return undefined;
  }, [w?.cashCents]);
  return (
    <div class="dv-wallet" data-testid="hud-wallet" data-changed={changed ? '1' : '0'} aria-label={t('hud.wallet.label')}>
      <span class="dv-schip-icon" aria-hidden="true">$</span>
      <span data-testid="hud-wallet-value">{w ? dollars(w.cashCents) : t('hud.empty')}</span>
    </div>
  );
}

export function ClockWeather(props: { clock: HudClock | undefined }) {
  const c = props.clock;
  return (
    <div class="dv-clock" data-testid="hud-clock" aria-label={t('hud.clock.label')}>
      <span class="dv-schip-icon" aria-hidden="true">{'◔'}</span>
      <span data-testid="hud-clock-value">{c ? clockText(c.hour) : t('hud.empty')}</span>
      {c ? <span class="dv-muted" data-testid="hud-weather">{t(`hud.weather.${c.weather}`)}</span> : null}
    </div>
  );
}

export function AreaBanner(props: { area: { name: string } | undefined }) {
  if (!props.area?.name) return null;
  return <div class="dv-area" data-testid="hud-area" role="status">{props.area.name}</div>;
}

export interface ObjectiveView { title?: string; text?: string; timerSec?: number; assist?: boolean }
export function ObjectiveTracker(props: { objective: ObjectiveView | undefined }) {
  const o = props.objective;
  if (!o?.title && !o?.text) return null;
  return (
    <div class="dv-objective" data-testid="hud-objective" role="status">
      <StatusChip status={STATUS['objective'] as StatusDef} label={o.title ?? t('hud.status.objective')} />
      {o.text ? <span>{o.text}</span> : null}
      {o.timerSec !== undefined ? <Timer seconds={o.timerSec} /> : null}
      {o.assist ? <span class="dv-badge" data-testid="hud-assist">{t('hud.assist')}</span> : null}
    </div>
  );
}

// ---- interaction prompt (the only prompt on screen; DL-663 part 2)

/** Exactly one element exists while a prompt is live; none otherwise. Hold progress is a ref write. */
export function InteractionPrompt() {
  const { ctx } = useShell();
  const prompt = useVm<JsonValue>('hud.prompt') as HudPrompt | undefined;
  const device = (useVm<JsonValue>('hud.device') as string | undefined) ?? 'kbm';
  const fill = useRef<HTMLSpanElement>(null);
  const vm = ctx.engine?.vm;
  useEffect(
    () =>
      vm?.subscribe('hud.prompt', (v) => {
        const p = v as HudPrompt | undefined;
        if (fill.current && p) fill.current.style.inlineSize = `${Math.round(p.progress * 100)}%`;
      }),
    [vm],
  );
  if (!prompt) return null;
  const blocked = Boolean(prompt.reason);
  const glyph = blocked ? '' : promptGlyph(prompt.kind, device);
  return (
    <div class={`dv-prompt dv-prompt-ui${blocked ? ' dv-prompt-blocked' : ''}`} data-testid="hud-prompt" data-kind={prompt.kind} data-blocked={blocked ? '1' : '0'} role="status" aria-live="polite">
      {blocked ? <span class="dv-schip-icon" aria-hidden="true">{'⛔'}</span> : glyph ? <kbd class="dv-glyph" data-testid="hud-prompt-glyph">{glyph}</kbd> : null}
      <span data-testid="hud-prompt-text">{t(promptTextKey(prompt))}</span>
      {prompt.hold && !blocked ? (
        <span class="dv-hold" aria-hidden="true"><span ref={fill} class="dv-hold-fill" style={{ inlineSize: `${Math.round(prompt.progress * 100)}%` }} /></span>
      ) : null}
    </div>
  );
}

// ---- vehicle, health, meters, timers

export function VehicleCluster(props: { veh: HudVehicle | undefined; units: 'mph' | 'kph' }) {
  if (!props.veh) return null;
  return (
    <div class="dv-cluster" data-testid="hud-speed" role="status" aria-label={t('hud.speed.label')}>
      <LiveText<JsonValue>
        vmKey="hud.veh"
        class="dv-speed-value"
        testId="hud-speed-value"
        format={(v) => {
          const k = (v as unknown as HudVehicle | undefined)?.kph ?? 0;
          return String(props.units === 'mph' ? Math.round(k * 0.621371) : k);
        }}
      />
      <small>{props.units === 'mph' ? t('hud.unit.mph') : t('hud.unit.kph')}</small>
      <small data-testid="hud-gear">{t('hud.gear', { gear: gearText(props.veh.gear) })}</small>
    </div>
  );
}

export const gearText = (g: number): string => (g < 0 ? 'R' : g === 0 ? 'N' : String(g));

export function MeterBar(props: { id: string; label: string; value: number; max: number; tone?: StatusDef['tone']; icon?: string }) {
  const pct = props.max > 0 ? Math.round(Math.max(0, Math.min(1, props.value / props.max)) * 100) : 0;
  return (
    <div class="dv-meter" data-tone={props.tone ?? 'neutral'} data-testid={`hud-meter-${props.id}`}>
      <span class="dv-schip-icon" aria-hidden="true">{props.icon ?? '■'}</span>
      <span class="dv-meter-label">{props.label}</span>
      <span class="dv-meter-bar" role="progressbar" aria-valuemin={0} aria-valuemax={props.max} aria-valuenow={props.value} aria-label={props.label}>
        <span class="dv-meter-fill" style={{ inlineSize: `${pct}%` }} />
      </span>
      <span class="dv-meter-num">{`${Math.round(props.value)}/${props.max}`}</span>
    </div>
  );
}

export function HealthBar(props: { health: { hp: number; max: number } | undefined }) {
  const h = props.health;
  if (!h) return null;
  const low = h.hp / Math.max(1, h.max) <= 0.25;
  return (
    <div class="dv-health" data-low={low ? '1' : '0'} data-testid="hud-health">
      <MeterBar id="health" label={t('hud.health.label')} value={h.hp} max={h.max} tone={low ? 'danger' : 'friendly'} icon={'♥'} />
      {low ? <StatusChip status={STATUS['health.low'] as StatusDef} testId="hud-health-low" /> : null}
    </div>
  );
}

export function Timer(props: { seconds: number }) {
  const s = Math.max(0, Math.round(props.seconds));
  return <span class="dv-timer" data-testid="hud-timer">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</span>;
}

export function Countdown(props: { n: number }) {
  return <div class="dv-countdown" role="status" data-testid="hud-countdown">{props.n > 0 ? String(props.n) : t('hud.go')}</div>;
}

export function Subtitles(props: { line: { speaker?: string; text: string } | undefined }) {
  if (!props.line) return null;
  return (
    <div class="dv-subtitles" data-testid="hud-subtitles" role="status">
      {props.line.speaker ? <strong>{props.line.speaker}: </strong> : null}
      <span>{props.line.text}</span>
    </div>
  );
}

export function SaveIndicator(props: { state: 'saving' | 'saved' | 'failed' | undefined }) {
  if (!props.state) return null;
  return <StatusChip status={STATUS[`save.${props.state}`] as StatusDef} testId="hud-save" />;
}

export function NetStatus(props: { ok: boolean | undefined }) {
  if (props.ok === undefined) return null;
  return <StatusChip status={STATUS[props.ok ? 'net.ok' : 'net.bad'] as StatusDef} testId="hud-net" />;
}

/** The empty frame of the minimap (M02c2 draws into it). A canvas keeps its place so the draw code only needs `getElementById`. */
export function MinimapFrame() {
  return (
    <div class="dv-minimap" data-testid="hud-minimap" role="img" aria-label={t('hud.minimap.label')}>
      <canvas id="dv-minimap-canvas" width={160} height={160} />
    </div>
  );
}

export function SandboxChip() {
  return <div class="dv-sandbox-chip" data-testid="hud-sandbox"><StatusChip status={STATUS['warning'] as StatusDef} icon={'⚒'} label={t('hud.sandbox')} /></div>;
}
