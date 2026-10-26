import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TERMS_VERSION } from '../../../config/terms.ts';
import { runCheckI18n } from '../../../tools/ci/check-i18n.ts';
import { parseQaFlags, NO_QA_FLAGS } from '../../engine/src/platform/qa-flags.ts';
import { ageOn, acceptTerms, bracketOf, defaultConsent, fieldOrder, parseDob } from '../src/pages/gate.tsx';
import { NAV_ITEMS, navViews, reachablePages } from '../src/pages/main.tsx';
import { apiErrorToUi } from '../src/pages/system.tsx';
import { catalogs, chain, plural, setLang, t } from '../src/i18n/index.ts';
import { BLOCK_MIRROR, defaultPrefs, loadPrefs, memoryPrefs } from '../src/shell/prefs.ts';
import { ShellCore } from '../src/shell/core.ts';
import { defaultGateCtx, evaluateGate } from '../src/shell/gates.ts';
import { afterTitle, transition } from '../src/shell/machine.ts';
import { InstanceGuard, type ChannelLike } from '../src/shell/banners.tsx';
import { PAGES, frameFor, hrefFor, pageDef } from '../src/shell/registry.ts';
import type { EnginePort, GateCtx, PlatformPort, ShellHooks, ShellProps } from '../src/shell/types.ts';
import { ToastStore } from '../src/kit/widgets.tsx';
import { pickNext } from '../src/kit/focus.ts';

const repo = path.resolve(import.meta.dirname, '../../..');
const gate = (over: Partial<GateCtx> = {}): GateCtx => ({ ...defaultGateCtx(), attested: true, ...over });

// ---- AC-1: gates and reachability

describe('page gates (AC-1)', () => {
  it('a false flag hides, offline disables with the Offline reason, a blocked region hides online pages, a low tier gets a call to action', () => {
    expect(evaluateGate({ flag: 'npc.builder' }, gate({ flags: { 'npc.builder': false } }))).toEqual({ state: 'hidden' });
    expect(evaluateGate({ flag: 'npc.builder' }, gate({ flags: { 'npc.builder': true } }))).toEqual({ state: 'open' });
    expect(evaluateGate({ online: true }, gate({ online: false }))).toEqual({ state: 'disabled', reason: 'gate.offline' });
    expect(evaluateGate({ online: true, regionSensitive: true }, gate({ region: 'blocked' }))).toEqual({ state: 'hidden' });
    const low = evaluateGate({ tier: 'device' }, gate({ identity: { tier: 'local' } }));
    expect(low).toMatchObject({ state: 'disabled', cta: { to: { href: '/account/' } } });
    expect(evaluateGate({ tier: 'device' }, gate({ identity: { tier: 'device' } }))).toEqual({ state: 'open' });
    expect(evaluateGate({ attested: true }, gate({ attested: false }))).toEqual({ state: 'hidden' });
  });

  it('every registered page of this milestone is reachable from the main menu', () => {
    const open = gate({ flags: { 'npc.builder': true, 'forum.enabled': true, 'mp.enabled': true, 'mods.enabled': true }, identity: { tier: 'device' } });
    const reach = reachablePages(open);
    const gatePages = new Set(['boot', 'unsupported', 'title', 'age', 'blocked', 'terms', 'main', 'pause', 'phone', 'loading', 'error']);
    for (const p of PAGES) if (!gatePages.has(p.id)) expect(reach.has(p.id), `${p.id} is reachable from the main menu`).toBe(true);
    // Every nav item targets a registered page.
    for (const item of NAV_ITEMS) expect(pageDef(item.page), item.id).toBeDefined();
  });

  it('hides nav items whose gate says hidden', () => {
    const views = navViews(gate({ flags: { 'forum.enabled': false } }));
    expect(views.find((v) => v.item.id === 'community')).toBeUndefined();
    expect(views.find((v) => v.item.id === 'settings')).toBeDefined();
  });

  it('maps urls to frames and back', () => {
    expect(hrefFor('settings', { cat: 'audio' })).toBe('/menu/settings/audio');
    expect(frameFor('/menu/settings/audio')).toEqual({ id: 'settings', params: { cat: 'audio' } });
    expect(frameFor('/legal/privacy')).toEqual({ id: 'legal', params: { doc: 'privacy' } });
    expect(frameFor('/account/')).toBeNull();
  });
});

