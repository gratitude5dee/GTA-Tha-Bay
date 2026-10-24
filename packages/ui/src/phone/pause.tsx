/**
 * Pause and Phone pages (10-ui-hud-xr.md 2.10, M04b2). Pause: Resume, Save (enabled at a safehouse, otherwise disabled with its
 * reason), Load, Phone, Settings, Help, Report a problem and Quit to menu (confirm; the sim writes the `modeExit` save). Phone: the app
 * grid and the open app. In single player both overlays pause the sim (the shell state `Paused` does it).
 */
import { h } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { JsonValue, LastSaveStatus, ProfileId } from '@dv/shared';
import { formatDate, lk, t } from '../i18n/index.ts';
import { ScreenHost } from '../screen/dom-screen.tsx';
import type { ListRow, ScreenDef, UiAction } from '../screen/types.ts';
import { garageCards, cardAction } from '../pages/garage.tsx';
import { buildTiles, tileRows, type ModeTile } from '../pages/modes.ts';
import { useShell } from '../shell/context.tsx';
import type { PageProps, ShellContext } from '../shell/types.ts';
import { appDef, visibleApps } from './registry.ts';
import { messagePress, type PhoneMessage } from './messages.tsx';
import { homeScreen, missionRows, type MissionJob, type PhoneEnv, type RideDestination, type SandboxTeleportView, type SandboxWorldView } from './apps.ts';
import { MapApp } from './map-app.tsx';

export interface PauseEnv {
  /** At a safehouse (view-model key `hud.safehouse`, M05); absent means away. */
  atSafehouse: boolean;
  /** The last save line, already localized, or null. */
  lastSave: string | null;
  /** Another tab owns the profile. */
  otherTab: boolean;
}

export function pauseScreen(env: PauseEnv): ScreenDef {
  const saveOff = env.otherTab ? lk('banner.otherTab.short') : env.atSafehouse ? undefined : lk('pause.save.away');
  return {
    id: 'pause',
    title: lk('pause.title'),
    children: [
      { k: 'heading', text: lk('pause.title'), level: 1 },
      ...(env.lastSave ? [{ k: 'text' as const, text: lk('pause.lastSave'), params: { line: env.lastSave }, tone: 'muted' as const }] : []),
      { k: 'button', id: 'pause-resume', label: lk('pause.resume'), style: 'primary', onPress: { call: 'pause.resume' } },
      { k: 'button', id: 'pause-save', label: lk('pause.save'), style: 'secondary', onPress: { cmd: { t: 'save.request', reason: 'safehouse' } }, ...(saveOff ? { disabled: saveOff } : {}) },
      { k: 'button', id: 'pause-load', label: lk('pause.load'), style: 'secondary', onPress: { call: 'pause.load' }, disabled: lk('pause.load.menu') },
      { k: 'button', id: 'pause-phone', label: lk('pause.phone'), style: 'secondary', onPress: { nav: 'phone' } },
      { k: 'button', id: 'pause-settings', label: lk('nav.settings'), style: 'secondary', onPress: { nav: 'settings', params: { cat: 'graphics' } } },
      { k: 'button', id: 'pause-help', label: lk('nav.help'), style: 'secondary', onPress: { nav: 'help' } },
      { k: 'button', id: 'pause-report', label: lk('pause.report'), style: 'secondary', onPress: { call: 'pause.report' } },
      { k: 'button', id: 'pause-quit', label: lk('pause.quit'), style: 'danger', onPress: { call: 'pause.quit' } },
    ],
  };
}

function lastSaveLine(s: LastSaveStatus | null): string | null {
  if (!s || s.error) return null;
  return t('pause.lastSave.line', { when: formatDate(s.at) });
}

export function PausePage(_props: PageProps) {
  const { shell, ctx } = useShell();
  const [last, setLast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const id = ctx.profile?.id;
    if (!ctx.saves || !id) return;
    let live = true;
    void ctx.saves.lastSave(id as ProfileId).then((s) => live && setLast(lastSaveLine(s)), () => undefined);
    return () => {
      live = false;
    };
  }, [ctx.saves, ctx.profile?.id]);
  useVmRedraw(ctx);
  const atSafehouse = ctx.vm<JsonValue>('hud.safehouse') === true;
  const screen = pauseScreen({ atSafehouse, lastSave: copied ? t('error.copied') : last, otherTab: ctx.otherTab });
  return h('main', { class: 'dv-page dv-pause', 'data-testid': 'pause' }, h(ScreenHost, {
    screen,
    get: () => undefined,
    set: () => undefined,
    run: (action: UiAction) => {
      if ('cmd' in action) {
        ctx.sendUi(action.cmd);
        shell.toast({ id: 'pause.save', text: lk('pause.save.asked') });
      } else if ('nav' in action) shell.navigate(action.nav, action.params);
      else if ('call' in action) {
        if (action.call === 'pause.resume') ctx.fire('resume');
        else if (action.call === 'pause.report') {
          void navigator.clipboard?.writeText(ctx.props.diagnostics()).then(() => setCopied(true), () => setCopied(false));
        } else if (action.call === 'pause.quit') {
          void shell
            .confirm({ titleKey: lk('pause.quit.title'), bodyKey: lk('pause.quit.body'), confirmKey: lk('pause.quit'), danger: true })
            .then((ok) => {
              if (ok) ctx.sendUi({ t: 'mode.quit' });
            });
        }
      }
    },
  }));
}

