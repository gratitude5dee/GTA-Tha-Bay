/**
 * The pure model of the HUD (10-ui-hud-xr.md 2.10, 2.13): view-model key shapes, the status table that pairs every semantic state with
 * an icon and text, the palette variables, and the motion table the flash-limit test reads. No DOM and no Preact here.
 */
import palettesJson from '../../../../config/ui/palettes.json';
import { lk } from '../i18n/index.ts';
import type { Palette, PaletteId, SemanticToken } from './cvd.ts';

export const PALETTES = (palettesJson as { palettes: Record<PaletteId, Palette> }).palettes;
export const PALETTE_IDS: readonly PaletteId[] = ['default', 'deutan', 'protan', 'tritan'];

/** CSS variables for a palette: `--dv-sem-friendly` and so on. */
export function paletteVars(id: PaletteId | string | undefined): Record<string, string> {
  const p = PALETTES[(id as PaletteId) in PALETTES ? (id as PaletteId) : 'default'];
  const out: Record<string, string> = {};
  for (const k of Object.keys(p) as SemanticToken[]) out[`--dv-sem-${k}`] = p[k];
  return out;
}

// ---- view-model keys (VmKey `hud.*`)

export interface HudClock { t: number; hour: number; weather: string; paused: boolean }
export interface HudWallet { cashCents: number; streetCred?: number; techClout?: number }
/** Mirror of the snapshot side key `prompt` (the engine sets `hud.prompt`). */
export interface HudPrompt { kind: number; key: string; hold: boolean; progress: number; reason?: string }
/** Mirror of the side key `pursuit` (`hud.heat`). */
export interface HudHeat { level: number; phase: string; cooldown: number; units: number; seen: boolean }
export interface HudVehicle { kph: number; gear: number; rpm: number }

// ---- status table: every state carries an icon and a text key besides its colour

export interface StatusDef { id: string; tone: SemanticToken; icon: string; textKey: string }

export const STATUS: Record<string, StatusDef> = {
  friendly: { id: 'friendly', tone: 'friendly', icon: '✓', textKey: lk('hud.status.friendly') },
  danger: { id: 'danger', tone: 'danger', icon: '✖', textKey: lk('hud.status.danger') },
  warning: { id: 'warning', tone: 'warning', icon: '▲', textKey: lk('hud.status.warning') },
  objective: { id: 'objective', tone: 'objective', icon: '◆', textKey: lk('hud.status.objective') },
  neutral: { id: 'neutral', tone: 'neutral', icon: '●', textKey: lk('hud.status.neutral') },
  'heat.clear': { id: 'heat.clear', tone: 'neutral', icon: '▯', textKey: lk('hud.heat.clear') },
  'heat.wanted': { id: 'heat.wanted', tone: 'danger', icon: '▮', textKey: lk('hud.heat.wanted') },
  'heat.searching': { id: 'heat.searching', tone: 'warning', icon: '◎', textKey: lk('hud.heat.searching') },
  'heat.cooldown': { id: 'heat.cooldown', tone: 'friendly', icon: '↻', textKey: lk('hud.heat.cooldown') },
  'heat.scripted': { id: 'heat.scripted', tone: 'danger', icon: '✦', textKey: lk('hud.heat.scripted') },
  'health.ok': { id: 'health.ok', tone: 'friendly', icon: '♥', textKey: lk('hud.health.ok') },
  'health.low': { id: 'health.low', tone: 'danger', icon: '♥', textKey: lk('hud.health.low') },
  'net.ok': { id: 'net.ok', tone: 'friendly', icon: '▲', textKey: lk('hud.net.ok') },
  'net.bad': { id: 'net.bad', tone: 'danger', icon: '✖', textKey: lk('hud.net.bad') },
  'save.saving': { id: 'save.saving', tone: 'neutral', icon: '…', textKey: lk('hud.save.saving') },
  'save.saved': { id: 'save.saved', tone: 'friendly', icon: '✓', textKey: lk('hud.save.saved') },
  'save.failed': { id: 'save.failed', tone: 'danger', icon: '✖', textKey: lk('hud.save.failed') },
};

/** Which status a heat value shows: the level 6 is the scripted pursuit (distinct icon), the phase names the rest. */
export function heatStatus(h: Pick<HudHeat, 'level' | 'phase'> | undefined): StatusDef {
  if (!h || h.level <= 0) return STATUS['heat.clear'] as StatusDef;
  if (h.level >= 6) return STATUS['heat.scripted'] as StatusDef;
  const key = h.phase === 'searching' ? 'heat.searching' : h.phase === 'cooldown' ? 'heat.cooldown' : 'heat.wanted';
  return STATUS[key] as StatusDef;
}

/** Stars lit for a level (0..5; the scripted 6 shows none, its own icon stands in). */
export function litStars(level: number): number {
  return Math.max(0, Math.min(5, Math.floor(level)));
}

/** Glyph for the active device (10-ui-hud-xr.md 2.10: "glyph of the active device"). Touch has no key glyph; its button is on screen. */
export function promptGlyph(kind: number, device: string): string {
  if (device === 'touch') return '';
  if (device === 'gamepad') return 'Y';
  return kind === 1 ? 'F' : 'E';
}

/** The localized text key for a prompt key (`interact.enterVehicle` and the engine's reason keys). */
export function promptTextKey(p: Pick<HudPrompt, 'key' | 'reason'>): string {
  return p.reason ?? p.key;
}

/** Wallet text in whole dollars (game money is integer cents). */
export function dollars(cents: number): string {
  const d = Math.trunc(cents / 100);
  return `$${d.toLocaleString('en-US')}`;
}

/** 24 h clock text from the fractional hour. */
export function clockText(hour: number): string {
  const h = Math.floor(((hour % 24) + 24) % 24);
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---- motion table: one row per animated HUD element; the flash-limit test reads it and the stylesheet

export interface HudMotion { id: string; periodMs: number; flashesPerPeriod: number }

/** WCAG 2.2 SC 2.3.1: no more than three flashes in any one second. */
export const MAX_FLASHES_PER_SECOND = 3;

export const HUD_MOTION: readonly HudMotion[] = [
  { id: 'heat-searching', periodMs: 1200, flashesPerPeriod: 1 },
  { id: 'heat-wanted', periodMs: 1600, flashesPerPeriod: 2 },
  { id: 'wallet-change', periodMs: 4000, flashesPerPeriod: 1 },
  { id: 'prompt-hold', periodMs: 1000, flashesPerPeriod: 0 },
  { id: 'low-health', periodMs: 1500, flashesPerPeriod: 1 },
];

export const flashesPerSecond = (m: HudMotion): number => (m.flashesPerPeriod * 1000) / m.periodMs;
