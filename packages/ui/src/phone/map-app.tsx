/**
 * The phone Map app (M02c2; 10-ui-hud-xr.md 2.10, 02-world-maps.md sections 3 and 6): the full map on a canvas the world draws
 * (`MapPort.open`), with pan (one pointer), pinch and wheel zoom, a layer legend, a search box over the offline geocoder, a candidate
 * pin with Set waypoint and (in the sandbox) Fast travel, and the attribution corner that collapses to an "(i)" button after 5 s and
 * stays reachable. Thin by design: every pixel of the map itself is drawn by `packages/world`.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import attribution from '../../../../config/attribution.world.json';
import { t } from '../i18n/index.ts';
import { Button } from '../kit/widgets.tsx';
import { MAP_LAYERS_ALL, MAP_LAYER_BITS, type MapLayerId, type MapPickHit, type MapPlaceHit, type MapPort, type MapSessionPort } from './map-port.ts';

export const ATTRIBUTION_COLLAPSE_MS = 5000;
const SEARCH_DEBOUNCE_MS = 160;
const TAP_SLOP_PX = 8;
const TAP_MS = 600;

interface AttributionEntry {
  id: string;
  text: string;
  surfaces: string[];
  offerUrl?: string;
}

/** The corner line: the OSM entry and the DataSF entry of the full-map surface. */
export function cornerLines(entries: readonly AttributionEntry[] = (attribution as { entries: AttributionEntry[] }).entries): string[] {
  const onMap = entries.filter((e) => e.surfaces.includes('full-map'));
  const osm = onMap.find((e) => e.id === 'osm');
  const sf = onMap.find((e) => e.id.startsWith('datasf'));
  return [osm?.text, sf?.text].filter((x): x is string => typeof x === 'string');
}

export interface MapAppProps {
  port: MapPort | null;
  /** Sets the waypoint (the sim also plans the GPS route). */
  onWaypoint(x: number, z: number): void;
  /** Fast travel to a point (sandbox only); absent hides the button. */
  onTravel?: (x: number, z: number) => void;
  onBack(): void;
}

interface Selected {
  label: string;
  x: number;
  z: number;
}

const LEGEND: MapLayerId[] = ['water', 'parks', 'buildings', 'streets', 'transit', 'hillshade', 'labels'];

function describePick(p: MapPickHit): string {
  switch (p.kind) {
    case 'nhood': {
      const s = t(`nhood.${p.id ?? ''}`);
      return s === `nhood.${p.id ?? ''}` ? (p.id ?? '') : s;
    }
    case 'landmark':
    case 'poi':
    case 'blip':
      return p.id ?? '';
    default:
      return `${Math.round(p.x)}, ${Math.round(p.z)}`;
  }
}

