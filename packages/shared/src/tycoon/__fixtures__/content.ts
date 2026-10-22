/** Test and fixture access to the repository content (the pure core takes content as an argument; tests read it here). */
import archetypes from '../../../../../content/tycoon/archetypes.json';
import sectors from '../../../../../content/tycoon/sectors.json';
import theses from '../../../../../content/tycoon/theses.json';
import business from '../../../../../content/tycoon/events/business.json';
import political from '../../../../../content/tycoon/events/political.json';
import natural from '../../../../../content/tycoon/events/natural.json';
import cultural from '../../../../../content/tycoon/events/cultural.json';
import market from '../../../../../content/tycoon/events/market.json';
import locale from '../../../../../content/ui/i18n/en.json';
import balance from '../../../../../config/tycoon.balance.json';
import { buildContent } from '../content.ts';
import type { TycoonContent } from '../types.ts';

export const EVENT_FILES = [business, political, natural, cultural, market];
export const RAW_CONTENT = { sectors, theses, archetypes, balance, events: EVENT_FILES };
export const LOCALE = locale as Record<string, string>;

export function testContent(): TycoonContent {
  return buildContent({ ...RAW_CONTENT, locale: LOCALE });
}