// ---- age rules (AC-2, unit side)

describe('age gate', () => {
  const today = new Date(2026, 9, 21);
  it('orders the fields by locale', () => {
    expect(fieldOrder('en-US')).toEqual(['month', 'day', 'year']);
    expect(fieldOrder('en-GB')).toEqual(['day', 'month', 'year']);
    expect(fieldOrder('ja-JP')).toEqual(['year', 'month', 'day']);
    expect(fieldOrder('not a locale')).toEqual(['month', 'day', 'year']);
  });
  it('rejects impossible, future and pre-1900 dates', () => {
    expect(parseDob('2', '30', '2000', today)).toBeNull();
    expect(parseDob('13', '1', '2000', today)).toBeNull();
    expect(parseDob('10', '22', '2026', today)).toBeNull();
    expect(parseDob('1', '1', '1899', today)).toBeNull();
    expect(parseDob('', '1', '2000', today)).toBeNull();
    expect(parseDob('1', '1', '20', today)).toBeNull();
    expect(parseDob('2', '29', '2000', today)).toEqual({ y: 2000, m: 2, d: 29 });
  });
  it('18 years ago today passes; a day short is blocked; 17 years is blocked', () => {
    const eighteen = parseDob('10', '21', '2008', today);
    expect(eighteen && bracketOf(ageOn(eighteen, today))).toBe('18p');
    const dayShort = parseDob('10', '22', '2008', today);
    expect(dayShort && bracketOf(ageOn(dayShort, today))).toBe('u18');
    const seventeen = parseDob('10', '21', '2009', today);
    expect(seventeen && bracketOf(ageOn(seventeen, today))).toBe('u18');
  });
  it('the gate page states no threshold', () => {
    for (const key of ['age.title', 'age.month', 'age.day', 'age.year', 'age.invalid']) expect(t(key)).not.toMatch(/\b1[0-9]\b|eighteen|adult|years/i);
  });
});

// ---- state machine

describe('shell machine', () => {
  const ctx = (age: 'attested' | 'fresh' | 'blocked', terms = TERMS_VERSION) => ({
    prefs: {
      age: { attested: age === 'attested' ? ('18p' as const) : null, attestedAt: null, blocked: age === 'blocked' },
      terms: age === 'attested' ? { version: terms, acceptedAt: 1 } : null,
    },
    termsVersion: TERMS_VERSION,
  });
  it('walks Booting, Title, AgeGate, Terms, Menu, Loading, InMode and back', () => {
    let s = transition('Booting', { t: 'ready' }, ctx('fresh'));
    expect(s).toBe('Title');
    s = transition(s, { t: 'gesture' }, ctx('fresh'));
    expect(s).toBe('AgeGate');
    expect(transition(s, { t: 'ageFail' }, ctx('fresh'))).toBe('Blocked');
    s = transition(s, { t: 'agePass' }, ctx('fresh'));
    expect(s).toBe('Terms');
    expect(transition(s, { t: 'termsDecline' }, ctx('fresh'))).toBe('Title');
    s = transition(s, { t: 'termsAccept' }, ctx('fresh'));
    expect(s).toBe('Menu');
    s = transition(s, { t: 'startMode' }, ctx('attested'));
    expect(s).toBe('Loading');
    s = transition(s, { t: 'modeRunning' }, ctx('attested'));
    expect(s).toBe('InMode');
    expect(transition(s, { t: 'pause' }, ctx('attested'))).toBe('Paused');
    expect(transition(s, { t: 'quit' }, ctx('attested'))).toBe('Menu');
    expect(transition(s, { t: 'crash' }, ctx('attested'))).toBe('Recovering');
  });
  it('a returning player skips the age screen, and a new terms version shows only the Terms card', () => {
    expect(afterTitle(ctx('attested').prefs, TERMS_VERSION)).toBe('Menu');
    expect(afterTitle(ctx('attested', 'older').prefs, TERMS_VERSION)).toBe('Terms');
    expect(afterTitle(ctx('fresh').prefs, TERMS_VERSION)).toBe('AgeGate');
  });
  it('Blocked is terminal', () => {
    for (const e of ['gesture', 'agePass', 'termsAccept', 'startMode', 'modeRunning', 'resume'] as const) expect(transition('Blocked', { t: e }, ctx('blocked'))).toBe('Blocked');
    expect(afterTitle(ctx('blocked').prefs, TERMS_VERSION)).toBe('Blocked');
  });
});

