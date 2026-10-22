/**
 * QA page (built only when VITE_DV_QA=1): scrubs a recorded mission run (M05a2; 03-story-missions.md C10, "simulate once, scrub").
 * The file is a `.dvtl` that `pnpm missions:preview` or `check:missions` wrote; the page decodes it and shows the recorded entity
 * tracks on a top-down map at the scrubbed tick (`lastBefore`, a binary search over each track's sample ticks), the chapters
 * (one per `mis.stage` event), the stage that is current and the `mis.say` subtitle that is showing. Nothing is simulated here.
 * The state is on `window.__dvBridge.preview` for the Playwright test `@mission-preview`.
 */
import { decodeDvtl, lastBefore, type Dvtl, type DvtlEvent } from '@dv/engine/sim/dvtl';
import { qaMissionBundle } from './missions.ts';
// A recording of the sample (`pnpm missions:preview -- --mission m.dev.sample --seed 1 --out tests/fixtures/missions`), so that the page shows
// something at the bare URL, for example in a pull request preview.
import sampleRecordingUrl from '../../../../tests/fixtures/missions/m.dev.sample.1.dvtl?url';

interface Chapter {
  tick: number;
  index: number;
  id: string;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const file = $<HTMLInputElement>('file');
const status = $('status');
const scrub = $<HTMLInputElement>('scrub');
const tickEl = $('tick');
const secEl = $('sec');
const stageEl = $('stage');
const posEl = $('pos');
const chaptersEl = $('chapters');
const subtitleEl = $('subtitle');
const canvas = $<HTMLCanvasElement>('map');

let dvtl: Dvtl | null = null;
let chapters: Chapter[] = [];
let says: { tick: number; endTick: number; speaker: string; line: string }[] = [];
let lineText: Record<string, string> = {};
let bounds = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };

const bridge = ((window as unknown as { __dvBridge?: Record<string, unknown> }).__dvBridge ??= {}) as Record<string, unknown>;

