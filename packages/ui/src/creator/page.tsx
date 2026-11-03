/**
 * The character creator (10-ui-pages.md section 2.8, R-UI-01). Tabs Body, Face, Hair, Outfit, Voice, Style and Name; preset cards and
 * slider rows; Randomize, Reset, Undo and Redo (20 steps) and Done. The saved value is `PlayerAvatar` in `CoreSlice.avatar` through
 * `UiCommand save.avatar`. The preview is the stage port (the shared canvas through the menu scene); a missing stage still lets the
 * player edit and save.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JsonObject } from '@dv/shared';
import iconsSvg from '../../../../assets/creator-kit/icons.svg?raw';
import { lk, t } from '../i18n/index.ts';
import { Button, Slider, Tabs } from '../kit/widgets.tsx';
import { useShell } from '../shell/context.tsx';
import type { PageProps } from '../shell/types.ts';
import {
  CATALOG, EditHistory, NAME_MAX, cardsOf, checkName, defaultAvatar, mulberry32, normalizeAvatar, partOf, pickPart, randomize,
  type CreatorPart, type CreatorSlot, type NameProblem, type PlayerAvatar,
} from './catalog.ts';
import { encodeAppearance } from './appearance.ts';
import type { VoicePreview } from './voice-preview.ts';
import { mannequinParams, type CreatorStagePort } from './stage.ts';

type TabId = 'body' | 'face' | 'hair' | 'outfit' | 'voice' | 'style' | 'name';
const TABS: readonly TabId[] = ['body', 'face', 'hair', 'outfit', 'voice', 'style', 'name'];
const OUTFIT_SLOTS: readonly CreatorSlot[] = ['top', 'bottom', 'shoes', 'accessory'];

const PROBLEM_KEY: Record<NameProblem, string> = {
  empty: lk('creator.name.empty'),
  long: lk('creator.name.long'),
  chars: lk('creator.name.chars'),
};

/** The sprite is inserted once; cards reference it with `<use>`. */
function Sprite() {
  return <div class="dv-sprite" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconsSvg }} />;
}

/** The portrait card art of a part (M10d4): the 256 px card of `portrait/pc-<id>` once the stage has it, else the sprite icon. */
function usePortrait(stage: CreatorStagePort | null, ref: string | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (ref && stage?.portrait) {
      stage.portrait(ref).then((u) => live && setSrc(u), () => undefined);
    }
    return () => {
      live = false;
    };
  }, [stage, ref]);
  return src;
}

function PartCard(props: { part: CreatorPart; slot: CreatorSlot; on: boolean; stage: CreatorStagePort | null; onPick(): void }) {
  const { part, on } = props;
  const portrait = usePortrait(props.stage, part.portrait);
  return (
    <button
      type="button"
      role="radio"
      class="dv-part"
      aria-checked={on ? 'true' : 'false'}
      data-fid={`creator.part.${part.id}`}
      data-testid={`creator-card-${part.id}`}
      data-model={part.model ?? ''}
      data-portrait={part.portrait ?? ''}
      onClick={props.onPick}
    >
      {portrait ? (
        <img class="dv-part-art dv-part-portrait" src={portrait} alt="" aria-hidden="true" draggable={false} data-portrait-loaded="1" />
      ) : (
        <svg viewBox="0 0 48 48" class="dv-part-art" aria-hidden="true">
          <use href={`#cr-${props.slot}-${part.index}`} />
        </svg>
      )}
      <span class="dv-part-name">{t(part.titleKey)}</span>
    </button>
  );
}

function NoneCard(props: { on: boolean; onPick(): void }) {
  return (
    <button type="button" role="radio" class="dv-part" aria-checked={props.on ? 'true' : 'false'} data-fid="creator.part.none" data-testid="creator-card-none" onClick={props.onPick}>
      <span class="dv-part-art dv-part-none" aria-hidden="true">{'∅'}</span>
      <span class="dv-part-name">{t('creator.none')}</span>
    </button>
  );
}