// ---- prefs and the block (AC-2, AC-3)

describe('UiPrefs', () => {
  it('a block survives a reload through the mirror alone and nothing lifts it', async () => {
    const mirror = new Map<string, string>();
    const storage = { getItem: (k: string) => mirror.get(k) ?? null, setItem: (k: string, v: string) => void mirror.set(k, v), removeItem: (k: string) => void mirror.delete(k) };
    const a = await loadPrefs({ idb: null, storage });
    a.set({ age: { attested: null, attestedAt: null, blocked: true } });
    await a.flush();
    expect(mirror.get(BLOCK_MIRROR)).toBe('1');
    const b = await loadPrefs({ idb: null, storage });
    expect(b.get().age.blocked).toBe(true);
    b.set({ age: { attested: '18p', attestedAt: 1, blocked: false } });
    expect(b.get().age.blocked).toBe(true);
  });
  it('works with no storage at all', async () => {
    const p = await loadPrefs({ idb: null, storage: null });
    p.set({ uiScale: 1.2 });
    expect(p.get().uiScale).toBe(1.2);
    expect(p.get().age.attested).toBeNull();
  });
});

describe('Terms card (AC-3)', () => {
  const fakePlatform = () => {
    const calls: unknown[] = [];
    const platform = {
      settings: () => ({ telemetryConsent: defaultConsent() }),
      update: (p: unknown) => {
        calls.push(['update', p]);
        return Promise.resolve();
      },
      applyConsent: (c: unknown) => calls.push(['applyConsent', c]),
    } as unknown as PlatformPort;
    return { platform, calls };
  };
  it('both toggles default on', () => {
    expect(defaultConsent()).toEqual({ diagnostics: true, analytics: true });
  });
  it('accepting writes the consent to the platform settings and the version to the prefs', () => {
    const { platform, calls } = fakePlatform();
    const prefs = memoryPrefs(defaultPrefs());
    acceptTerms({ platform, prefs, consent: { diagnostics: true, analytics: false }, now: () => 42 });
    expect(calls).toContainEqual(['update', { telemetryConsent: { diagnostics: true, analytics: false } }]);
    expect(calls).toContainEqual(['applyConsent', { diagnostics: true, analytics: false }]);
    expect(prefs.get().terms).toEqual({ version: TERMS_VERSION, acceptedAt: 42 });
  });
  it('before the platform exists the consent is handed to the app', () => {
    const onConsent = vi.fn();
    acceptTerms({ platform: null, prefs: memoryPrefs(defaultPrefs()), consent: defaultConsent(), onConsent });
    expect(onConsent).toHaveBeenCalledWith({ diagnostics: true, analytics: true });
  });
});

// ---- QA play bypass (AC-15, unit side)

