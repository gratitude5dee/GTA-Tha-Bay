/**
 * The tip line above the interaction prompt (10-ui-hud-xr.md 2.11 rule 1). Drives a `TipEngine` from the play start, the prompt kinds and
 * the player's actions. Off when `UiPrefs.showTips` is false.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { JsonValue } from '@dv/shared';
import { t } from '../i18n/index.ts';
import { HINTS, TipEngine, hintKey } from '../onboarding/tips.ts';
import { useShell } from '../shell/context.tsx';
import type { HudPrompt } from './model.ts';
import { useVm } from './widgets.tsx';

export function TipBar() {
  const { ctx } = useShell();
  const prefs = ctx.props.prefs;
  const [, redraw] = useState(0);
  const device = (useVm<JsonValue>('hud.device') as string | undefined) ?? 'kbm';
  const prompt = useVm<JsonValue>('hud.prompt') as HudPrompt | undefined;
  const engine = useMemo(
    () =>
      new TipEngine(
        HINTS,
        {
          dismissed: () => prefs.get().dismissed,
          save: (next) => {
            try {
              prefs.set({ dismissed: next });
            } catch {
              // a store that throws keeps the tips for this session only
            }
          },
        },
        { enabled: () => prefs.get().showTips && ctx.platform?.deviceClass !== 'xr', device: () => device },
      ),
    [prefs],
  );
  useEffect(() => {
    engine.trigger('play');
    const off = ctx.engine?.onAction?.((id) => {
      if (engine.action(id, performance.now())) redraw((n) => n + 1);
    });
    const tick = setInterval(() => redraw((n) => n + 1), 500);
    return () => {
      off?.();
      clearInterval(tick);
    };
  }, [engine, ctx.engine]);
  useEffect(() => {
    engine.release('prompt.enter', performance.now());
    engine.release('prompt.interact', performance.now());
    if (prompt && !prompt.reason) engine.trigger(prompt.kind === 1 ? 'prompt.enter' : 'prompt.interact');
    redraw((n) => n + 1);
  }, [engine, prompt?.kind, Boolean(prompt)]);
  const hint = engine.current(performance.now());
  if (!hint) return null;
  return (
    <div class="dv-tip" role="status" data-testid="hud-tip" data-hint={hint.id}>
      <span class="dv-chip-icon" aria-hidden="true">{'ℹ'}</span>
      <span>{t(hintKey(hint, device))}</span>
    </div>
  );
}
