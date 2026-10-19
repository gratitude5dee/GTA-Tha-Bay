/** Run in a fresh process by compile.spec.ts: prints `<id> <prompt sha256> <public sha256>` for every shipped soul. */
import { compileSoul, promptHash, publicSoulHash } from '../../../src/npc/compile.ts';
import { SHIPPED_IDS, rulesBlock, shippedSoul } from './souls.ts';

const rules = rulesBlock();
for (const id of SHIPPED_IDS) {
  const out = compileSoul(shippedSoul(id), rules);
  console.log(`${id} ${promptHash(out.promptTxt)} ${publicSoulHash(out.publicSoul)}`);
}
