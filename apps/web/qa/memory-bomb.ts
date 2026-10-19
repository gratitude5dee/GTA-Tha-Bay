/**
 * QA page (built only when VITE_DV_QA=1; 11-platform-perf.md section 5, M01c). iPhone gives no process-memory readout and no crash
 * report, so this page finds the ceiling empirically: it allocates 64 MB steps, first `ArrayBuffer`s (committed by filling them),
 * then `DataTexture`s uploaded to the GPU, and writes the running total to `localStorage['dv.membomb']` BEFORE each step. When the
 * system ends the page, the stored value is the total of the allocation that killed it. On relaunch the page shows that total
 * and the heartbeat record the game left (`dv.hb`).
 */
import { createBombRenderer, type BombRenderer } from '@dv/engine/platform/bomb-gpu';

const STEP_BYTES = 64 * 1024 * 1024;
const BUFFER_STEPS = 12; // 768 MB of ArrayBuffers before the textures start
const KEY = 'dv.membomb';
const PHASE_KEY = 'dv.membomb.phase';
const HB_KEY = 'dv.hb';
/** 4096 x 4096 RGBA8 = 64 MiB. */
const TEX_SIDE = 4096;

const out = document.getElementById('out') as HTMLElement;
const keep: unknown[] = [];
let totalMB = 0;
let running = false;
let renderer: BombRenderer | null = null;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the page still allocates, it just cannot remember the total.
  }
}

function heartbeatState(): string {
  const raw = read(HB_KEY);
  if (!raw) return 'none';
  try {
    const r = JSON.parse(raw) as { state?: string; tier?: string; memEstMB?: number; t?: number };
    return `${r.state ?? '?'} tier=${r.tier ?? '?'} memEstMB=${String(r.memEstMB ?? '?')}`;
  } catch {
    return 'unreadable';
  }
}

function show(extra = ''): void {
  const last = read(KEY);
  out.textContent = [
    `current total: ${totalMB} MB${running ? ' (running)' : ''}`,
    `last stored total: ${last === null ? 'none' : `${last} MB`}  phase: ${read(PHASE_KEY) ?? 'none'}`,
    `heartbeat: ${heartbeatState()}`,
    `standalone: ${String(matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true)}`,
    extra,
  ]
    .filter(Boolean)
    .join('\n');
}

async function ensureRenderer(): Promise<BombRenderer> {
  renderer ??= await createBombRenderer();
  return renderer;
}

async function step(n: number): Promise<void> {
  const next = totalMB + STEP_BYTES / (1024 * 1024);
  // Written before the allocation so a kill leaves the total that was being reached.
  write(KEY, String(next));
  if (n < BUFFER_STEPS) {
    write(PHASE_KEY, 'arraybuffer');
    const buf = new Uint8Array(STEP_BYTES);
    buf.fill(n + 1);
    keep.push(buf);
  } else {
    write(PHASE_KEY, 'datatexture');
    const r = await ensureRenderer();
    keep.push(r.upload(TEX_SIDE, n + 1));
  }
  totalMB = next;
}

async function run(): Promise<void> {
  if (running) return;
  running = true;
  let n = keep.length;
  while (running) {
    show();
    try {
      await step(n);
    } catch (e) {
      running = false;
      show(`allocation failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    n += 1;
    await new Promise((r) => setTimeout(r, 200));
  }
  show('stopped');
}

document.getElementById('start')?.addEventListener('click', () => void run());
document.getElementById('stop')?.addEventListener('click', () => {
  running = false;
});
document.getElementById('clear')?.addEventListener('click', () => {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(PHASE_KEY);
  } catch {
    // Nothing to clear.
  }
  show();
});

show();
