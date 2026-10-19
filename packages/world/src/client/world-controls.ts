/**
 * The world controls of the QA debug panel (M02c1): what the teleports, the GPS route and the world edges look like from the
 * default QA scene. Open `/?debug=1` on a `DV_WORLD=synth` QA build; the box under the sky controls has
 *
 *  - "go to": the sandbox landmark list; Go teleports the player there (fade out, move, fade in);
 *  - "gps to": the same list; Route asks the sim for the GPS route from where the player stands and shows its length and time,
 *    Clear drops it (the minimap that draws it is M02c2);
 *  - "edges": Coast puts the player 30 m inland of the south coast (walk south to swim and be put back on the shore), County
 *    puts it 100 m inside a county-line barrier (walk east to meet the barrier, the fog and the boundary event).
 *
 * Plain DOM, QA builds only (it is created by the bridge, which production builds do not contain).
 */
import type { Portal, ShoreNode, TeleportResult } from '@dv/shared';
import type { WorldBridge } from './world-bridge.ts';

type Bridge = Pick<WorldBridge, 'teleport' | 'call' | 'map' | 'lastBoundaryEvent' | 'boundaryEvents'>;

interface Candidate {
  id: string;
  nameKey: string;
  x: number;
  z: number;
}

const label = (nameKey: string): string =>
  (nameKey.slice(nameKey.lastIndexOf('.') + 1))
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

const compass = (dx: number, dz: number): string => {
  const a = Math.atan2(dx, -dz) * (180 / Math.PI);   // 0 north, 90 east
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return names[(((Math.round(a / 45) % 8) + 8) % 8)] as string;
};

export function mountWorldControls(container: HTMLElement, bridge: Bridge): { root: HTMLElement; dispose(): void } {
  const doc = container.ownerDocument;
  const root = doc.createElement('div');
  root.dataset['dvWorldControls'] = '';
  Object.assign(root.style, {
    position: 'fixed', insetBlockStart: '262px', insetInlineStart: '8px', zIndex: '9', padding: '6px 8px', maxWidth: '300px',
    font: '12px/1.35 ui-monospace, Menlo, Consolas, monospace', color: '#d8f5d0', background: 'rgb(0 0 0 / 0.7)', borderRadius: '6px',
  });
  const grid = doc.createElement('div');
  grid.style.cssText = 'display:grid;gap:4px';
  root.append(grid);
  const row = (name: string, ...els: HTMLElement[]): HTMLElement => {
    const r = doc.createElement('div');
    r.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap';
    const t = doc.createElement('span');
    t.textContent = name;
    t.style.minWidth = '56px';
    r.append(t, ...els);
    grid.append(r);
    return r;
  };
  const button = (text: string, testid: string, on: () => void): HTMLButtonElement => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.dataset['testid'] = testid;
    b.style.cssText = 'font:inherit;padding:1px 8px;cursor:pointer';
    b.addEventListener('click', on);
    return b;
  };
  const select = (testid: string): HTMLSelectElement => {
    const s = doc.createElement('select');
    s.dataset['testid'] = testid;
    s.style.cssText = 'font:inherit;max-width:170px';
    return s;
  };
  const out = doc.createElement('div');
  out.dataset['testid'] = 'world-controls-out';
  out.style.cssText = 'white-space:pre-wrap;min-height:2.7em';
  out.textContent = 'world: loading the landmark list';

  const goSel = select('world-go');
  const gpsSel = select('world-gps');
  const say = (s: string): void => void (out.textContent = s);

  const go = async (to: string | { x: number; z: number }, what: string): Promise<TeleportResult | null> => {
    say(`teleporting to ${what}`);
    const r = await bridge.teleport(to, 'debug');
    say(r === null ? `${what}: no answer` : r.ok ? `at ${what} (${r.x.toFixed(0)}, ${r.z.toFixed(0)})` : `${what}: ${r.reason} (${r.messageKey})`);
    return r;
  };

  row('go to', goSel, button('Go', 'world-go-button', () => void go(goSel.value, goSel.selectedOptions[0]?.textContent ?? goSel.value)));
  row('gps to', gpsSel,
    button('Route', 'world-route-button', () => {
      const c = byId.get(gpsSel.value);
      if (!c) return;
      void bridge.call('map', { what: 'route', x: c.x, z: c.z }).then(() => say(`gps set to ${gpsSel.selectedOptions[0]?.textContent ?? ''}`));
    }),
    button('Clear', 'world-route-clear', () => void bridge.call('map', { what: 'clearRoute' }).then(() => say('gps cleared'))),
  );
  row('edges',
    button('Coast', 'world-edge-coast', () => {
      void (async () => {
        const near = await go({ x: 1180, z: 8100 }, 'the south coast');
        if (!near?.ok) return;
        const shore = ((await bridge.call('shore', { x: near.x, z: near.z })) as { node: ShoreNode | null } | null)?.node;
        if (!shore) return say('no shore node near the south coast');
        const r = await go({ x: shore.x - shore.nx * 30, z: shore.z - shore.nz * 30 }, 'the south coast');
        if (r?.ok) say(`30 m inland of the water: walk ${compass(shore.nx, shore.nz)}; you swim, fade out and come back on the shore`);
      })();
    }),
    button('County', 'world-edge-county', () => {
      void (async () => {
        const portals = ((await bridge.call('portals')) as { portals: Portal[] } | null)?.portals.filter((p) => p.kind === 'county-line') ?? [];
        for (const p of portals) {
          const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
          const r = await go({ x: p.x - fx * 100, z: p.z - fz * 100 }, 'the county line');
          if (r?.ok && Math.hypot(r.x - (p.x - fx * 100), r.z - (p.z - fz * 100)) <= 1) {
            say(`100 m inside the county line: walk ${compass(fx, fz)}; the fog closes in and a barrier stops you`);
            return;
          }
        }
        say('no county-line portal could be reached');
      })();
    }),
  );
  const stat = doc.createElement('div');
  stat.dataset['testid'] = 'world-controls-stat';
  stat.style.cssText = 'opacity:0.8';
  grid.append(out, stat);

  const byId = new Map<string, Candidate>();
  void bridge.call('candidates', { kind: 'sandbox' }).then((list) => {
    for (const c of (list as Candidate[] | null) ?? []) {
      byId.set(c.id, c);
      for (const sel of [goSel, gpsSel]) {
        const o = doc.createElement('option');
        o.value = c.id;
        o.textContent = label(c.nameKey);
        sel.append(o);
      }
    }
    say(`${byId.size} landmarks; pick one and press Go`);
  });

  // the route and the boundary event as they arrive
  const timer = setInterval(() => {
    const m = bridge.map();
    const route = (m?.route ?? null) as { lengthM: number; etaS: number; complete: boolean } | null;
    const b = bridge.lastBoundaryEvent();
    stat.textContent = `${route ? `gps ${(route.lengthM / 1000).toFixed(2)} km, ${Math.max(1, Math.round(route.etaS / 60))} min${route.complete ? '' : ' (partial)'}` : 'no gps route'} | boundary events ${bridge.boundaryEvents()}${b ? ` (${b.s})` : ''}`;
  }, 500);

  container.append(root);
  return { root, dispose: () => { clearInterval(timer); root.remove(); } };
}
