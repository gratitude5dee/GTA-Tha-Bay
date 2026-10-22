/**
 * The OSM line of the boot splash (M02c2; 02-world-maps.md section 6 rule 1): the OpenStreetMap credit is shown for 3 s from the
 * first paint of the shell, on top of whatever page is up, then removed. The text is the `osm` entry of `config/attribution.world.json`.
 */
import { useEffect, useState } from 'preact/hooks';
import attribution from '../../../../config/attribution.world.json';

export const SPLASH_ATTRIBUTION_MS = 3000;

export function splashLine(entries: readonly { id: string; text: string }[] = (attribution as { entries: { id: string; text: string }[] }).entries): string {
  return entries.find((e) => e.id === 'osm')?.text ?? '© OpenStreetMap contributors';
}

export function AttributionSplash() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setOn(false), SPLASH_ATTRIBUTION_MS);
    return () => clearTimeout(id);
  }, []);
  if (!on) return null;
  return (
    <div class="dv-splash-attrib" data-testid="attribution-splash" role="status">
      {splashLine()}
    </div>
  );
}
