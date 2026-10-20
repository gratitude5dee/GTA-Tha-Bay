/**
 * Fares and the fare sink (living part 3.6 and 5; M03b2). A fare is worked out in integer cents and handed to a `FareSink` with an
 * idempotency key `fare:<kind>:<tick>:<from>:<to>`. Until M04a2 binds the sink to C06 `EconomyApi.debit(cents, 'fare', idemKey)`, the
 * default sink only records the call. Pure; C02 lint applies.
 */
import { dsqrt } from '@dv/shared';
import transitJson from '../../../../../config/world/transit.json';
import { TRANSIT_CONFIG } from './components.ts';

export type FareKind = 'bay-rail' | 'robotaxi';

export interface FareCall {
  cents: number;
  kind: FareKind;
  idemKey: string;
}

/** The port the ride service charges through. A key already seen charges nothing again. */
export interface FareSink {
  charge(cents: number, kind: FareKind, idemKey: string): void;
}

/** The sink of this milestone: records each distinct call, so tests (and the demo's debug log) can read what would have been charged. */
export class RecordingFareSink implements FareSink {
  readonly calls: FareCall[] = [];
  private readonly seen = new Set<string>();

  charge(cents: number, kind: FareKind, idemKey: string): void {
    if (this.seen.has(idemKey)) return;
    this.seen.add(idemKey);
    this.calls.push({ cents, kind, idemKey });
  }
}

export const fareKey = (kind: FareKind, tick: number, from: string, to: string): string => `fare:${kind}:${tick}:${from}:${to}`;

/** Stops between two stations of the Bay Rail line order; 0 when either is not on the line. */
export function stopsBetween(from: string, to: string, order: readonly string[] = TRANSIT_CONFIG.bayRailOrder): number {
  const a = order.indexOf(from), b = order.indexOf(to);
  if (a < 0 || b < 0) return 0;
  return a > b ? a - b : b - a;
}

/** 200 cents + 50 cents per stop (a ride of 0 stops, to the same station, costs nothing and is refused by the ride service). */
export function bayRailFare(from: string, to: string, order: readonly string[] = TRANSIT_CONFIG.bayRailOrder, fares = FARES): number {
  const stops = stopsBetween(from, to, order);
  return stops === 0 ? 0 : fares['bay-rail'].baseCents + fares['bay-rail'].perStopCents * stops;
}

/** 300 cents + 120 cents per km, rounded to the cent. */
export function robotaxiFare(metres: number, fares = FARES): number {
  return fares.robotaxi.baseCents + Math.round((fares.robotaxi.perKmCents * metres) / 1000);
}

export const distanceM = (ax: number, az: number, bx: number, bz: number): number => dsqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));

/** The fare rows of `config/world/transit.json`. */
export const FARES = (transitJson as unknown as { fares: { 'bay-rail': { baseCents: number; perStopCents: number }; robotaxi: { baseCents: number; perKmCents: number } } }).fares;
