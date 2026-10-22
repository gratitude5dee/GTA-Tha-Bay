import { lk } from '../i18n/index.ts';
import { gateOf } from './gates.ts';
import type { GateSpec, PageDef, PageId } from './types.ts';

/**
 * The page registry (10-ui.md section 2.5). Every page is a lazy chunk (`load`); the first paint of the main menu needs only the shell,
 * the kit and the `main` chunk. Pages whose milestone has not landed render the "Coming soon" screen (the A-06 pattern).
 */
const GATES: Partial<Record<PageId, GateSpec>> = {
  main: { attested: true },
  load: { attested: true },
  new: { attested: true },
  modes: { attested: true },
  garage: { attested: true },
  npcs: { flag: 'npc.builder', online: true, attested: true },
  community: { flag: 'forum.enabled', online: true, regionSensitive: true, attested: true },
  experiences: { online: true, regionSensitive: true, attested: true },
  mods: { flag: 'mods.enabled', online: true, attested: true },
  online: { flag: 'mp.enabled', online: true, regionSensitive: true, tier: 'device', attested: true },
  profile: { attested: true },
  saves: { attested: true },
  settings: {},
  help: {},
};

const soon = () => import('../pages/system.tsx').then((m) => ({ default: m.ComingSoonPage }));

const def = (d: Omit<PageDef, 'gate'>): PageDef => ({ ...d, gate: gateOf(GATES[d.id] ?? {}) });

export const PAGES: readonly PageDef[] = [
  def({ id: 'boot', route: null, titleKey: lk('boot.loading'), kind: 'overlay', xr: 'none', inputContext: 'menu', load: () => import('../pages/system.tsx').then((m) => ({ default: m.BootPage })), milestone: 'M00' }),
  def({ id: 'unsupported', route: null, titleKey: lk('unsupported.title'), kind: 'overlay', xr: 'none', inputContext: 'menu', load: () => import('../pages/system.tsx').then((m) => ({ default: m.BootPage })), milestone: 'M00' }),
  def({ id: 'title', route: '/', titleKey: lk('title.name'), kind: 'menu', xr: 'none', inputContext: 'menu', load: () => import('../pages/gate.tsx').then((m) => ({ default: m.TitlePage })), milestone: 'M04b1' }),
  def({ id: 'age', route: null, titleKey: lk('age.title'), kind: 'menu', xr: 'none', inputContext: 'menu', load: () => import('../pages/gate.tsx').then((m) => ({ default: m.AgePage })), milestone: 'M04b1' }),
  def({ id: 'blocked', route: null, titleKey: lk('blocked.title'), kind: 'menu', xr: 'none', inputContext: 'menu', load: () => import('../pages/gate.tsx').then((m) => ({ default: m.BlockedPage })), milestone: 'M04b1' }),
  def({ id: 'terms', route: null, titleKey: lk('terms.title'), kind: 'menu', xr: 'none', inputContext: 'menu', load: () => import('../pages/gate.tsx').then((m) => ({ default: m.TermsPage })), milestone: 'M04b1' }),
  def({ id: 'main', route: '/', titleKey: lk('nav.main'), kind: 'menu', xr: 'screen', inputContext: 'menu', load: () => import('../pages/main.tsx').then((m) => ({ default: m.MainPage })), milestone: 'M04b1' }),
  def({ id: 'load', route: '/menu/load', titleKey: lk('nav.continue'), kind: 'menu', xr: 'screen', inputContext: 'menu', load: () => import('../pages/saves.tsx').then((m) => ({ default: m.LoadPage })), milestone: 'M04b1' }),
  def({ id: 'new', route: '/menu/new', titleKey: lk('nav.new'), kind: 'menu', xr: 'exit', inputContext: 'menu', load: () => import('../pages/saves.tsx').then((m) => ({ default: m.NewGamePage })), milestone: 'M04b1' }),
  def({ id: 'creator', route: '/menu/creator', titleKey: lk('nav.new'), kind: 'menu', xr: 'exit', inputContext: 'menu', load: soon, milestone: 'M04b2' }),
  def({ id: 'modes', route: '/menu/modes', titleKey: lk('nav.modes'), kind: 'menu', xr: 'screen', inputContext: 'menu', load: () => import('../pages/modes.ts').then((m) => ({ default: m.ModesPage })), milestone: 'M04b1' }),
  def({ id: 'garage', route: '/menu/garage', titleKey: lk('nav.garage'), kind: 'menu', xr: 'screen', inputContext: 'menu', load: soon, milestone: 'M04b2' }),
  def({ id: 'npcs', route: '/menu/npcs', titleKey: lk('nav.npcs'), kind: 'menu', xr: 'exit', inputContext: 'menu', load: soon, milestone: 'M06b' }),
  def({ id: 'community', route: '/menu/community', titleKey: lk('nav.community'), kind: 'menu', xr: 'exit', inputContext: 'menu', load: soon, milestone: 'M13b' }),
  def({ id: 'experiences', route: '/menu/experiences', titleKey: lk('nav.experiences'), kind: 'menu', xr: 'exit', inputContext: 'menu', load: soon, milestone: 'M13a' }),
  def({ id: 'mods', route: '/menu/mods', titleKey: lk('nav.experiences'), kind: 'menu', xr: 'exit', inputContext: 'menu', load: soon, milestone: 'M13a' }),
  def({ id: 'online', route: '/menu/online', titleKey: lk('nav.online'), kind: 'menu', xr: 'screen', inputContext: 'menu', load: soon, milestone: 'M12b' }),
  def({ id: 'profile', route: '/menu/profile', titleKey: lk('nav.profile'), kind: 'menu', xr: 'screen', inputContext: 'menu', load: () => import('../pages/saves.tsx').then((m) => ({ default: m.ProfilePage })), milestone: 'M04b1' }),
  def({ id: 'saves', route: '/menu/saves', titleKey: lk('saves.title'), kind: 'menu', xr: 'screen', inputContext: 'menu', load: () => import('../pages/saves.tsx').then((m) => ({ default: m.SavesPage })), milestone: 'M04b1' }),
  def({ id: 'settings', route: '/menu/settings', titleKey: lk('nav.settings'), kind: 'menu', xr: 'screen', inputContext: 'menu', load: () => import('../pages/settings/index.ts').then((m) => ({ default: m.SettingsPage })), milestone: 'M04b1' }),
  def({ id: 'credits', route: '/menu/credits', titleKey: lk('credits.title'), kind: 'document', xr: 'exit', inputContext: 'menu', load: () => import('../pages/system.tsx').then((m) => ({ default: m.CreditsPage })), milestone: 'M04b1' }),
  def({ id: 'legal', route: '/legal', titleKey: lk('nav.credits'), kind: 'document', xr: 'exit', inputContext: 'menu', load: () => import('../pages/system.tsx').then((m) => ({ default: m.LegalPage })), milestone: 'M04b1' }),
  def({ id: 'help', route: '/menu/help', titleKey: lk('nav.help'), kind: 'menu', xr: 'exit', inputContext: 'menu', load: soon, milestone: 'M04b2' }),
  def({ id: 'pause', route: null, titleKey: lk('pause.title'), kind: 'overlay', xr: 'screen', inputContext: 'menu', load: () => import('../pages/system.tsx').then((m) => ({ default: m.PausePage })), milestone: 'M04b1' }),
  def({ id: 'loading', route: null, titleKey: lk('loading.title'), kind: 'overlay', xr: 'screen', inputContext: 'menu', load: () => import('../pages/system.tsx').then((m) => ({ default: m.LoadingPage })), milestone: 'M04b1' }),
  def({ id: 'error', route: null, titleKey: lk('error.title'), kind: 'overlay', xr: 'screen', inputContext: 'menu', load: () => import('../pages/system.tsx').then((m) => ({ default: m.ErrorPage })), milestone: 'M04b1' }),
];

