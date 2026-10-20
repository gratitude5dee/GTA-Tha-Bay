/** Per-class envelope (06-racing-content.md C.2). Content CI and the vehicle-mod validator reject any profile outside it. */
import type { ClassEnvelope, HandlingProfile, VehicleClass } from './handling.ts';

export const CLASS_ENVELOPE: Readonly<Record<VehicleClass, ClassEnvelope>> = Object.freeze({
  D: { class: 'D', massKg: [850, 3200], powerKw: [50, 160], muLat: [0.75, 0.95], topKph: [140, 185], zeroTo100Sec: [7.5, 12.0], piBand: [100, 399] },
  C: { class: 'C', massKg: [1000, 2100], powerKw: [120, 260], muLat: [0.92, 1.08], topKph: [200, 245], zeroTo100Sec: [5.5, 7.5], piBand: [400, 549] },
  B: { class: 'B', massKg: [1100, 2200], powerKw: [220, 420], muLat: [1.0, 1.15], topKph: [245, 285], zeroTo100Sec: [4.2, 5.6], piBand: [550, 699] },
  A: { class: 'A', massKg: [1200, 1900], powerKw: [300, 520], muLat: [1.2, 1.4], topKph: [300, 335], zeroTo100Sec: [3.0, 3.9], piBand: [700, 849] },
  S: { class: 'S', massKg: [1200, 2000], powerKw: [380, 900], muLat: [1.4, 1.65], topKph: [340, 380], zeroTo100Sec: [2.2, 3.2], piBand: [850, 999] },
  R: { class: 'R', massKg: [1800, 2400], powerKw: [100, 200], muLat: [0.6, 0.8], topKph: [100, 200], zeroTo100Sec: [6.5, 9.5], piBand: [250, 350] },
});

/** Oracle targets per class (C.2): braking distance from 100 kph in metres (+-8 %), brake g and durability. */
export const CLASS_ORACLE: Readonly<Record<VehicleClass, { brakeM: number; brakeG: number; durability: number }>> = Object.freeze({
  D: { brakeM: 46, brakeG: 0.85, durability: 1.3 },
  C: { brakeM: 39, brakeG: 1.0, durability: 1.2 },
  B: { brakeM: 38, brakeG: 1.05, durability: 1.15 },
  A: { brakeM: 30, brakeG: 1.3, durability: 1.0 },
  S: { brakeM: 26, brakeG: 1.5, durability: 0.9 },
  R: { brakeM: 56, brakeG: 0.7, durability: 1.5 },
});

const inside = (v: number, r: readonly [number, number]): boolean => v >= r[0] && v <= r[1];

/** The profile fields the envelope bounds without driving the car: mass, declared power and lateral mu. Empty list = inside. */
export function envelopeViolations(p: Pick<HandlingProfile, 'class' | 'massKg' | 'tire'> & { engine: { powerKw: number } }): string[] {
  const e = CLASS_ENVELOPE[p.class];
  const out: string[] = [];
  if (!inside(p.massKg, e.massKg)) out.push(`massKg ${p.massKg} outside ${e.massKg[0]}..${e.massKg[1]}`);
  if (!inside(p.engine.powerKw, e.powerKw)) out.push(`powerKw ${p.engine.powerKw} outside ${e.powerKw[0]}..${e.powerKw[1]}`);
  if (!inside(p.tire.muLat, e.muLat)) out.push(`muLat ${p.tire.muLat} outside ${e.muLat[0]}..${e.muLat[1]}`);
  return out;
}
