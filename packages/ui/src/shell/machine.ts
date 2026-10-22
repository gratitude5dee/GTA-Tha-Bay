import type { ShellState, UiPrefs } from './types.ts';

/**
 * The shell state machine (10-ui.md section 2.4). A pure transition function: the shell host feeds it events and renders the state.
 * `Blocked` is terminal for the device profile; `Recovering` returns to `Loading`.
 */
export type ShellEvent =
  | { t: 'ready' }
  | { t: 'unsupported' }
  | { t: 'gesture' }
  | { t: 'agePass' }
  | { t: 'ageFail' }
  | { t: 'termsAccept' }
  | { t: 'termsDecline' }
  | { t: 'startMode' }
  | { t: 'modeRunning' }
  | { t: 'modeIdle' }
  | { t: 'modeFailed' }
  | { t: 'pause' }
  | { t: 'resume' }
  | { t: 'quit' }
  | { t: 'crash' }
  | { t: 'recovered' }
  | { t: 'qaPlay' };

/** Where the Title's first gesture leads (rules 1 to 4 and 7 of 10-ui-pages.md section 2.4). */
export function afterTitle(prefs: Pick<UiPrefs, 'age' | 'terms'>, termsVersion: string): ShellState {
  if (prefs.age.blocked) return 'Blocked';
  if (prefs.age.attested !== '18p') return 'AgeGate';
  if (!prefs.terms || prefs.terms.version !== termsVersion) return 'Terms';
  return 'Menu';
}

export interface MachineCtx {
  prefs: Pick<UiPrefs, 'age' | 'terms'>;
  termsVersion: string;
}

export function transition(state: ShellState, e: ShellEvent, ctx: MachineCtx): ShellState {
  // Events that apply from anywhere.
  if (e.t === 'unsupported') return 'Unsupported';
  if (e.t === 'qaPlay') return 'Loading';
  if (e.t === 'crash' && (state === 'InMode' || state === 'Paused' || state === 'Loading')) return 'Recovering';
  switch (state) {
    case 'Booting':
      return e.t === 'ready' ? (ctx.prefs.age.blocked ? 'Blocked' : 'Title') : state;
    case 'Title':
      return e.t === 'gesture' ? afterTitle(ctx.prefs, ctx.termsVersion) : state;
    case 'AgeGate':
      if (e.t === 'agePass') return 'Terms';
      if (e.t === 'ageFail') return 'Blocked';
      return state;
    case 'Terms':
      if (e.t === 'termsAccept') return 'Menu';
      if (e.t === 'termsDecline') return 'Title';
      return state;
    case 'Menu':
      return e.t === 'startMode' ? 'Loading' : state;
    case 'Loading':
      if (e.t === 'modeRunning') return 'InMode';
      if (e.t === 'modeFailed' || e.t === 'modeIdle' || e.t === 'quit') return 'Menu';
      return state;
    case 'InMode':
      if (e.t === 'pause') return 'Paused';
      if (e.t === 'quit' || e.t === 'modeIdle') return 'Menu';
      return state;
    case 'Paused':
      if (e.t === 'resume') return 'InMode';
      if (e.t === 'quit' || e.t === 'modeIdle') return 'Menu';
      return state;
    case 'Recovering':
      return e.t === 'recovered' ? 'Loading' : state;
    case 'Blocked':
    case 'Unsupported':
    case 'Error':
      return state;
  }
}