function mapBounds(d: Dvtl): void {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const t of d.tracks) {
    for (let i = 0; i < t.ticks.length; i++) {
      const x = t.pos[i * 3] as number;
      const z = t.pos[i * 3 + 2] as number;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  if (!Number.isFinite(minX)) [minX, maxX, minZ, maxZ] = [0, 1, 0, 1];
  const pad = 15;
  bounds = { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
}

function draw(tick: number): void {
  const g = canvas.getContext('2d');
  if (!g || !dvtl) return;
  const style = getComputedStyle(document.body);
  const ink = style.getPropertyValue('--ink').trim() || '#e6e9ef';
  const accent = style.getPropertyValue('--accent').trim() || '#7cc4ff';
  const warm = style.getPropertyValue('--warm').trim() || '#ffb86b';
  g.clearRect(0, 0, canvas.width, canvas.height);
  const sx = canvas.width / (bounds.maxX - bounds.minX);
  const sz = canvas.height / (bounds.maxZ - bounds.minZ);
  const k = Math.min(sx, sz);
  const px = (x: number): number => (x - bounds.minX) * k;
  const pz = (z: number): number => (z - bounds.minZ) * k;
  dvtl.tracks.forEach((t, n) => {
    const upTo = lastBefore(t.ticks, tick);
    if (upTo < 0) return;
    g.strokeStyle = t.name === 'player' ? accent : warm;
    g.globalAlpha = t.name === 'player' ? 0.9 : 0.5;
    g.lineWidth = t.name === 'player' ? 2 : 1;
    g.beginPath();
    for (let i = 0; i <= upTo; i++) {
      const x = px(t.pos[i * 3] as number);
      const z = pz(t.pos[i * 3 + 2] as number);
      if (i === 0) g.moveTo(x, z);
      else g.lineTo(x, z);
    }
    g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = t.name === 'player' ? accent : warm;
    g.beginPath();
    g.arc(px(t.pos[upTo * 3] as number), pz(t.pos[upTo * 3 + 2] as number), t.name === 'player' ? 5 : 3, 0, Math.PI * 2);
    g.fill();
    if (t.name !== 'player') {
      g.fillStyle = ink;
      g.font = '11px monospace';
      g.fillText(t.name.replace(/^cast\./, ''), px(t.pos[upTo * 3] as number) + 6, pz(t.pos[upTo * 3 + 2] as number) - 4);
    }
    void n;
  });
}

function show(tick: number): void {
  if (!dvtl) return;
  const t = Math.max(0, Math.min(dvtl.endTick, Math.round(tick)));
  scrub.value = String(t);
  tickEl.textContent = String(t);
  secEl.textContent = (t / 60).toFixed(1);
  let cur: Chapter | null = null;
  for (const c of chapters) if (c.tick <= t) cur = c;
  stageEl.textContent = cur ? `${cur.index} ${cur.id}` : '-';
  chaptersEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-current', String(cur !== null && Number(b.dataset['tick']) === cur.tick && b.dataset['id'] === cur.id)));
  const player = dvtl.tracks.find((x) => x.name === 'player');
  const i = player ? lastBefore(player.ticks, t) : -1;
  if (player && i >= 0) {
    const pos = [player.pos[i * 3], player.pos[i * 3 + 1], player.pos[i * 3 + 2]] as number[];
    posEl.textContent = pos.map((n) => n.toFixed(2)).join(', ');
    posEl.dataset['pos'] = JSON.stringify(pos);
  } else {
    posEl.textContent = '-';
    delete posEl.dataset['pos'];
  }
  const say = says.find((s) => t >= s.tick && t < s.endTick);
  subtitleEl.textContent = say ? `${say.speaker ? `${say.speaker}: ` : ''}${lineText[say.line] ?? say.line}` : '';
  subtitleEl.dataset['line'] = say ? say.line : '';
  draw(t);
}

function load(bytes: ArrayBuffer, name: string): void {
  try {
    dvtl = decodeDvtl(bytes);
  } catch (e) {
    status.textContent = `error: ${e instanceof Error ? e.message : String(e)}`;
    return;
  }
  const meta = dvtl.meta as { mission?: string; seed?: number; outcome?: string };
  const stageEvents = dvtl.events.filter((e: DvtlEvent) => e.t === 'mis.stage');
  chapters = stageEvents.map((e) => ({ tick: e.tick, index: Number((e.data as { index?: number }).index ?? 0), id: String((e.data as { id?: string }).id ?? '') }));
  says = dvtl.events
    .filter((e) => e.t === 'mis.say')
    .map((e) => {
      const d = e.data as { speaker?: string; line?: string; ticks?: number };
      return { tick: e.tick, endTick: e.tick + (typeof d.ticks === 'number' ? d.ticks : 150), speaker: String(d.speaker ?? ''), line: String(d.line ?? '') };
    });
  const bundle = meta.mission ? qaMissionBundle(meta.mission) : null;
  lineText = (bundle?.['lines'] ?? {}) as Record<string, string>;
  mapBounds(dvtl);
  scrub.max = String(dvtl.endTick);
  chaptersEl.replaceChildren(
    ...chapters.map((c) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${c.index} ${c.id}`;
      b.dataset['tick'] = String(c.tick);
      b.dataset['id'] = c.id;
      b.addEventListener('click', () => show(c.tick));
      li.append(b);
      return li;
    }),
  );
  status.textContent = `${name}: ${meta.mission ?? '?'} seed ${meta.seed ?? '?'} ${meta.outcome ?? ''}, ${dvtl.endTick} ticks, ${chapters.length} chapters, ${dvtl.tracks.length} tracks, ${says.length} lines`;
  status.dataset['loaded'] = 'true';
  show(0);
}

bridge['preview'] = {
  get loaded() {
    return dvtl !== null;
  },
  get chapters() {
    return chapters;
  },
  get says() {
    return says;
  },
  get dvtl() {
    return dvtl;
  },
  setTick: (t: number) => show(t),
  tick: () => Number(scrub.value),
};

scrub.addEventListener('input', () => show(Number(scrub.value)));
file.addEventListener('change', () => {
  const f = file.files?.[0];
  if (f) void f.arrayBuffer().then((b) => load(b, f.name));
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) void f.arrayBuffer().then((b) => load(b, f.name));
});

const url = new URLSearchParams(location.search).get('timeline') ?? (new URLSearchParams(location.search).has('empty') ? null : sampleRecordingUrl);
if (url) {
  status.textContent = `loading ${url}`;
  void fetch(url)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${url}: ${r.status}`))))
    .then((b) => load(b, url))
    .catch((e: unknown) => {
      status.textContent = `error: ${e instanceof Error ? e.message : String(e)}`;
    });
}
