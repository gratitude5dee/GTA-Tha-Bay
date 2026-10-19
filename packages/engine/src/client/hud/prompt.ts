/**
 * The interaction prompt and the speed readout (M03a1): a minimal DOM overlay until the S10 HUD kit lands. M04b2 deletes this
 * file and its mount when its `InteractionPrompt` component lands (DL-663 part 2).
 *
 * The prompt shows the key for the active device, the action text and, for a hold prompt, a progress bar; an unavailable reason
 * replaces the action. The readout shows the speed in km/h and the gear while the player drives. Both are plain elements with
 * `data-testid`, `role="status"` and `aria-live="polite"`.
 */
import type { DeviceKind } from '@dv/shared';
import type { PromptSide, VehicleSide } from '../snapshot/reader.ts';

/** English defaults until the i18n catalog carries the interaction keys (M04b1). */
const TEXT: Readonly<Record<string, string>> = {
  'interact.enterVehicle': 'Get in',
  'interact.pickup': 'Pick up',
  'interact.talk': 'Talk',
  'engine.vehicle.locked': 'The doors are locked',
  'engine.vehicle.occupied': 'Someone is already driving',
  'engine.vehicle.tooFar': 'Get closer to the car',
  'engine.vehicle.tooFast': 'Slow down before you get out',
  'engine.vehicle.noExit': 'No room to get out here',
};

/** Control hint by device for each interaction kind: `sim.Enter` for vehicles, `sim.Interact` for the rest. */
function hint(kind: number, device: DeviceKind): string {
  const enter = kind === 1;
  if (device === 'gamepad') return 'Y';
  if (device === 'touch') return '';
  return enter ? 'F' : 'E';
}

const STYLE = `
.dv-prompt{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 18vh);transform:translateX(-50%);display:flex;align-items:center;gap:.6rem;
padding:.5rem .9rem;border-radius:.6rem;background:rgba(14,18,26,.82);color:#f3f5f8;font:600 1rem/1.2 system-ui,sans-serif;pointer-events:none;z-index:30}
.dv-prompt[hidden]{display:none}
.dv-prompt__key{min-width:1.8rem;padding:.15rem .45rem;border-radius:.35rem;background:#f3f5f8;color:#10141c;text-align:center}
.dv-prompt__key:empty{display:none}
.dv-prompt__bar{display:none;inline-size:5rem;block-size:.35rem;border-radius:.2rem;background:rgba(255,255,255,.25);overflow:hidden}
.dv-prompt--hold .dv-prompt__bar{display:block}
.dv-prompt__fill{display:block;block-size:100%;inline-size:0;background:#f2c230}
.dv-prompt--blocked{background:rgba(70,20,20,.88)}
.dv-speed{position:fixed;right:calc(env(safe-area-inset-right,0px) + 1rem);bottom:calc(env(safe-area-inset-bottom,0px) + 1rem);padding:.4rem .8rem;border-radius:.5rem;
background:rgba(14,18,26,.8);color:#f3f5f8;font:700 1.4rem/1.1 system-ui,sans-serif;font-variant-numeric:tabular-nums;pointer-events:none;z-index:30}
.dv-speed[hidden]{display:none}
.dv-speed small{font-size:.75rem;font-weight:600;opacity:.8;margin-inline-start:.4rem}
`;

export class PromptOverlay {
  private readonly style: HTMLStyleElement;
  readonly prompt: HTMLDivElement;
  readonly speed: HTMLDivElement;
  private readonly key: HTMLSpanElement;
  private readonly label: HTMLSpanElement;
  private readonly fill: HTMLSpanElement;
  private shown = '';

  constructor(container: HTMLElement) {
    this.style = document.createElement('style');
    this.style.textContent = STYLE;
    document.head.append(this.style);

    this.prompt = document.createElement('div');
    this.prompt.className = 'dv-prompt';
    this.prompt.dataset['testid'] = 'dv-prompt';
    this.prompt.setAttribute('role', 'status');
    this.prompt.setAttribute('aria-live', 'polite');
    this.prompt.hidden = true;
    this.key = document.createElement('span');
    this.key.className = 'dv-prompt__key';
    this.label = document.createElement('span');
    this.label.className = 'dv-prompt__label';
    const bar = document.createElement('span');
    bar.className = 'dv-prompt__bar';
    this.fill = document.createElement('span');
    this.fill.className = 'dv-prompt__fill';
    bar.append(this.fill);
    this.prompt.append(this.key, this.label, bar);

    this.speed = document.createElement('div');
    this.speed.className = 'dv-speed';
    this.speed.dataset['testid'] = 'dv-speed';
    this.speed.hidden = true;
    container.append(this.prompt, this.speed);
  }

  /** Call once per frame with the newest side blocks. */
  update(prompt: PromptSide | null, vehicle: VehicleSide | null, device: DeviceKind): void {
    if (!prompt) {
      if (!this.prompt.hidden) this.prompt.hidden = true;
      this.shown = '';
    } else {
      const text = prompt.reason ? (TEXT[prompt.reason] ?? prompt.reason) : (TEXT[prompt.key] ?? prompt.key);
      const sig = `${text}|${prompt.reason ? 1 : 0}|${prompt.hold ? 1 : 0}|${device}`;
      if (sig !== this.shown) {
        this.shown = sig;
        this.label.textContent = text;
        this.key.textContent = prompt.reason ? '' : hint(prompt.kind, device);
        this.prompt.classList.toggle('dv-prompt--hold', prompt.hold && !prompt.reason);
        this.prompt.classList.toggle('dv-prompt--blocked', Boolean(prompt.reason));
        this.prompt.dataset['kind'] = String(prompt.kind);
        this.prompt.dataset['blocked'] = prompt.reason ? '1' : '0';
      }
      this.fill.style.inlineSize = `${Math.round(prompt.progress * 100)}%`;
      this.prompt.hidden = false;
    }
    if (vehicle && vehicle.state === 201) {
      this.speed.hidden = false;
      const kph = Math.round(Math.abs(vehicle.speed) * 3.6);
      const gear = vehicle.gear < 0 ? 'R' : vehicle.gear === 0 ? 'N' : String(vehicle.gear);
      this.speed.dataset['kph'] = String(kph);
      this.speed.innerHTML = `${kph}<small>km/h</small><small>G${gear}</small>`;
    } else if (!this.speed.hidden) this.speed.hidden = true;
  }

  dispose(): void {
    this.prompt.remove();
    this.speed.remove();
    this.style.remove();
  }
}
