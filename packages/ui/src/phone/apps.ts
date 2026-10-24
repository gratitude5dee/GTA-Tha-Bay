/**
 * The screens of the phone apps (M04b2). Pure functions of `PhoneEnv`: the page reads the view models once per render, builds the
 * env and hands the tree to `ScreenHost`; the unit tests call these directly. Rows are already-localized data.
 */
import { lk, t, type LocKey } from '../i18n/index.ts';
import { garageScreen, type GarageCard } from '../pages/garage.tsx';
import type { ListRow, ScreenDef, UiAction, Widget } from '../screen/types.ts';
import { clockText, dollars } from '../hud/model.ts';

export interface RideDestination { id: string; nameKey: string; x: number; z: number }

/** `mode.sandbox.world` (M04e1): what the Weather, Time and World tabs of the Sandbox app show. */
export interface SandboxWorldView {
  /** The held preset, or null for "Natural". */
  weather: string | null;
  hour: number;
  paused: boolean;
  sync: boolean;
  timeScale: number;
  blackout: boolean;
  density: { traffic: number; ped: number; parked: number };
  /** `config/clock.json` `sandboxShortcuts` ids, in order. */
  shortcuts: string[];
  online: boolean;
}

export const SANDBOX_WORLD_DEFAULT: SandboxWorldView = {
  weather: null, hour: 12, paused: false, sync: false, timeScale: 1, blackout: false, density: { traffic: 1, ped: 1, parked: 1 }, shortcuts: [], online: false,
};

const WEATHER_IDS = ['clear', 'karl-fog', 'overcast', 'rain', 'smoke', 'golden'] as const;
const SPEEDS: readonly { v: number; id: string }[] = [{ v: 0.25, id: '025' }, { v: 0.5, id: '05' }, { v: 1, id: '1' }, { v: 2, id: '2' }];
const DENSITY_LEVELS: readonly { v: number; id: string }[] = [{ v: 0, id: 'off' }, { v: 0.35, id: 'light' }, { v: 1, id: 'normal' }, { v: 1.5, id: 'busy' }];
const DENSITY_KINDS = ['traffic', 'ped', 'parked'] as const;

/** The hour an hour-step button sets: rounded to half hours and wrapped into 0 to 23.5. */
export function stepHour(hour: number, delta: number): number {
  const h = Math.round((hour + delta) * 2) / 2;
  return ((h % 24) + 24) % 24;
}

export interface PhoneEnv {
  /** The id of the running top-level mode, or null. */
  mode: string | null;
  /** Mode tiles as rows (Jobs); built with `tileRows` by the page. */
  jobs: ListRow[];
  /** Story missions as rows (Jobs, M05c1); built with `missionRows` from `mode.story.jobs`. */
  missions?: ListRow[];
  /** Cash in cents, when the wallet is known. */
  cashCents: number | undefined;
  garage: GarageCard[];
  /** `phone.ride` from the sim: `ready` is false while no baked world runs. */
  ride: { ready: boolean; destinations: RideDestination[] } | undefined;
  /** The current heat level (the Sandbox app shows it). */
  heat: number;
  neverWanted: boolean;
  /** `mode.sandbox.world`; absent until the sandbox has published it. */
  sandboxWorld?: SandboxWorldView | undefined;
  /** Home screen rows. */
  appRows: ListRow[];
}

