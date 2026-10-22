/**
 * The story and sandbox HUD (10-ui-hud-xr.md 2.10, table row "Story / free roam"). Bound to the `hud.*` view-model keys; a missing key
 * renders the widget's empty state. The minimap slot (M02c2) hosts the canvas the world's map layer draws into. Mission content binds in M05c1.
 */
import type { JsonValue } from '@dv/shared';
import { useShell } from '../shell/context.tsx';
import { HudGrid, useHudPrefs } from './layout.tsx';
import { MinimapSlot } from './minimap-slot.tsx';
import { TipBar } from './tipbar.tsx';
import { TalkPanel } from './TalkChoices.tsx';
import { ShopPanel } from './ShopPanel.tsx';
import { MissionFail } from './mission-fail.tsx';
import { contentText } from '../i18n/index.ts';
import type { HudClock, HudHeat, HudVehicle, HudWallet } from './model.ts';
import {
  AreaBanner, ClockWeather, HealthBar, HeatStars, InteractionPrompt, ObjectiveTracker, SandboxChip, SaveIndicator, Subtitles, VehicleCluster,
  Wallet, useVm, type ObjectiveView,
} from './widgets.tsx';

export function StoryHud() {
  const { ctx } = useShell();
  const prefs = useHudPrefs();
  const clock = useVm<JsonValue>('hud.clock') as HudClock | undefined;
  const wallet = useVm<JsonValue>('hud.wallet') as HudWallet | undefined;
  const heat = useVm<JsonValue>('hud.heat') as HudHeat | undefined;
  const veh = useVm<JsonValue>('hud.veh') as HudVehicle | undefined;
  const area = useVm<JsonValue>('hud.area') as { name?: string; key?: string } | undefined;
  const health = useVm<JsonValue>('hud.health') as { hp: number; max: number } | undefined;
  const hudObjective = useVm<JsonValue>('hud.objective') as ObjectiveView | undefined;
  const mission = useVm<JsonValue>('hud.mission') as { titleKey: string; objectiveKey: string; timerSec?: number; failKey?: string; retry?: string } | null | undefined;
  // a running mission (M05c1): its title, the objective in play and the stage clock; a failed one shows its reason in the fail panel instead
  const objective: ObjectiveView | undefined =
    mission && !mission.failKey
      ? { title: contentText(mission.titleKey), text: contentText(mission.objectiveKey), ...(mission.timerSec !== undefined ? { timerSec: mission.timerSec } : {}) }
      : hudObjective;
  const subtitle = useVm<JsonValue>('hud.subtitle') as { speaker?: string; text: string } | undefined;
  const save = useVm<JsonValue>('hud.save') as 'saving' | 'saved' | 'failed' | undefined;
  const mode = ctx.mode.stack[0]?.id;
  return (
    <HudGrid
      {...prefs}
      regions={{
        tl: (
          <>
            <ObjectiveTracker objective={objective} />
            <AreaBanner area={area} />
            {mode === 'sandbox' ? <SandboxChip /> : null}
          </>
        ),
        tr: (
          <>
            <ClockWeather clock={clock} />
            <Wallet wallet={wallet} />
            <SaveIndicator state={save} />
            <HeatStars heat={heat} />
          </>
        ),
        bl: <MinimapSlot />,
        br: (
          <>
            <HealthBar health={health} />
            <VehicleCluster veh={veh} units={ctx.props.prefs.get().units} />
          </>
        ),
        bc: (
          <>
            <TipBar />
            <InteractionPrompt />
            <Subtitles line={subtitle} />
          </>
        ),
        c: (
          <>
            <TalkPanel />
            <ShopPanel />
            <MissionFail fail={mission?.failKey ? { reason: mission.failKey, retry: mission.retry ?? 'checkpoint' } : undefined} />
          </>
        ),
      }}
    />
  );
}