describe('QA play bypass', () => {
  const stored = (v: 'sandbox' | 'story' | 'off' | null) => () => v;
  it('?play= wins, then the stored key, then ?scenario= implies sandbox', () => {
    expect(parseQaFlags('?play=story', true, stored('sandbox')).play).toBe('story');
    expect(parseQaFlags('', true, stored('sandbox')).play).toBe('sandbox');
    expect(parseQaFlags('?scenario=graybox-walk', true, stored(null)).play).toBe('sandbox');
    expect(parseQaFlags('?play=off&scenario=graybox-walk', true, stored('sandbox')).play).toBe('off');
    expect(parseQaFlags('', true, stored(null)).play).toBeNull();
    expect(parseQaFlags('?play=bogus', true, stored(null)).play).toBeNull();
  });
  it('a build without VITE_DV_QA ignores both the flag and the key', () => {
    expect(parseQaFlags('?play=sandbox&scenario=x', false, stored('story'))).toBe(NO_QA_FLAGS);
    expect(NO_QA_FLAGS.play).toBeNull();
  });

  const fakeEngine = (): { port: EnginePort; sent: unknown[]; setModes(): void; unlocked: () => number } => {
    const values = new Map<string, unknown>([['sys.mode', { state: 'Idle', stack: [] }]]);
    const subs: Array<(v: unknown, k: string) => void> = [];
    const sent: unknown[] = [];
    let unlocked = 0;
    const port: EnginePort = {
      vm: {
        get: ((k: string) => values.get(k)) as never,
        subscribe: ((_k: string, cb: (v: unknown, k: string) => void) => {
          subs.push(cb);
          return () => undefined;
        }) as never,
        rev: 0,
      },
      sendUi: (c) => {
        sent.push(c);
        return true;
      },
      activeDevice: () => 'kbm',
      audioUnlock: () => undefined,
      firstGesture: () => void unlocked++,
    };
    return {
      port,
      sent,
      unlocked: () => unlocked,
      setModes: () => {
        values.set('sys.modes', []);
        for (const cb of subs) cb([], 'sys.modes');
      },
    };
  };
  const hooks = (): ShellHooks & { log: string[] } => {
    const log: string[] = [];
    return { log, play: (on) => void log.push(`play:${on}`), setPaused: (p) => void log.push(`paused:${p}`), view: (on) => void log.push(`view:${on}`), reload: () => void log.push('reload') };
  };
  const props = (over: Partial<ShellProps>): ShellProps => ({
    diagnostics: () => 'diag', unsupported: false, update: null, initialPath: '/', prefs: memoryPrefs(defaultPrefs()), qa: true, qaPlay: null,
    unlockAllFlag: false, hooks: hooks(), build: 'test', ...over,
  });

  it('reaches InMode with no gate page, sends mode.start once the sim published its modes, and persists nothing', () => {
    const h = hooks();
    const prefs = memoryPrefs(defaultPrefs());
    const set = vi.spyOn(prefs, 'set');
    const core = new ShellCore(props({ qaPlay: { mode: 'sandbox' }, prefs, hooks: h }));
    expect(core.state).toBe('InMode');
    expect(core.currentPage()).not.toBe('title');
    expect(h.log).toContain('play:true');
    const e = fakeEngine();
    core.attachEngine(e.port);
    expect(e.sent).toEqual([]);
    e.setModes();
    expect(e.sent).toEqual([{ t: 'mode.start', id: 'sandbox' }]);
    e.setModes();
    expect(e.sent).toHaveLength(1);
    expect(set).not.toHaveBeenCalled();
  });
  it('a world that cannot be loaded shows the world-load error page on a mode start instead of entering it (BD-FU-A02)', () => {
    const core = new ShellCore(props({}));
    core.ready();
    core.state = 'Menu';
    const e = fakeEngine();
    core.attachEngine(e.port);
    core.worldUnavailable('catalog-404');
    expect(core.frame).toBeNull();
    core.startMode('story');
    expect(e.sent).toEqual([]);
    expect(core.state).toBe('Menu');
    expect(core.frame).toEqual({ id: 'error', params: { kind: 'world-load', detail: 'catalog-404' } });
    expect(core.currentPage()).toBe('error');
    // Back returns to the menu; the next start shows the error again.
    vi.stubGlobal('history', { state: null, replaceState: () => undefined, back: () => undefined });
    core.back();
    vi.unstubAllGlobals();
    expect(core.frame).toBeNull();
    core.startMode('sandbox');
    expect(core.frame?.id).toBe('error');
    expect(e.sent).toEqual([]);
  });
  it('a world failure found while a mode runs shows the error at once; without one the mode starts', () => {
    const running = new ShellCore(props({ qaPlay: { mode: 'sandbox' } }));
    running.worldUnavailable('index-http');
    expect(running.frame).toEqual({ id: 'error', params: { kind: 'world-load', detail: 'index-http' } });
    const fine = new ShellCore(props({}));
    fine.ready();
    fine.state = 'Menu';
    const e = fakeEngine();
    fine.attachEngine(e.port);
    fine.startMode('story');
    expect(e.sent).toEqual([{ t: 'mode.start', id: 'story' }]);
    expect(fine.frame).toBeNull();
  });
  it('a resume from Pause closes a page left open over it, so the next Escape reaches the engine alone (M04e2, BD-M04e2-07)', () => {
    const h = hooks();
    const core = new ShellCore(props({ qaPlay: { mode: 'sandbox' }, hooks: h }));
    expect(core.state).toBe('InMode');
    core.fire('pause');
    expect(core.state).toBe('Paused');
    vi.stubGlobal('history', { state: null, pushState: () => undefined, replaceState: vi.fn(), back: vi.fn() });
    core.navigate('phone');
    expect(core.frame?.id).toBe('phone');
    const before = h.log.length;
    core.fire('resume');
    const hist = (globalThis as unknown as { history: { replaceState: ReturnType<typeof vi.fn>; back: ReturnType<typeof vi.fn> } }).history;
    vi.unstubAllGlobals();
    expect(core.state).toBe('InMode');
    expect(core.frame).toBeNull();
    expect(h.log.slice(before)).toContain('paused:false');
    expect(hist.replaceState).toHaveBeenCalledWith(null, '', '/');
    expect(hist.back).not.toHaveBeenCalled();
  });
  it('the world-load kind has its text and a retry label', () => {
    expect(t('error.kind.world-load')).not.toBe('error.kind.world-load');
    expect(t('error.retry')).not.toBe('error.retry');
  });
  it('without the bypass the shell starts on Title', () => {
    const core = new ShellCore(props({}));
    core.ready();
    expect(core.state).toBe('Title');
    const blocked = defaultPrefs();
    blocked.age.blocked = true;
    expect(new ShellCore(props({ prefs: memoryPrefs(blocked) })).state).toBe('Blocked');
  });
});