function Swatches(props: { id: string; label: string; colors: string[]; value: number; onPick(i: number): void }) {
  return (
    <div class="dv-swatches" role="radiogroup" aria-label={props.label} data-testid={`creator-${props.id}`}>
      {props.colors.map((c, i) => (
        <button
          key={c}
          type="button"
          role="radio"
          class="dv-swatch"
          style={{ background: c }}
          aria-checked={i === props.value ? 'true' : 'false'}
          aria-label={`${props.label} ${i + 1}`}
          data-fid={`creator.${props.id}.${i}`}
          data-testid={`creator-${props.id}-${i}`}
          onClick={() => props.onPick(i)}
        />
      ))}
    </div>
  );
}

export interface CreatorEditorProps {
  initial: PlayerAvatar;
  /** 'new': first run after the profile name; 'edit': Profile > Edit appearance; 'wardrobe': outfit tab only. */
  mode: 'new' | 'edit' | 'wardrobe';
  stage: CreatorStagePort | null;
  /** The voice preview (M06a4): null or absent while no clip or no audio exists; the Preview button then stays disabled with its hint. */
  voicePreview?: ((onSubtitle: (text: string | null) => void) => VoicePreview | null) | null;
  reducedMotion: boolean;
  onDone(a: PlayerAvatar): void;
  onBack?(): void;
}

