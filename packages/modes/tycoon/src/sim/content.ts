/** The bundled tycoon content, validated once on first use. The pure core takes content as an argument; this is where the mode gets it. */
import { buildContent, type TycoonContent } from '@dv/shared/tycoon';
import archetypes from '../../../../../content/tycoon/archetypes.json';
import sectors from '../../../../../content/tycoon/sectors.json';
import theses from '../../../../../content/tycoon/theses.json';
import business from '../../../../../content/tycoon/events/business.json';
import political from '../../../../../content/tycoon/events/political.json';
import natural from '../../../../../content/tycoon/events/natural.json';
import cultural from '../../../../../content/tycoon/events/cultural.json';
import market from '../../../../../content/tycoon/events/market.json';
import balance from '../../../../../config/tycoon.balance.json';

let cached: TycoonContent | null = null;

export function tycoonContent(): TycoonContent {
  if (cached === null) cached = buildContent({ sectors, theses, archetypes, balance, events: [business, political, natural, cultural, market] });
  return cached;
}