// ---- other tab (AC-10, unit side), toasts, focus, errors

describe('other tab guard', () => {
  const pair = (): [ChannelLike, ChannelLike] => {
    const a: ChannelLike = { postMessage: () => undefined, onmessage: null, close: () => undefined };
    const b: ChannelLike = { postMessage: () => undefined, onmessage: null, close: () => undefined };
    a.postMessage = (m) => b.onmessage?.({ data: m });
    b.postMessage = (m) => a.onmessage?.({ data: m });
    return [a, b];
  };
  it('the second tab is the other tab', () => {
    const [ca, cb] = pair();
    const timers: Array<() => void> = [];
    const after = (fn: () => void): unknown => timers.push(fn);
    const flush = (): void => {
      while (timers.length > 0) timers.shift()?.();
    };
    const first = new InstanceGuard(ca, 'a', after);
    first.start();
    flush();
    const second = new InstanceGuard(cb, 'b', after);
    second.start();
    expect(second.otherTab).toBe(false); // heard one owner: it asks again before it decides
    flush();
    expect(first.otherTab).toBe(false);
    expect(second.otherTab).toBe(true);
  });
  it('a page that stops answering (a reload in progress) does not make the new page the other tab', () => {
    const [ca, cb] = pair();
    const timers: Array<() => void> = [];
    const after = (fn: () => void): unknown => timers.push(fn);
    const old = new InstanceGuard(ca, 'a', after);
    old.start();
    while (timers.length > 0) timers.shift()?.();
    const fresh = new InstanceGuard(cb, 'b', after);
    fresh.start();
    old.stop();
    while (timers.length > 0) timers.shift()?.();
    expect(fresh.otherTab).toBe(false);
  });
  it('a lone tab owns the profile', () => {
    const guard = new InstanceGuard(null, 'solo');
    guard.start();
    expect(guard.otherTab).toBe(false);
  });
});

