/** Loader of the Tycoon event catalog: flattens the five content files, sorts by id and validates (08-tycoon-events.md section 5.5). */
import { validateEvents } from '../../events/validate.ts';
import type { EventDef } from '../../events/types.ts';

export class CatalogError extends Error {
  constructor(message: string) {
    super(`tycoon content: ${message}`);
    this.name = 'ContentError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The ten events that also run on story businesses (section 7). */
export const BOTH_SCOPE_IDS: readonly string[] = [
  'biz.cloud_bill_spike', 'biz.engineer_poached', 'cul.meme_moment', 'cul.parade_week', 'nat.atmospheric_river',
  'nat.blackout', 'nat.fog_week', 'nat.quake_minor', 'pol.city_grant', 'pol.payroll_tax',
];

/** `files` is a list of `{schema, events}` objects. With `locale`, every LocKey must exist in it. */
export function loadCatalog(files: unknown, locale?: Record<string, string>): EventDef[] {
  if (!Array.isArray(files)) throw new CatalogError('events must be a list of event files');
  const defs: EventDef[] = [];
  for (const [i, f] of (files as unknown[]).entries()) {
    if (!isObj(f) || !Array.isArray(f['events'])) throw new CatalogError(`events file ${i} needs an "events" array`);
    defs.push(...(f['events'] as EventDef[]));
  }
  defs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const v = validateEvents(defs, { hasKey: (k) => (locale ? locale[k] !== undefined : true) });
  const first = v.errors[0];
  if (first) throw new CatalogError(`event ${first.id}: ${first.rule}: ${first.detail}`);
  return defs;
}

/** The defs with the given scope or `both`. */
export const withScope = (defs: readonly EventDef[], scope: 'tycoon' | 'business'): EventDef[] => defs.filter((d) => d.scope === scope || d.scope === 'both');
