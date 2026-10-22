/**
 * QA page `/qa/cutscene-spike.html` (M04c; built only when VITE_DV_QA=1): the title gesture target, a stand-in render loop (a canvas
 * that animates every frame, so "the loop stopped" and "the loop runs again" are visible and countable), the DOM cutscene host and
 * the overlay. It publishes `window.__dvBridge.media = { state(), play(id), skip(), sequence(ids), pingPong(ids), useCanvasSource(on) }`.
 *
 *   `?tier=mobile-low` makes the host hold a screen wake lock like the mobile tiers do.
 */
import { AudioServiceImpl, type AudioContextLike } from '@dv/engine/client/audio';
import { createFirstGestureUnlock } from '@dv/engine/platform/media';
import { createMediaQa } from './media-assembly.ts';
import '@dv/ui/tokens.css';
import '@dv/ui/kit.css';
import '@dv/ui/shell.css';

const params = new URLSearchParams(location.search);
const tier = params.get('tier') ?? 'desktop';
const out = document.getElementById('out') as HTMLElement;
const stage = document.getElementById('stage') as HTMLCanvasElement;

// ---- the stand-in render loop

const loop = { running: false, frames: 0, id: 0 };
const ctx2d = stage.getContext('2d');
function frame(t: number): void {
  loop.frames++;
  if (ctx2d) {
    stage.width = stage.clientWidth;
    stage.height = stage.clientHeight;
    ctx2d.fillStyle = `hsl(${(t / 40) % 360},45%,22%)`;
    ctx2d.fillRect(0, 0, stage.width, stage.height);
    ctx2d.fillStyle = '#8ecae6';
    ctx2d.beginPath();
    ctx2d.arc(stage.width * (0.5 + 0.3 * Math.cos(t / 700)), stage.height * (0.5 + 0.25 * Math.sin(t / 500)), 40, 0, Math.PI * 2);
    ctx2d.fill();
  }
  if (loop.running) loop.id = requestAnimationFrame(frame);
}
const loopControl = {
  startLoop(): void {
    if (loop.running) return;
    loop.running = true;
    loop.id = requestAnimationFrame(frame);
  },
  stopLoop(): void {
    loop.running = false;
    cancelAnimationFrame(loop.id);
  },
};
loopControl.startLoop();
const sim = { paused: false, setPaused(p: boolean): void { this.paused = p; } };

// ---- the media layer

const AudioCtor = (globalThis as { AudioContext?: new () => unknown; webkitAudioContext?: new () => unknown }).AudioContext
  ?? (globalThis as { webkitAudioContext?: new () => unknown }).webkitAudioContext;
const audio = new AudioServiceImpl({
  createContext: () => {
    if (!AudioCtor) throw new Error('no AudioContext');
    return new AudioCtor() as AudioContextLike;
  },
  audioSession: (navigator as { audioSession?: { type: string } }).audioSession ?? null,
});
const unlock = createFirstGestureUnlock({ audio });
const { player, host, budget, wakeLock } = createMediaQa({ unlock, loop: loopControl, sim, tier, dataSaver: () => params.get('datasaver') === '1' });

const show = (): void => {
  out.textContent = JSON.stringify(state(), null, 2);
};
function state() {
  return {
    ...unlock.state(),
    tier,
    loop: { running: loop.running, frames: loop.frames },
    host: { visible: host.visible },
    simPaused: sim.paused,
    wakeLockHeld: wakeLock.held,
    crossOriginIsolated: (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true,
    mediaMB: budget.mediaMB(),
  };
}

// The first gesture on the title: audio context and the pool of three videos.
unlock.attach(document.querySelector('[data-testid="title"]') as HTMLElement);
void unlock.ready.then(show);

const media = {
  state,
  play: (id: string) => player.play(id),
  skip: () => player.skip(),
  sequence: (ids: string[]) => player.sequence(ids),
  pingPong: (ids: [string, string]) => player.pingPong(ids),
  useCanvasSource: (on: boolean) => player.useCanvasSource(on),
  /** Text of the subtitle line on screen now ('' when none). */
  subtitle: () => document.querySelector('[data-testid="cutscene-subtitle"]')?.textContent ?? '',
  aiChip: () => document.querySelector('[data-testid="cutscene-ai-chip"]') !== null,
};
const w = window as unknown as { __dvBridge?: Record<string, unknown> };
w.__dvBridge = { ...(w.__dvBridge ?? {}), media };
setInterval(show, 500);