describe('toasts', () => {
  const spec = (id: string, kind: 'info' | 'unlock' | 'error', ttlMs = 5000) => ({ id, kind, text: 'x', ttlMs, icon: '!' });
  it('keeps three, replaces the oldest info, and caps unlock and error at 8 s', () => {
    let now = 0;
    const s = new ToastStore(() => now);
    s.push(spec('a', 'info'));
    s.push(spec('b', 'unlock', 60_000));
    s.push(spec('c', 'info'));
    s.push(spec('d', 'info'));
    expect(s.list.map((x) => x.id)).toEqual(['b', 'c', 'd']);
    expect(s.list[0]?.ttlMs).toBe(8000);
    now = 9000;
    s.expire();
    expect(s.list).toHaveLength(0);
  });
});

describe('focus navigation', () => {
  const r = (x: number, y: number, w = 100, h = 40) => ({ x, y, w, h });
  it('moves to the nearest control in the pressed direction', () => {
    const items = [
      { id: 0, rect: r(0, 0) }, { id: 1, rect: r(0, 60) }, { id: 2, rect: r(0, 120) }, { id: 3, rect: r(200, 0) },
    ];
    expect(pickNext(items[0]!.rect, items.slice(1), 'down')).toBe(1);
    expect(pickNext(items[1]!.rect, [items[0]!, items[2]!, items[3]!], 'down')).toBe(2);
    expect(pickNext(items[1]!.rect, [items[0]!, items[2]!, items[3]!], 'up')).toBe(0);
    expect(pickNext(items[0]!.rect, items.slice(1), 'right')).toBe(3);
    expect(pickNext(items[2]!.rect, [items[0]!, items[1]!, items[3]!], 'down')).toBeNull();
  });
  it('prefers an aligned neighbour over a nearer diagonal one', () => {
    const from = r(0, 0, 100, 40);
    const aligned = { id: 1, rect: r(0, 200) };
    const diagonal = { id: 2, rect: r(400, 50) };
    expect(pickNext(from, [diagonal, aligned], 'down')).toBe(1);
  });
});

describe('apiErrorToUi', () => {
  it('maps the table of 10-ui-pages.md section 5.3', () => {
    expect(apiErrorToUi('tier_required').kind).toBe('cta');
    expect(apiErrorToUi('age_blocked').kind).toBe('ageExplanation');
    expect(apiErrorToUi('region_blocked').kind).toBe('hideOnline');
    expect(apiErrorToUi('build_mismatch').kind).toBe('update');
    expect(apiErrorToUi('rate_limited', 4000)).toMatchObject({ kind: 'wait', retryAfterMs: 4000 });
    expect(apiErrorToUi('moderation_blocked').kind).toBe('policy');
    expect(apiErrorToUi('internal').kind).toBe('retry');
    for (const c of ['quota_exhausted', 'budget_offline', 'kill_switched', 'upstream_unavailable', 'network']) expect(apiErrorToUi(c).kind).toBe('offline');
  });
});

// ---- ui-i18n cases (10-ui.md section 9 item 3)

describe('ui-i18n', () => {
  it('every t() key in the code exists in en, no catalog holds the display name, and check:i18n finds nothing missing', () => {
    const report = runCheckI18n(repo);
    expect(report.missing).toEqual([]);
    expect(report.literals).toEqual([]);
    expect(report.keys).toBeGreaterThan(300);
  });
  it('falls back from lang to base to en', () => {
    expect(chain('de-AT')).toEqual(['de-AT', 'de', 'en']);
    setLang('de-AT');
    expect(t('common.back')).toBe(catalogs['en']!['common.back']);
    setLang('en');
  });
  it('the english catalog is plain JSON with the {brand} placeholder', () => {
    const raw = JSON.parse(readFileSync(path.join(repo, 'content/ui/i18n/en.json'), 'utf8')) as Record<string, string>;
    expect(raw['title.name']).toBe('{brand}');
  });
  it('plural picks the form by the rule', () => {
    expect(plural('time.minutes', 1)).toBe('1 minute');
    expect(plural('time.minutes', 5)).toBe('5 minutes');
  });
});
