/**
 * Per-vehicle heat and impound strikes (M03c rule 4). The heat a vehicle carries is the sum of the points the player earned while
 * driving it: police recognise the car. A respray, or switching to another car, leaves the player's own heat alone and (for the
 * respray) clears the car's. A bust adds an impound strike to the car the player was in; at `impoundStrikes` the car is impounded.
 *
 * Sim code under the C02 lint.
 */
import type { Fnv64 } from '@dv/shared';

export class VehicleHeat {
  private readonly heat = new Map<string, number>();
  private readonly strikes = new Map<string, number>();
  private readonly impounded = new Set<string>();

  add(key: string, points: number): void {
    if (points <= 0) return;
    this.heat.set(key, (this.heat.get(key) ?? 0) + points);
  }

  get(key: string): number {
    return this.heat.get(key) ?? 0;
  }

  /** Clears the car's heat; the strikes stay. */
  respray(key: string): void {
    this.heat.delete(key);
  }

  strikesOf(key: string): number {
    return this.strikes.get(key) ?? 0;
  }

  /** Adds a strike; returns the new count. */
  strike(key: string): number {
    const n = (this.strikes.get(key) ?? 0) + 1;
    this.strikes.set(key, n);
    return n;
  }

  impound(key: string): void {
    this.impounded.add(key);
  }

  isImpounded(key: string): boolean {
    return this.impounded.has(key);
  }

  clear(): void {
    this.heat.clear();
    this.strikes.clear();
    this.impounded.clear();
  }

  private sortedKeys(): string[] {
    const all = new Set<string>([...this.heat.keys(), ...this.strikes.keys(), ...this.impounded]);
    return [...all].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  hash(h: Fnv64): void {
    const keys = this.sortedKeys();
    h.u32(keys.length);
    for (const k of keys) h.str(k).f64(this.get(k)).u32(this.strikesOf(k)).u8(this.impounded.has(k) ? 1 : 0);
  }
}
