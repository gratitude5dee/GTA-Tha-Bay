import path from 'node:path';
import { createCanonicalRunner } from '../../../packages/engine/src/qa/runner.ts';
import { registerBot } from '../../../packages/engine/src/qa/bots.ts';
import { readFixturePacks } from '../../../packages/engine/src/qa/node.ts';
import { registerStoryQa, missionSpec, encodeBundle, createStoryAutoplayer } from '../../../packages/modes/story/src/qa.ts';
import { readBundle } from './bundle.ts';

const root = path.resolve(new URL(import.meta.url).pathname, '../../../..');
registerStoryQa();
const bundle = readBundle(root, 'm.dev.sample');
const stage = process.argv[2] && process.argv[2] !== '-' ? Number(process.argv[2]) : undefined;
const seed = process.argv[3] ? Number(process.argv[3]) : 1;
const every = process.argv[4] ? Number(process.argv[4]) : 180;
let handle: any = null;
registerBot('story.debug', () => {
  const inner = createStoryAutoplayer();
  let ctx: any;
  return {
    ...inner,
    init(c: any, p: any) {
      ctx = c;
      inner.init(c, p);
    },
    frame(tick: number) {
      const f = inner.frame(tick);
      if (tick % every === 0) {
        const o: any = ctx.observe();
        const v = inner.view();
        const me = o.me;
        console.log(
          `t${tick} ${o.phase} st${o.stage}:${o.stageId} sec${Math.round(o.sec)} obj=${v.objective} goal=${v.goal} me=${me ? me.pos.map((n: number) => n.toFixed(0)).join(',') : '-'} sp=${me?.speed.toFixed(1)} veh=${me?.vehicle ? 'Y' : 'n'} drift=${handle?.controller?.rt?.eventSum('score.drift')} yaw=${me?.vehicle ? me.vehicle.yaw.toFixed(2) : '-'} f=m${f.moveY}/th${f.throttle}/st${f.steer}/b${f.buttons}`,
        );
      }
      return f;
    },
  };
});
const runner = createCanonicalRunner({ packs: { ...readFixturePacks(root), mission: encodeBundle(bundle) }, processEnv: {}, onLoaded: (h) => (handle = h) });
const spec = missionSpec({ id: 'm.dev.sample', seed, expectedSecMax: 900, params: stage !== undefined ? { stage } : undefined });
spec.bot.driver = 'story.debug';
const t0 = Date.now();
const trace = await runner.run(spec);
console.log(JSON.stringify(trace.end), `${Date.now() - t0} ms`);
const rt = handle.controller.rt;
console.log(JSON.stringify(rt.debugState().objectives), rt.phase, rt.debugState().failReason);
