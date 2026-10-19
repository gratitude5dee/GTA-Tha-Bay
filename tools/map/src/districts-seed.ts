/**
 * The 41 Analysis Neighborhoods of 02-world-bake.md section 8 and the DistrictRecord list of WorldIndex.districts.
 */
import type { DistrictRecord } from '../../../packages/shared/src/index.ts';
import { loadDensity } from './config.ts';
import { loadContentWorld, type DistrictsFile } from './content.ts';

export const NEIGHBOURHOODS_41: readonly string[] = [
  'Bayview Hunters Point', 'Bernal Heights', 'Castro/Upper Market', 'Chinatown', 'Excelsior', 'Financial District/South Beach', 'Glen Park',
  'Golden Gate Park', 'Haight Ashbury', 'Hayes Valley', 'Inner Richmond', 'Inner Sunset', 'Japantown', 'Lakeshore', 'Lincoln Park',
  'Lone Mountain/USF', 'Marina', 'McLaren Park', 'Mission', 'Mission Bay', 'Nob Hill', 'Noe Valley', 'North Beach', 'Oceanview/Merced/Ingleside',
  'Outer Mission', 'Outer Richmond', 'Pacific Heights', 'Portola', 'Potrero Hill', 'Presidio', 'Presidio Heights', 'Russian Hill', 'Seacliff',
  'South of Market', 'Sunset/Parkside', 'Tenderloin', 'Treasure Island', 'Twin Peaks', 'Visitacion Valley', 'Western Addition', 'West of Twin Peaks',
];

export const slugOf = (name: string): string => name.toLowerCase().replace(/[/\s]+/g, '-');

/**
 * DistrictRecord list from content/world/districts.json (M02a2 replaced the hard-coded table of M02a1, BD-M02a2-06): the 12
 * districts, then the 41 neighbourhoods, each with the index of its density profile in config/world/density.json.
 */
export function districtRecords(content: { districts: DistrictsFile }, density: { profiles: { name: string }[] }): DistrictRecord[] {
  const names = density.profiles.map((p) => p.name);
  const idx = (n: string): number => {
    const i = names.indexOf(n);
    if (i < 0) throw new Error(`S9: density profile "${n}" is not in config/world/density.json profiles`);
    return i;
  };
  const out: DistrictRecord[] = [];
  for (const d of content.districts.districts) {
    out.push({ id: d.id, kind: 'district', parent: null, nameKey: `district.${d.id}`, tier: d.tier, nhoods: d.nhoods.map(slugOf), densityProfile: idx(d.profile) });
    for (const n of d.nhoods) {
      const slug = slugOf(n);
      out.push({ id: slug, kind: 'nhood', parent: d.id, nameKey: `nhood.${slug}`, tier: d.tier, nhoods: [], densityProfile: idx(content.districts.nhoodProfile?.[n] ?? d.profile) });
    }
  }
  return out.sort((a, b) => (a.kind === b.kind ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.kind === 'district' ? -1 : 1));
}

export function districtSeeds(): DistrictRecord[] {
  return districtRecords(loadContentWorld(), loadDensity());
}
