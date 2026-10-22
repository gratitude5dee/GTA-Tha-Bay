/**
 * The screens of the phone apps (M04b2). Pure functions of `PhoneEnv`: the page reads the view models once per render, builds the
 * env and hands the tree to `ScreenHost`; the unit tests call these directly. Rows are already-localized data.
 */
import { lk, t } from '../i18n/index.ts';
import { garageScreen, type GarageCard } from '../pages/garage.tsx';
import type { ListRow, ScreenDef, Widget } from '../screen/types.ts';
import { dollars } from '../hud/model.ts';

export interface RideDestination { id: string; nameKey: string; x: number; z: number }

export interface PhoneEnv {
  /** The id of the running top-level mode, or null. */
  mode: string | null;
  /** Mode tiles as rows (Jobs); built with `tileRows` by the page. */
  jobs: ListRow[];
  /** Cash in cents, when the wallet is known. */
  cashCents: number | undefined;
  garage: GarageCard[];
  /** `phone.ride` from the sim: `ready` is false while no baked world runs. */
  ride: { ready: boolean; destinations: RideDestination[] } | undefined;
  /** The current heat level (the Sandbox app shows it). */
  heat: number;
  neverWanted: boolean;
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

export function appScreen(id: string, env: PhoneEnv): ScreenDef {
  const head = (key: string): Widget[] => [{ k: 'heading', text: lk(key), level: 1 }];
  switch (id) {
    case 'map':
      return { id: 'app-map', title: lk('phone.app.map'), children: [...head('phone.app.map'), { k: 'text', text: lk('phone.map.note'), tone: 'muted' }, back()] };
    case 'jobs':
      return {
        id: 'app-jobs',
        title: lk('phone.app.jobs'),
        children: [...head('phone.app.jobs'), { k: 'list', id: 'phone-jobs', rows: env.jobs, onPress: { call: 'phone.job' }, empty: lk('modes.empty') }, back()],
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
    case 'sandbox': {
      const heat = (n: number): Widget => ({
        k: 'button', id: `heat-${n}`, label: lk(`phone.sandbox.heat${n}`), style: env.heat === n ? 'primary' : 'secondary', onPress: { cmd: { t: 'sandbox.set', path: 'sandbox.player.heat', v: n } },
      });
      return {
        id: 'app-sandbox',
        title: lk('phone.app.sandbox'),
        children: [
          ...head('phone.app.sandbox'),
          { k: 'text', text: lk('phone.sandbox.note'), tone: 'muted' },
          { k: 'heading', text: lk('phone.sandbox.heat'), level: 2 },
          heat(0), heat(1), heat(2), heat(3), heat(4), heat(5),
          {
            k: 'button', id: 'never-wanted', label: lk(env.neverWanted ? 'phone.sandbox.neverOn' : 'phone.sandbox.neverOff'), style: env.neverWanted ? 'primary' : 'secondary',
            onPress: { cmd: { t: 'sandbox.set', path: 'sandbox.player.neverWanted', v: !env.neverWanted } },
          },
          back(),
        ],
      };
    }
    case 'settings':
      return { id: 'app-settings', title: lk('phone.app.settings'), children: [...head('phone.app.settings'), { k: 'button', id: 'open-settings', label: lk('nav.settings'), style: 'primary', onPress: { nav: 'settings', params: { cat: 'graphics' } } }, back()] };
    case 'help':
      return { id: 'app-help', title: lk('phone.app.help'), children: [...head('phone.app.help'), { k: 'button', id: 'open-help', label: lk('nav.help'), style: 'primary', onPress: { nav: 'help' } }, back()] };
    default:
      return { id: `app-${id}`, title: lk(`phone.app.${id}`), children: [...head(`phone.app.${id}`), { k: 'text', text: lk('phone.soon'), tone: 'muted' }, back()] };
  }
}