export function MapApp(props: MapAppProps) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const session = useRef<MapSessionPort | null>(null);
  const [view, setView] = useState({ mPerPx: 2, cx: 0, cz: 0 });
  const [layers, setLayers] = useState<number>(MAP_LAYERS_ALL);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MapPlaceHit[] | null>(null);
  const [note, setNote] = useState('');
  const [attr, setAttr] = useState<'expanded' | 'collapsed'>('expanded');
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; t: number; moved: boolean; pinch: number }>({ startX: 0, startY: 0, t: 0, moved: false, pinch: 0 });

  const sync = (): void => {
    const s = session.current;
    if (!s) return;
    const st = s.state();
    setView({ mPerPx: st.mPerPx, cx: st.cx, cz: st.cz });
  };

  // open the session on the canvas, keep its size in step with the stage
  useEffect(() => {
    const cv = canvas.current, box = stage.current;
    if (!props.port || !cv || !box) return undefined;
    let raf = 0;
    const s = props.port.open(cv, () => {
      if (raf === 0) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          session.current?.draw();
        });
      }
    });
    session.current = s;
    const fit = (): void => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = box.getBoundingClientRect();
      s.resize(Math.max(64, Math.round(r.width * dpr)), Math.max(64, Math.round(r.height * dpr)));
      sync();
    };
    fit();
    s.centreOnPlayer();
    sync();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(box);
    return () => {
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
      s.dispose();
      session.current = null;
    };
  }, [props.port]);

  // the attribution corner collapses after 5 s
  useEffect(() => {
    if (attr !== 'expanded') return undefined;
    const id = setTimeout(() => setAttr('collapsed'), ATTRIBUTION_COLLAPSE_MS);
    return () => clearTimeout(id);
  }, [attr]);

  // search, debounced
  useEffect(() => {
    const q = query.trim();
    if (!props.port || q.length < 2) {
      setResults(null);
      return undefined;
    }
    let live = true;
    const id = setTimeout(() => {
      props.port!.search(q, 6).then(
        (r) => live && setResults(r),
        () => live && setResults([]),
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [query, props.port]);

  const toCanvas = (e: PointerEvent | WheelEvent): { x: number; y: number } => {
    const cv = canvas.current as HTMLCanvasElement;
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * cv.width) / Math.max(1, r.width), y: ((e.clientY - r.top) * cv.height) / Math.max(1, r.height) };
  };

  const choose = (p: Selected, zoom?: number): void => {
    const s = session.current;
    setSelected(p);
    setNote('');
    if (!s) return;
    s.setMarker({ x: p.x, z: p.z });
    if (zoom !== undefined) s.setZoom(zoom);
    s.centreOn(p.x, p.z);
    sync();
  };

  const onDown = (e: PointerEvent): void => {
    const pt = toCanvas(e);
    pointers.current.set(e.pointerId, pt);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 1) {
      g.startX = pt.x;
      g.startY = pt.y;
      g.t = performance.now();
      g.moved = false;
    }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      g.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      g.moved = true;
    }
  };

  const onMove = (e: PointerEvent): void => {
    const s = session.current;
    const prev = pointers.current.get(e.pointerId);
    if (!s || !prev) return;
    const pt = toCanvas(e);
    pointers.current.set(e.pointerId, pt);
    const g = gesture.current;
    if (pointers.current.size === 1) {
      if (!g.moved && Math.hypot(pt.x - g.startX, pt.y - g.startY) > TAP_SLOP_PX) g.moved = true;
      if (g.moved) {
        s.panBy(pt.x - prev.x, pt.y - prev.y);
        sync();
      }
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.pinch > 0 && d > 0) {
        s.zoomBy(g.pinch / d, (a.x + b.x) / 2, (a.y + b.y) / 2);
        sync();
      }
      g.pinch = d;
    }
  };

  const onUp = (e: PointerEvent): void => {
    const s = session.current;
    const g = gesture.current;
    const wasSingle = pointers.current.size === 1;
    const pt = toCanvas(e);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) g.pinch = 0;
    if (!s || !wasSingle || g.moved || performance.now() - g.t > TAP_MS) return;
    const hit = s.pick(pt.x, pt.y);
    if (hit) choose({ label: describePick(hit), x: hit.x, z: hit.z });
  };

  const onWheel = (e: WheelEvent): void => {
    const s = session.current;
    if (!s) return;
    e.preventDefault();
    const pt = toCanvas(e);
    s.zoomBy(Math.pow(2, e.deltaY / 300), pt.x, pt.y);
    sync();
  };

  const toggleLayer = (id: MapLayerId): void => {
    const next = layers ^ MAP_LAYER_BITS[id];
    setLayers(next);
    session.current?.setLayers(next);
  };

  if (!props.port) {
    return (
      <main class="dv-page dv-phone dv-map-app" data-testid="phone" data-app="map">
        <h1>{t('phone.app.map')}</h1>
        <p data-testid="map-unavailable">{t('phone.map.unavailable')}</p>
        <Button id="phone-home" label={t('phone.home')} onPress={props.onBack} />
      </main>
    );
  }

  const corner = cornerLines();
  return (
    <main class="dv-page dv-phone dv-map-app" data-testid="phone" data-app="map">
      <h1>{t('phone.map.title')}</h1>
      <div class="dv-map-search">
        <label for="dv-map-q">{t('phone.map.search.label')}</label>
        <input
          id="dv-map-q" type="search" data-testid="map-search" data-fid="map.search" autocomplete="off" value={query}
          placeholder={t('phone.map.search.placeholder')}
          onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
        />
        {results !== null ? (
          <ul class="dv-map-results" data-testid="map-results" aria-label={t('phone.map.results')}>
            {results.length === 0 ? <li class="dv-muted">{query.trim().length < 2 ? t('phone.map.search.hint') : t('phone.map.search.none')}</li> : null}
            {results.map((r, i) => (
              <li key={`${r.kind}:${r.label}:${i}`}>
                <button type="button" class="dv-map-result" data-fid={`map.result.${i}`} data-kind={r.kind} data-testid={`map-result-${i}`} onClick={() => { choose({ label: r.label, x: r.x, z: r.z }, 1); setResults(null); }}>
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div class="dv-map-stage" ref={stage} data-testid="map-stage" data-zoom={view.mPerPx.toFixed(3)} data-cx={view.cx.toFixed(1)} data-cz={view.cz.toFixed(1)}>
        <canvas
          ref={canvas} class="dv-map-canvas" data-testid="map-canvas" role="img" aria-label={t('phone.map.canvas')} tabIndex={0}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}
        />
        <div class="dv-map-zoom">
          <button type="button" class="dv-btn dv-btn-secondary" data-fid="map.zoomIn" data-testid="map-zoom-in" aria-label={t('phone.map.zoomIn')} onClick={() => { session.current?.zoomBy(0.5); sync(); }}>+</button>
          <button type="button" class="dv-btn dv-btn-secondary" data-fid="map.zoomOut" data-testid="map-zoom-out" aria-label={t('phone.map.zoomOut')} onClick={() => { session.current?.zoomBy(2); sync(); }}>-</button>
          <button type="button" class="dv-btn dv-btn-secondary" data-fid="map.recenter" data-testid="map-recenter" aria-label={t('phone.map.recenter')} onClick={() => { session.current?.centreOnPlayer(); sync(); }}>◎</button>
        </div>
        <div class="dv-map-attrib" data-testid="map-attribution" data-state={attr}>
          {attr === 'expanded' ? (
            <>
              <span class="dv-map-attrib-text" data-testid="map-attribution-text">{corner.join(' · ')}</span>
              <button type="button" class="dv-link" data-fid="map.attrib.hide" data-testid="map-attribution-toggle" aria-label={t('phone.map.attribution.hide')} onClick={() => setAttr('collapsed')}>(i)</button>
            </>
          ) : (
            <button type="button" class="dv-link" data-fid="map.attrib.show" data-testid="map-attribution-toggle" aria-label={t('phone.map.attribution.show')} onClick={() => setAttr('expanded')}>(i)</button>
          )}
        </div>
      </div>

      <fieldset class="dv-map-legend" data-testid="map-legend">
        <legend>{t('phone.map.legend')}</legend>
        {LEGEND.map((id) => (
          <label key={id} class="dv-map-layer">
            <input type="checkbox" data-fid={`map.layer.${id}`} data-testid={`map-layer-${id}`} checked={(layers & MAP_LAYER_BITS[id]) !== 0} onChange={() => toggleLayer(id)} />
            {t(`phone.map.layer.${id}`)}
          </label>
        ))}
      </fieldset>

      <section class="dv-map-sheet" data-testid="map-sheet" aria-live="polite">
        {selected ? (
          <>
            <strong data-testid="map-selected">{selected.label}</strong>
            <div class="dv-actions">
              <Button id="map-waypoint" label={t('phone.map.waypoint')} style="primary" onPress={() => { props.onWaypoint(selected.x, selected.z); setNote(t('phone.map.waypoint.set')); }} />
              {props.onTravel ? <Button id="map-travel" label={t('phone.map.travel')} onPress={() => props.onTravel?.(selected.x, selected.z)} /> : null}
            </div>
          </>
        ) : (
          <span class="dv-muted">{t('phone.map.none')}</span>
        )}
        {note ? <p data-testid="map-note">{note}</p> : null}
      </section>
      <Button id="phone-home" label={t('phone.home')} onPress={props.onBack} />
    </main>
  );
}