/** Redraws the page when a `hud.*`, `phone.*` or `mode.*` key changes (the shell itself only listens to `sys.*`). */
export function useVmRedraw(ctx: ShellContext): void {
  const [, redraw] = useState(0);
  useEffect(() => {
    const vm = ctx.engine?.vm;
    if (!vm) return undefined;
    const offs = (['hud.*', 'phone.*', 'mode.*'] as const).map((k) => vm.subscribe(k, () => redraw((n) => n + 1)));
    return () => offs.forEach((off) => off());
  }, [ctx.engine]);
}

/** Everything the app screens read, from the view models and the shell. */
export function usePhoneEnv(ctx: ShellContext): PhoneEnv {
  const modes = ctx.vm<JsonValue>('sys.modes');
  const list = (Array.isArray(modes) ? modes : []) as unknown as ModeTile[];
  const unlocks = new Set(((ctx.vm<JsonValue>('sys.unlocks') as string[] | undefined) ?? []).map(String));
  const views = buildTiles(list, { unlocks, online: ctx.gate.online, headset: ctx.gate.headset, unlockAll: ctx.props.unlockAllFlag, qa: ctx.props.qa }, ctx.props.prefs.get().seenTiles);
  const mode = ctx.mode.stack[0]?.id ?? null;
  const ride = ctx.vm<JsonValue>('phone.ride') as unknown as { ready: boolean; destinations: RideDestination[] } | undefined;
  const wallet = ctx.vm<JsonValue>('hud.wallet') as unknown as { cashCents?: number } | undefined;
  const heat = ctx.vm<JsonValue>('hud.heat') as unknown as { level?: number } | undefined;
  const toggles = ctx.vm<JsonValue>('mode.sandbox.toggles') as unknown as Record<string, boolean | number> | undefined;
  const jobList = ((ctx.vm<JsonValue>('mode.story.jobs') as unknown as MissionJob[] | undefined) ?? []).filter((j) => typeof j?.id === 'string');
  const messages = ((ctx.vm<JsonValue>('mode.story.messages') as unknown as PhoneMessage[] | undefined) ?? []).filter((m) => typeof m?.from === 'string' && typeof m?.text === 'string');
  return {
    mode,
    jobs: tileRows(views),
    missions: missionRows(jobList),
    jobList,
    messages,
    cashCents: wallet?.cashCents,
    garage: garageCards(ctx.vm<JsonValue>('sys.garage')),
    ride,
    // The toggle is published at once; the snapshot's heat waits for the next tick, and the phone pauses the sim.
    heat: typeof toggles?.['sandbox.player.heat'] === 'number' ? (toggles['sandbox.player.heat'] as number) : (heat?.level ?? 0),
    neverWanted: toggles?.['sandbox.player.neverWanted'] === true,
    sandboxWorld: ctx.vm<JsonValue>('mode.sandbox.world') as unknown as SandboxWorldView | undefined,
    sandboxTeleport: ctx.vm<JsonValue>('mode.sandbox.teleport') as unknown as SandboxTeleportView | undefined,
    hideHud: toggles?.['sandbox.display.hideHud'] === true,
    hideMinimap: toggles?.['sandbox.display.hideMinimap'] === true,
    appRows: [],
  };
}