const BY_ID = new Map<PageId, PageDef>(PAGES.map((p) => [p.id, p]));

export function pageDef(id: PageId): PageDef | undefined {
  return BY_ID.get(id);
}

/** The URL of a page (History routing rule 1: top-level menu pages and the real documents only). */
export function hrefFor(id: PageId, params: Readonly<Record<string, string>> = {}): string {
  if (id === 'settings') return `/menu/settings/${encodeURIComponent(params['cat'] ?? 'graphics')}`;
  if (id === 'legal') return `/legal/${encodeURIComponent(params['doc'] ?? 'terms')}`;
  return pageDef(id)?.route ?? '/';
}

export interface Frame { id: PageId; params: Record<string, string> }

/** Maps a pathname to the page frame above the root, or null for the root (`/`, unknown paths, and `/account/*` which is a real document). */
export function frameFor(pathname: string): Frame | null {
  const clean = pathname.replace(/\/+$/, '') || '/';
  const legal = /^\/legal\/([^/]+)$/.exec(clean);
  if (legal?.[1]) return { id: 'legal', params: { doc: decodeURIComponent(legal[1]) } };
  const settings = /^\/menu\/settings(?:\/([^/]+))?$/.exec(clean);
  if (settings) return { id: 'settings', params: { cat: settings[1] ? decodeURIComponent(settings[1]) : 'graphics' } };
  for (const p of PAGES) if (p.route === clean && clean.startsWith('/menu/') && p.id !== 'settings') return { id: p.id, params: {} };
  return null;
}

/** Pages a player can open without passing the gates: the public documents. */
export const PUBLIC_PAGES: ReadonlySet<PageId> = new Set<PageId>(['credits', 'legal']);

export const LEGAL_DOCS = ['terms', 'privacy', 'dmca', 'ncii', 'ugc', 'ai-disclosure', 'repeat-infringer', 'contact'] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

export function isLegalDoc(doc: string): doc is LegalDoc {
  return (LEGAL_DOCS as readonly string[]).includes(doc);
}