/** A place name: the catalog entry when there is one, else the id made readable. */
export function placeName(nameKey: string, id: string): string {
  const s = t(nameKey);
  if (s !== nameKey) return s;
  return id.replace(/^(transit|station|st)[._-]/, '').replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const back = (): Widget => ({ k: 'button', id: 'phone-home', label: lk('phone.home'), style: 'secondary', onPress: { call: 'phone.home' } });

export function homeScreen(env: Pick<PhoneEnv, 'appRows'>): ScreenDef {
  return {
    id: 'phone',
    title: lk('phone.title'),
    children: [
      { k: 'heading', text: lk('phone.title'), level: 1 },
      { k: 'list', id: 'phone-apps', rows: env.appRows, onPress: { call: 'phone.open' }, empty: lk('phone.empty') },
      { k: 'button', id: 'phone-close', label: lk('phone.close'), style: 'primary', onPress: { back: true } },
    ],
  };
}

/** The Sandbox app: a `tabs` widget with the player (heat), weather, time and world sections (M04e1). */
function sandboxScreen(env: PhoneEnv): ScreenDef {
  const w = env.sandboxWorld ?? SANDBOX_WORLD_DEFAULT;
  const off = w.online ? { disabled: lk('sandbox.refuse.online') } : {};
  const set = (path: string, v: boolean | number): UiAction => ({ cmd: { t: 'sandbox.set', path, v } });
  const btn = (id: string, label: LocKey, on: boolean, onPress: UiAction): Widget => ({ k: 'button', id, label, style: on ? 'primary' : 'secondary', onPress, ...off });
  const heat = (n: number): Widget => ({
    k: 'button', id: `heat-${n}`, label: lk(`phone.sandbox.heat${n}`), style: env.heat === n ? 'primary' : 'secondary', onPress: set('sandbox.player.heat', n),
  });
  const player: Widget[] = [
    { k: 'heading', text: lk('phone.sandbox.heat'), level: 2 },
    heat(0), heat(1), heat(2), heat(3), heat(4), heat(5),
    {
      k: 'button', id: 'never-wanted', label: lk(env.neverWanted ? 'phone.sandbox.neverOn' : 'phone.sandbox.neverOff'), style: env.neverWanted ? 'primary' : 'secondary',
      onPress: set('sandbox.player.neverWanted', !env.neverWanted),
    },
  ];
  const weather: Widget[] = [
    { k: 'heading', text: lk('phone.sandbox.weather'), level: 2 },
    btn('weather-natural', lk('phone.sandbox.weather.natural'), w.weather === null, set('sandbox.weather.preset', -1)),
    ...WEATHER_IDS.map((p, i) => btn(`weather-${p}`, lk(`hud.weather.${p}`), w.weather === p, set('sandbox.weather.preset', i))),
  ];
  const time: Widget[] = [
    { k: 'heading', text: lk('phone.sandbox.time'), level: 2 },
    { k: 'text', text: lk('phone.sandbox.clockLine'), params: { label: t('hud.clock.label'), time: clockText(w.hour) } },
    btn('time-minus', lk('phone.sandbox.hourDown'), false, set('sandbox.time.hour', stepHour(w.hour, -1))),
    btn('time-plus', lk('phone.sandbox.hourUp'), false, set('sandbox.time.hour', stepHour(w.hour, 1))),
    btn('time-pause', lk(w.paused ? 'phone.sandbox.resume' : 'phone.sandbox.pause'), w.paused, set('sandbox.time.paused', !w.paused)),
    btn('time-sync', lk('phone.sandbox.matchClock'), w.sync, set('sandbox.time.sync', !w.sync)),
    ...w.shortcuts.map((id) => btn(`shortcut-${id}`, lk(`phone.sandbox.time.${id}`), false, { cmd: { t: 'mode.cmd', mode: 'sandbox', name: 'time.shortcut', args: { id } } })),
  ];
  const world: Widget[] = [
    { k: 'heading', text: lk('phone.sandbox.speed'), level: 2 },
    ...SPEEDS.map((sp) => btn(`speed-${sp.id}`, lk(`phone.sandbox.speed.${sp.id}`), w.timeScale === sp.v, set('sandbox.world.timeScale', sp.v))),
    btn('blackout', lk(w.blackout ? 'phone.sandbox.blackoutOn' : 'phone.sandbox.blackoutOff'), w.blackout, set('sandbox.world.blackout', !w.blackout)),
    ...DENSITY_KINDS.flatMap((kind): Widget[] => [
      { k: 'heading', text: lk(`phone.sandbox.density.${kind}`), level: 3 },
      ...DENSITY_LEVELS.map((lv) => btn(`density-${kind}-${lv.id}`, lk(`phone.sandbox.level.${lv.id}`), w.density[kind] === lv.v, set(`sandbox.world.density.${kind}`, lv.v))),
    ]),
    btn('world-reset', lk('phone.sandbox.reset'), false, { cmd: { t: 'mode.cmd', mode: 'sandbox', name: 'world.reset' } }),
  ];
  return {
    id: 'app-sandbox',
    title: lk('phone.app.sandbox'),
    children: [
      { k: 'heading', text: lk('phone.app.sandbox'), level: 1 },
      { k: 'text', text: lk('phone.sandbox.note'), tone: 'muted' },
      {
        k: 'tabs', id: 'sandbox-tabs',
        tabs: [
          { id: 'player', label: lk('phone.sandbox.tab.player'), children: player },
          { id: 'weather', label: lk('phone.sandbox.tab.weather'), children: weather },
          { id: 'time', label: lk('phone.sandbox.tab.time'), children: time },
          { id: 'world', label: lk('phone.sandbox.tab.world'), children: world },
        ],
      },
      back(),
    ],
  };
}

export function appScreen(id: string, env: PhoneEnv): ScreenDef {
  const head = (key: string): Widget[] => [{ k: 'heading', text: lk(key), level: 1 }];
  switch (id) {
    case 'map':
      return { id: 'app-map', title: lk('phone.app.map'), children: [...head('phone.app.map'), { k: 'text', text: lk('phone.map.unavailable'), tone: 'muted' }, back()] };
    case 'jobs':
      return {
        id: 'app-jobs',
        title: lk('phone.app.jobs'),
        children: [
          ...head('phone.app.jobs'),
          ...(env.missions && env.missions.length > 0
            ? [
                { k: 'heading', text: lk('phone.jobs.missions'), level: 2 } as Widget,
                { k: 'list', id: 'phone-missions', rows: env.missions, onPress: { call: 'phone.job' }, empty: lk('phone.jobs.empty') } as Widget,
                { k: 'heading', text: lk('phone.jobs.modes'), level: 2 } as Widget,
              ]
            : []),
          { k: 'list', id: 'phone-jobs', rows: env.jobs, onPress: { call: 'phone.job' }, empty: lk('modes.empty') },
          back(),
        ],
      };
    case 'garage': {
      const g = garageScreen(env.garage, true);
      return { ...g, id: 'app-garage', children: [...g.children.slice(0, -1), back()] };
    }
    case 'bank':
      return {
        id: 'app-bank',
        title: lk('phone.app.bank'),
        children: [
          ...head('phone.app.bank'),
          { k: 'text', text: lk('phone.bank.balance'), params: { amount: env.cashCents === undefined ? t('hud.empty') : dollars(env.cashCents) } },
          { k: 'text', text: lk('phone.bank.note'), tone: 'muted' },
          back(),
        ],
      };
    case 'ride': {
      const dest = env.ride?.destinations ?? [];
      const rows: ListRow[] = dest.map((d) => ({ id: d.id, text: placeName(d.nameKey, d.id), detail: t('phone.ride.railDetail') }));
      const body: Widget[] = !env.ride?.ready
        ? [{ k: 'text', text: lk('phone.ride.unavailable'), tone: 'muted' }]
        : [
            { k: 'text', text: lk('phone.ride.lead'), tone: 'muted' },
            { k: 'list', id: 'phone-ride', rows, onPress: { call: 'phone.ride.go' }, empty: lk('phone.ride.none') },
            { k: 'button', id: 'ride-taxi', label: lk('phone.ride.taxi'), style: 'secondary', onPress: { call: 'phone.ride.taxi' } },
          ];
      return { id: 'app-ride', title: lk('phone.app.ride'), children: [...head('phone.app.ride'), ...body, back()] };
    }
    case 'sandbox':
      return sandboxScreen(env);
    case 'settings':
      return { id: 'app-settings', title: lk('phone.app.settings'), children: [...head('phone.app.settings'), { k: 'button', id: 'open-settings', label: lk('nav.settings'), style: 'primary', onPress: { nav: 'settings', params: { cat: 'graphics' } } }, back()] };
    case 'help':
      return { id: 'app-help', title: lk('phone.app.help'), children: [...head('phone.app.help'), { k: 'button', id: 'open-help', label: lk('nav.help'), style: 'primary', onPress: { nav: 'help' } }, back()] };
    default:
      return { id: `app-${id}`, title: lk(`phone.app.${id}`), children: [...head(`phone.app.${id}`), { k: 'text', text: lk('phone.soon'), tone: 'muted' }, back()] };
  }
}

/** One row of `mode.story.jobs` (see `JobRow` in `@dv/mode-story`; the UI reads the view-model, never the package). */
export interface MissionJob {
  id: string;
  title: string;
  state: 'locked' | 'available' | 'active' | 'passed';
  trigger: string;
  giver?: string;
  needs?: string;
  medals?: number;
  bestSec?: number;
}

/** The Jobs rows of the missions: id `mis:<missionId>`; only an available or passed mission can be started (a replay). */
export function missionRows(jobs: readonly MissionJob[]): ListRow[] {
  return jobs.map((j) => {
    const state = t(`phone.jobs.state.${j.state}`);
    const row: ListRow = { id: `mis:${j.id}`, text: j.title, detail: state };
    if (j.state === 'locked') return { ...row, disabled: true, hint: j.needs ? t('phone.jobs.needs', { mission: j.needs }) : state };
    if (j.state === 'active') return { ...row, disabled: true, hint: state };
    return row;
  });
}
