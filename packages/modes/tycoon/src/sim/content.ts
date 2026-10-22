/** The bundled tycoon content, validated once on first use. The pure core takes content as an argument; this is where the mode gets it. */
import { buildContent, type TycoonContent } from '@dv/shared/tycoon';
import archetypes from '../../../../../content/tycoon/archetypes.json';
import sectors from '../../../../../content/tycoon/sectors.json';
import theses from '../../../../../content/tycoon/theses.json';
import balance from '../../../../../config/tycoon.balance.json';

let cached: TycoonContent | null = null;

export function tycoonContent(): TycoonContent {
  if (cached === null) cached = buildContent({ sectors, theses, archetypes, balance });
  return cached;
}
