/**
 * The 41 Analysis Neighborhoods and the 10 gameplay districts of 02-world-bake.md section 8, as DistrictRecord seeds for
 * WorldIndex.districts. M02a2 replaces this table with content/world/districts.json (BD note in the decision log).
 */
import type { DistrictRecord } from '../../../packages/shared/src/index.ts';

export const NEIGHBOURHOODS_41: readonly string[] = [
  'Bayview Hunters Point', 'Bernal Heights', 'Castro/Upper Market', 'Chinatown', 'Excelsior', 'Financial District/South Beach', 'Glen Park',
  'Golden Gate Park', 'Haight Ashbury', 'Hayes Valley', 'Inner Richmond', 'Inner Sunset', 'Japantown', 'Lakeshore', 'Lincoln Park',
  'Lone Mountain/USF', 'Marina', 'McLaren Park', 'Mission', 'Mission Bay', 'Nob Hill', 'Noe Valley', 'North Beach', 'Oceanview/Merced/Ingleside',
  'Outer Mission', 'Outer Richmond', 'Pacific Heights', 'Portola', 'Potrero Hill', 'Presidio', 'Presidio Heights', 'Russian Hill', 'Seacliff',
  'South of Market', 'Sunset/Parkside', 'Tenderloin', 'Treasure Island', 'Twin Peaks', 'Visitacion Valley', 'Western Addition', 'West of Twin Peaks',
];

export const slugOf = (name: string): string => name.toLowerCase().replace(/[/\s]+/g, '-');

interface District { id: string; name: string; tier: 'A' | 'B' | 'C' | 'stage'; nhoods: string[] }
const DISTRICTS: readonly District[] = [
  { id: 'd1', name: 'SoMa & Mission Bay', tier: 'A', nhoods: ['South of Market', 'Mission Bay'] },
  { id: 'd2', name: 'Mission', tier: 'A', nhoods: ['Mission', 'Bernal Heights'] },
  { id: 'd3', name: 'Bayview-Hunters Point', tier: 'A', nhoods: ['Bayview Hunters Point'] },
  { id: 'd4', name: 'Civic Center, Tenderloin & Hayes Valley', tier: 'B', nhoods: ['Tenderloin', 'Hayes Valley', 'Western Addition', 'Japantown'] },
  { id: 'd5', name: 'FiDi & Embarcadero', tier: 'A', nhoods: ['Financial District/South Beach'] },
  { id: 'd6', name: 'Chinatown, North Beach & the Hills', tier: 'A', nhoods: ['Chinatown', 'North Beach', 'Nob Hill', 'Russian Hill'] },
  { id: 'd7', name: 'Marina, Presidio & Golden Gate approach', tier: 'B', nhoods: ['Marina', 'Presidio', 'Presidio Heights', 'Pacific Heights', 'Seacliff'] },
  {
    id: 'd8', name: 'Haight, Golden Gate Park, Richmond, Sunset', tier: 'B',
    nhoods: ['Haight Ashbury', 'Golden Gate Park', 'Inner Richmond', 'Outer Richmond', 'Inner Sunset', 'Sunset/Parkside', 'Lone Mountain/USF', 'Lincoln Park'],
  },
  { id: 'd9', name: 'Twin Peaks, Glen Park & the Hills', tier: 'B', nhoods: ['Twin Peaks', 'Glen Park', 'West of Twin Peaks', 'Noe Valley', 'Castro/Upper Market'] },
  { id: 'd10', name: 'Treasure Island', tier: 'B', nhoods: ['Treasure Island'] },
  {
    id: 'outer', name: 'Outer neighbourhoods', tier: 'C',
    nhoods: ['Potrero Hill', 'Portola', 'Visitacion Valley', 'Excelsior', 'Outer Mission', 'Oceanview/Merced/Ingleside', 'Lakeshore', 'McLaren Park'],
  },
  { id: 'stage', name: 'Alcatraz', tier: 'stage', nhoods: [] },
];

export function districtSeeds(): DistrictRecord[] {
  const out: DistrictRecord[] = [];
  for (const d of DISTRICTS) {
    out.push({ id: d.id, kind: 'district', parent: null, nameKey: `district.${d.id}`, tier: d.tier, nhoods: d.nhoods.map(slugOf), densityProfile: 0 });
  }
  for (const d of DISTRICTS) {
    for (const n of d.nhoods) out.push({ id: slugOf(n), kind: 'nhood', parent: d.id, nameKey: `nhood.${slugOf(n)}`, tier: d.tier, nhoods: [], densityProfile: 0 });
  }
  return out.sort((a, b) => (a.kind === b.kind ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.kind === 'district' ? -1 : 1));
}
