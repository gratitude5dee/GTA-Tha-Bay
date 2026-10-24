import { compileRealNames } from '../../../../../shared/src/assets/gates/names.ts';
import type { Fixture } from '../base.ts';
import { baseEnv, baseMission, LINES } from '../base.ts';

/** A line whose text holds a real-side name (the registry here is a made-up one). */
export default {
  code: 'E_NAME',
  pointer: '/stages/0/onEnter/0/line',
  build: baseMission,
  env: () =>
    baseEnv({
      names: compileRealNames([{ id: 'zed', real: 'Zed Zeppelin' }]),
      lineText: { ...LINES, 'line.t.hello': 'Hello from Zed Zeppelin.' },
    }),
} satisfies Fixture;