export function PhonePage(props: PageProps) {
  const { shell, ctx } = useShell();
  const [app, setApp] = useState<string | null>(props.params['app'] ?? null);
  const [lastPick, setLastPick] = useState<string | null>(null);
  // The Sandbox app's spot list: false goes to the spot, true forgets it (M04e2).
  const [forgetting, setForgetting] = useState(false);
  const [thread, setThread] = useState<string | null>(null);
  const [focusJob, setFocusJob] = useState<string | null>(null);
  useVmRedraw(ctx);
  const env = { ...usePhoneEnv(ctx), forgetting };
  const apps = useMemo(() => visibleApps({ mode: env.mode }), [env.mode]);
  // The Ride app asks the sim for its destinations each time it opens.
  useEffect(() => {
    if (app === 'ride') ctx.sendUi({ t: 'mode.cmd', mode: 'phone' as never, name: 'ride.list' });
  }, [app]);
  const appRows: ListRow[] = apps.map((a) => ({
    id: a.id,
    text: `${a.icon} ${t(a.titleKey)}`,
    detail: a.comingSoon ? t('phone.soon') : undefined,
    ...(a.comingSoon ? { disabled: true, hint: t('phone.soon') } : {}),
  } as ListRow));
  // The Map app (M02c2) is a canvas the world draws, not a widget tree.
  if (app === 'map') {
    return h(MapApp, {
      port: ctx.props.map?.() ?? null,
      onWaypoint: (x: number, z: number) => void ctx.sendUi({ t: 'phone.waypoint', x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 }),
      ...(env.mode === 'sandbox'
        ? { onTravel: (x: number, z: number) => void ctx.sendUi({ t: 'mode.cmd', mode: 'phone' as never, name: 'map.travel', args: { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 } }) }
        : {}),
      onBack: () => setApp(null),
    });
  }
  const def = app ? appDef(app) : undefined;
  const screen = def ? def.screen({ ...env, appRows, thread, focusJob }) : homeScreen({ appRows });
  return h('main', { class: 'dv-page dv-phone', 'data-testid': 'phone', 'data-app': app ?? 'home' }, h(ScreenHost, {
    screen,
    get: () => undefined,
    set: () => undefined,
    run: (action: UiAction, rowId?: string) => {
      if ('back' in action) {
        if (app) setApp(null);
        else shell.back();
      } else if ('nav' in action) shell.navigate(action.nav, action.params);
      else if ('cmd' in action) ctx.sendUi(action.cmd);
      else if ('call' in action) {
        switch (action.call) {
          case 'phone.home':
            setApp(null);
            setThread(null);
            setFocusJob(null);
            break;
          case 'phone.message.open':
          case 'phone.message.offer': {
            const press = rowId ? messagePress(rowId) : null;
            if (press?.kind === 'thread') setThread(press.from);
            else if (press?.kind === 'offer') {
              setFocusJob(press.missionId);
              setApp('jobs');
            }
            break;
          }
          case 'phone.message.back':
            setThread(null);
            break;
          case 'phone.open': {
            const d = rowId ? appDef(rowId) : undefined;
            if (!d || d.comingSoon) return;
            // Settings and Help are pages; the rest open in the phone.
            if (d.id === 'settings') shell.navigate('settings', { cat: 'graphics' });
            else if (d.id === 'help') shell.navigate('help');
            else setApp(d.id);
            break;
          }
          case 'phone.job':
            if (rowId?.startsWith('mis:')) {
              // a story mission: the sim starts it (or toasts why not); the phone closes so the player can play
              ctx.sendUi({ t: 'mode.cmd', mode: 'story', name: 'mission.start', args: { id: rowId.slice(4) } });
              shell.back();
            } else if (rowId) ctx.startMode(rowId as never);
            break;
          case 'sandbox.landmark':
            if (rowId) {
              ctx.sendUi({ t: 'mode.cmd', mode: 'sandbox', name: 'teleport.landmark', args: { id: rowId } });
              ctx.fire('resume');
            }
            break;
          case 'sandbox.waypoint':
            ctx.sendUi({ t: 'mode.cmd', mode: 'sandbox', name: 'teleport.waypoint' });
            ctx.fire('resume');
            break;
          case 'sandbox.back':
            ctx.sendUi({ t: 'mode.cmd', mode: 'sandbox', name: 'teleport.back' });
            ctx.fire('resume');
            break;
          case 'sandbox.forget':
            setForgetting((f) => !f);
            break;
          case 'sandbox.spot':
            if (rowId && forgetting) ctx.sendUi({ t: 'mode.cmd', mode: 'sandbox', name: 'position.delete', args: { name: rowId } });
            else if (rowId) {
              ctx.sendUi({ t: 'sandbox.teleport', name: rowId });
              ctx.fire('resume');
            }
            break;
          case 'garage.card': {
            const cmd = rowId ? cardAction(rowId) : null;
            if (cmd) ctx.sendUi(cmd);
            break;
          }
          case 'phone.ride.go':
            if (rowId) {
              setLastPick(rowId);
              ctx.sendUi({ t: 'mode.cmd', mode: 'phone' as never, name: 'ride.go', args: { to: rowId } });
            }
            break;
          case 'phone.ride.taxi': {
            const d = env.ride?.destinations.find((x) => x.id === lastPick) ?? env.ride?.destinations[0];
            ctx.sendUi({ t: 'mode.cmd', mode: 'phone' as never, name: 'ride.taxi', args: d ? { to: { x: d.x, z: d.z } } : {} });
            break;
          }
        }
      }
    },
  }));
}

export default PausePage;