export function CreatorEditor(props: CreatorEditorProps) {
  const hist = useRef<EditHistory | null>(null);
  if (!hist.current) hist.current = new EditHistory(props.initial);
  const h = hist.current;
  const [, redraw] = useState(0);
  const [tab, setTab] = useState<TabId>(props.mode === 'wardrobe' ? 'outfit' : 'body');
  const [zoom, setZoom] = useState<'full' | 'head'>('full');
  const [name, setName] = useState(props.initial.name);
  const [callsign, setCallsign] = useState(props.initial.callsign);
  const [problem, setProblem] = useState<NameProblem | null>(null);
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const preview = useMemo(() => props.voicePreview?.(setSubtitle) ?? null, [props.voicePreview]);
  const seed = useRef(1);
  const a = h.value;
  const apply = (next: PlayerAvatar, key = ''): void => {
    h.push(next, key, performance.now());
    redraw((n) => n + 1);
  };
  const pick = (slot: CreatorSlot, id: string | undefined): void => apply(pickPart(a, slot, id));

  // Stage: show the current look; the drag rotates the turntable; reduced motion stops the spin.
  const params = useMemo(() => mannequinParams(a), [a]);
  useEffect(() => {
    props.stage?.setReducedMotion(props.reducedMotion);
    props.stage?.show(params);
  }, [params, props.stage, props.reducedMotion]);
  useEffect(() => props.stage?.setZoom(zoom), [zoom, props.stage]);
  useEffect(() => () => props.stage?.hide(), [props.stage]);

  const finish = (): void => {
    const n = checkName(name);
    const c = checkName(callsign);
    if (!n.ok) {
      setTab('name');
      setProblem(n.problem);
      return;
    }
    if (!c.ok) {
      setTab('name');
      setProblem(c.problem);
      return;
    }
    // Normalize once more: whatever the editor holds is stored in loader form.
    const out = normalizeAvatar({ ...a, name: n.name, callsign: c.name }).avatar;
    props.onDone(out);
  };

  const tabs = (props.mode === 'wardrobe' ? (['outfit'] as TabId[]) : [...TABS]).map((id) => ({ id, label: t(`creator.tab.${id}`) }));
  const cards = (slot: CreatorSlot, optional = false) => (
    <div class="dv-parts" role="radiogroup" aria-label={t(`creator.slot.${slot}`)} data-testid={`creator-grid-${slot}`}>
      {optional ? <NoneCard on={partOf(a, slot) === undefined} onPick={() => pick(slot, undefined)} /> : null}
      {cardsOf(CATALOG, slot).map((p) => (
        <PartCard key={p.id} part={p} slot={slot} on={partOf(a, slot) === p.id} stage={props.stage} onPick={() => pick(slot, p.id)} />
      ))}
    </div>
  );

  return (
    <main class="dv-creator" data-testid="creator" data-tab={tab}>
      <Sprite />
      <section class="dv-creator-stage" aria-label={t('creator.preview')}>
        <div
          class="dv-creator-drag"
          tabIndex={0}
          role="img"
          aria-label={t('creator.preview.hint')}
          data-fid="creator.preview"
          data-testid="creator-preview"
          onPointerMove={(e) => {
            if (e.buttons) props.stage?.rotate(e.movementX * 0.01);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') props.stage?.rotate(-0.15);
            if (e.key === 'ArrowRight') props.stage?.rotate(0.15);
          }}
        />
        <div class="dv-creator-zoom" role="group" aria-label={t('creator.zoom')}>
          <Button id="zoom-full" label={t('creator.zoom.full')} style={zoom === 'full' ? 'primary' : 'secondary'} onPress={() => setZoom('full')} />
          <Button id="zoom-head" label={t('creator.zoom.head')} style={zoom === 'head' ? 'primary' : 'secondary'} onPress={() => setZoom('head')} />
        </div>
        <p class="dv-muted" data-testid="creator-summary">{t('creator.summary', { bytes: encodeAppearance(a).length })}</p>
      </section>

      <section class="dv-creator-panel">
        <h1>{t(props.mode === 'wardrobe' ? 'creator.wardrobe' : 'creator.title')}</h1>
        <Tabs id="creator" tabs={tabs} active={tab} onSelect={(id) => setTab(id as TabId)} />
        <div class="dv-creator-body" role="tabpanel" aria-labelledby={`tab-creator-${tab}`}>
          {tab === 'body' ? (
            <>
              {cards('body')}
              <Slider id="creator-height" label={t('creator.height')} value={Math.round(a.body.height * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => apply({ ...a, body: { ...a.body, height: v / 100 } }, 'height')} />
              <Slider id="creator-build" label={t('creator.build')} value={Math.round(a.body.build * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => apply({ ...a, body: { ...a.body, build: v / 100 } }, 'build')} />
              <h3>{t('creator.skin')}</h3>
              <Swatches id="skin" label={t('creator.skin')} colors={CATALOG.palettes.skin} value={a.skinTone} onPick={(i) => apply({ ...a, skinTone: i })} />
            </>
          ) : null}
          {tab === 'face' ? (
            <>
              {cards('face')}
              <h3>{t('creator.morphs')}</h3>
              {CATALOG.morphs.map((m) => (
                <Slider
                  key={m.id}
                  id={`morph-${m.id}`}
                  label={t(m.titleKey)}
                  value={Math.round((a.face.morphs[m.id] ?? 0) * 100)}
                  min={-100}
                  max={100}
                  step={5}
                  onChange={(v) => apply({ ...a, face: { ...a.face, morphs: { ...a.face.morphs, [m.id]: v / 100 } } }, `morph-${m.id}`)}
                />
              ))}
            </>
          ) : null}
          {tab === 'hair' ? (
            <>
              {cards('hair')}
              <h3>{t('creator.hairColor')}</h3>
              <Swatches id="hair-color" label={t('creator.hairColor')} colors={CATALOG.palettes.hair} value={a.hair.color} onPick={(i) => apply({ ...a, hair: { ...a.hair, color: i } })} />
            </>
          ) : null}
          {tab === 'outfit'
            ? OUTFIT_SLOTS.map((slot) => (
                <div key={slot}>
                  <h3>{t(`creator.slot.${slot}`)}</h3>
                  {cards(slot, slot === 'accessory')}
                </div>
              ))
            : null}
          {tab === 'voice' ? (
            <>
              {cards('voice')}
              <Slider id="creator-pitch" label={t('creator.pitch')} value={Math.round(a.voice.pitch * 100)} min={-100} max={100} step={5} onChange={(v) => apply({ ...a, voice: { ...a.voice, pitch: v / 100 } }, 'pitch')} />
              <Button
                id="voice-preview"
                label={t('creator.voice.preview')}
                disabledReason={preview?.available(a.voice.id) === true ? undefined : t('creator.voice.preview.soon')}
                onPress={() => {
                  void preview?.press(a.voice.id, a.voice.pitch);
                }}
              />
              {subtitle !== null ? (
                <p class="dv-voice-subtitle" role="status" data-testid="creator-voice-subtitle">
                  {subtitle}
                </p>
              ) : null}
            </>
          ) : null}
          {tab === 'style' ? cards('fightStyle') : null}
          {tab === 'name' ? (
            <div class="dv-form">
              <label class="dv-field">
                <span>{t('creator.name')}</span>
                <input
                  class="dv-input"
                  data-testid="creator-name"
                  data-ui-skip=""
                  translate={false}
                  data-fid="creator.name"
                  value={name}
                  maxLength={NAME_MAX * 2}
                  autocomplete="off"
                  aria-invalid={problem ? 'true' : undefined}
                  aria-describedby="creator-name-error"
                  onInput={(e) => {
                    const v = (e.currentTarget as HTMLInputElement).value;
                    setName(v);
                    const r = checkName(v);
                    setProblem(r.ok ? null : r.problem);
                  }}
                />
              </label>
              <label class="dv-field">
                <span>{t('creator.callsign')}</span>
                <input
                  class="dv-input"
                  data-testid="creator-callsign"
                  data-ui-skip=""
                  translate={false}
                  data-fid="creator.callsign"
                  value={callsign}
                  maxLength={NAME_MAX * 2}
                  autocomplete="off"
                  onInput={(e) => setCallsign((e.currentTarget as HTMLInputElement).value)}
                />
              </label>
              <p id="creator-name-error" class="dv-error" role="alert" data-testid="creator-name-error">
                {problem ? t(PROBLEM_KEY[problem], { max: NAME_MAX }) : ''}
              </p>
            </div>
          ) : null}
        </div>
        <div class="dv-actions dv-creator-footer">
          {props.onBack ? <Button id="creator-back" label={t('common.back')} onPress={props.onBack} /> : null}
          <Button id="creator-random" label={t('creator.randomize')} onPress={() => apply(randomize(a, mulberry32((seed.current += 7919))))} />
          <Button id="creator-reset" label={t('creator.reset')} onPress={() => apply({ ...defaultAvatar(), name: a.name, callsign: a.callsign })} />
          <Button id="creator-undo" label={t('creator.undo')} disabledReason={h.canUndo ? undefined : t('creator.undo.none')} onPress={() => { h.undo(); redraw((n) => n + 1); }} />
          <Button id="creator-redo" label={t('creator.redo')} disabledReason={h.canRedo ? undefined : t('creator.redo.none')} onPress={() => { h.redo(); redraw((n) => n + 1); }} />
          <Button id="creator-done" style="primary" label={t('creator.done')} onPress={finish} />
        </div>
      </section>
    </main>
  );
}

/** The `creator` page: Profile > Edit appearance. Reads `sys.avatar`, saves with `save.avatar`, goes back. */
export default function CreatorPage(props: PageProps) {
  const { shell, ctx } = useShell();
  const stage = ctx.props.stage?.() ?? null;
  const raw = ctx.vm<JsonObject>('sys.avatar');
  const initial = useMemo(() => normalizeAvatar(raw && Object.keys(raw).length > 0 ? raw : { ...defaultAvatar(), name: ctx.profile?.name ?? defaultAvatar().name }).avatar, []);
  const reduced = ctx.settings?.accessibility.reducedMotion === true;
  return (
    <CreatorEditor
      initial={initial}
      mode={props.params['mode'] === 'wardrobe' ? 'wardrobe' : 'edit'}
      stage={stage}
      reducedMotion={reduced}
      onBack={() => shell.back()}
      onDone={(a) => {
        ctx.sendUi({ t: 'save.avatar', avatar: a as unknown as JsonObject });
        shell.back();
      }}
    />
  );
}

