/** Test and fixture access to the repository content (the pure core takes content as an argument; tests read it here). */
import archetypes from '../../../../../content/tycoon/archetypes.json';
import sectors from '../../../../../content/tycoon/sectors.json';
import theses from '../../../../../content/tycoon/theses.json';
import balance from '../../../../../config/tycoon.balance.json';
import { buildContent } from '../content.ts';
import type { TycoonContent } from '../types.ts';

export const RAW_CONTENT = { sectors, theses, archetypes, balance };

export function testContent(): TycoonContent {
  return buildContent(RAW_CONTENT);
}
