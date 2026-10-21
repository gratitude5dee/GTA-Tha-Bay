/**
 * Continue and Load, Profile, Saves, and New Game (10-ui-pages.md sections 2.5 and 2.7). Profile rows, slots, export and import go
 * through the page's `SavesPort` (BD-M04b1-02); the sim only selects the profile it plays (`save.profile select`).
 */
import { useState } from 'preact/hooks';
import { SAVE_LIMITS, type LastSaveStatus, type ProfileId, type ProfileMeta, type SaveErrorCode, type SaveReason, type SaveResult, type SlotId } from '@dv/shared';
import { formatDate, formatNumber, getLang, lk, plural, t } from '../i18n/index.ts';
import { Button, ListBox, Progress, useAsync, Banner } from '../kit/widgets.tsx';
import { Link, useShell } from '../shell/context.tsx';
import type { PageProps, SavesPort, ShellApi, ShellContext } from '../shell/types.ts';

// ---- pure model (unit-tested in saves-ui.spec.ts)

export type SaveErrorAction =
  | { kind: 'nav'; page: 'settings'; params: Record<string, string>; label: string }
  | { kind: 'reload'; label: string }
  | { kind: 'diagnostics'; label: string }
  | { kind: 'none' };

export interface SaveErrorUi { message: string; action: SaveErrorAction }

/** Every `SaveErrorCode` has a message key and an action (10-ui-pages.md section 2.7). */
export const SAVE_ERROR_UI: Record<SaveErrorCode, { message: string; action: SaveErrorAction }> = {
  QUOTA: { message: lk('saves.error.QUOTA'), action: { kind: 'nav', page: 'settings', params: { cat: 'install' }, label: lk('saves.action.freeUp') } },
  TOO_LARGE: { message: lk('saves.error.TOO_LARGE'), action: { kind: 'none' } },
  CHECKSUM: { message: lk('saves.error.CHECKSUM'), action: { kind: 'none' } },
  CONFLICT: { message: lk('saves.error.CONFLICT'), action: { kind: 'reload', label: lk('saves.action.reload') } },
  NEWER_SCHEMA: { message: lk('saves.error.NEWER_SCHEMA'), action: { kind: 'reload', label: lk('saves.action.update') } },
  IDB_UNAVAILABLE: { message: lk('saves.error.IDB_UNAVAILABLE'), action: { kind: 'none' } },
  NOT_ALLOWED: { message: lk('saves.error.NOT_ALLOWED'), action: { kind: 'diagnostics', label: lk('saves.action.diagnostics') } },
  INVALID: { message: lk('saves.error.INVALID'), action: { kind: 'none' } },
  NAME_TAKEN: { message: lk('saves.error.NAME_TAKEN'), action: { kind: 'none' } },
  PROFILE_LIMIT: { message: lk('saves.error.PROFILE_LIMIT'), action: { kind: 'none' } },
};

export const saveErrorUi = (code: SaveErrorCode): SaveErrorUi => SAVE_ERROR_UI[code];

const REASON_KEY: Record<SaveReason, string> = {
  missionPass: lk('save.reason.missionPass'),
  safehouse: lk('save.reason.safehouse'),
  modeExit: lk('save.reason.modeExit'),
  interval: lk('save.reason.interval'),
  hidden: lk('save.reason.hidden'),
  manual: lk('save.reason.manual'),
  settings: lk('save.reason.settings'),
  unlock: lk('save.reason.unlock'),
  import: lk('save.reason.import'),
  migration: lk('save.reason.migration'),
  checkpoint: lk('save.reason.checkpoint'),
};

/** "2 min ago", "3 h ago", or the date for anything older than a day. */
export function relativeTime(at: number, now: number, lang: string = getLang()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  try {
    const f = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
    if (s < 60) return f.format(0, 'second');
    if (s < 3600) return f.format(-Math.round(s / 60), 'minute');
    if (s < 86400) return f.format(-Math.round(s / 3600), 'hour');
  } catch {
    // fall through to the date
  }
  return formatDate(at, { dateStyle: 'medium' }, lang);
}

export interface LastSaveLine { text: string; ok: boolean; error?: SaveErrorCode }

/** "Saved 2 min ago - Auto-save", or the failure message when the last save did not succeed. */
export function lastSaveLine(s: LastSaveStatus | null, now: number): LastSaveLine {
  if (!s) return { text: t('save.none'), ok: true };
  if (!s.ok && s.error) return { text: t(SAVE_ERROR_UI[s.error].message), ok: false, error: s.error };
  return { text: t('save.line', { when: relativeTime(s.at, now), reason: t(REASON_KEY[s.reason]) }), ok: true };
}

export function playtimeText(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? t('time.hm', { h, m }) : plural('time.minutes', m);
}

export const SLOT_KEY: Record<string, string> = {
  'story:auto': lk('slot.story.auto'),
  'story:1': lk('slot.story.1'),
  'story:2': lk('slot.story.2'),
  'story:3': lk('slot.story.3'),
  sandbox: lk('slot.sandbox'),
  core: lk('slot.core'),
  settings: lk('slot.settings'),
};

/** The profile Continue resumes: the one saved most recently. */
export function mostRecent(list: readonly ProfileMeta[]): ProfileMeta | null {
  return [...list].sort((a, b) => (b.lastSave?.at ?? b.updatedAt) - (a.lastSave?.at ?? a.updatedAt))[0] ?? null;
}

export interface NewGameDeps {
  saves: Pick<SavesPort, 'create' | 'rename'>;
  /** The open profile, when there is one. */
  active: { id: string; name: string; hasStory: boolean } | null;
  prefersReducedMotion: boolean;
  send(cmd: { t: 'save.profile'; op: 'select'; id: string } | { t: 'save.settings'; data: Record<string, unknown> }): boolean;
  /** Resolves true when the sim reports the profile as open. */
  selected(id: string): Promise<boolean>;
}

export type NewGameResult = { ok: true; id: string; reused: boolean } | { ok: false; error: SaveErrorCode };

const isMeta = (x: ProfileMeta | SaveResult): x is ProfileMeta => 'id' in x;

/**
 * New Game (DN-S10-03): a new save profile, or the open one when it has no story data yet. The profile is selected in the sim, and a
 * profile made under `prefers-reduced-motion: reduce` starts with `reducedMotion: true` (and the XR mirror, in the same write).
 */
export async function runNewGame(d: NewGameDeps, name: string): Promise<NewGameResult> {
  let id: string;
  let reused = false;
  if (d.active && !d.active.hasStory) {
    reused = true;
    id = d.active.id;
    if (name.trim() !== d.active.name) {
      const r = await d.saves.rename(id as ProfileId, name);
      if (!r.ok) return { ok: false, error: r.error };
    }
  } else {
    const made = await d.saves.create(name);
    if (!isMeta(made)) return made.ok ? { ok: false, error: 'INVALID' } : { ok: false, error: made.error };
    id = made.id;
  }
  d.send({ t: 'save.profile', op: 'select', id });
  const ok = await d.selected(id);
  if (!ok) return { ok: false, error: 'IDB_UNAVAILABLE' };
  if (d.prefersReducedMotion) d.send({ t: 'save.settings', data: { accessibility: { reducedMotion: true }, xr: { reduceMotion: true } } });
  return { ok: true, id, reused };
}

// ---- shared bits

function useErrorText(): { error: SaveErrorUi | null; show(code: SaveErrorCode | null): void } {
  const [code, setCode] = useState<SaveErrorCode | null>(null);
  return { error: code ? saveErrorUi(code) : null, show: setCode };
}

function ErrorBox(props: { error: SaveErrorUi | null; shell: ShellApi; ctx: ShellContext }) {
  const e = props.error;
  if (!e) return null;
  const a = e.action;
  return (
    <div class="dv-error" role="alert" data-testid="save-error">
      <span>{t(e.message)}</span>
      {a.kind === 'nav' ? (
        <Button id="error-action" label={t(a.label)} onPress={() => props.shell.navigate(a.page, a.params)} />
      ) : a.kind === 'reload' ? (
        <Button id="error-action" label={t(a.label)} onPress={() => props.ctx.props.hooks.reload()} />
      ) : null}
    </div>
  );
}

const blocked = (ctx: ShellContext): string | undefined => (ctx.otherTab ? t('banner.otherTab.short') : undefined);

// ---- Continue and Load

export function LoadPage(_props: PageProps) {
  const { shell, ctx } = useShell();
  const saves = ctx.saves;
  const profiles = useAsync(() => (saves ? saves.list() : Promise.resolve([])), [saves]);
  const [pick, setPick] = useState<string | null>(null);
  const list = profiles.data ?? [];
  const current = (pick ? list.find((p) => p.id === pick) : null) ?? mostRecent(list);
  const slots = useAsync(() => (saves && current ? saves.slots(current.id) : Promise.resolve([])), [saves, current?.id]);
  const newer = current?.lastSave?.error === 'NEWER_SCHEMA';
  const rows = ['story:auto', 'story:1', 'story:2', 'story:3'].map((slot) => {
    const info = (slots.data ?? []).find((s) => s.slot === slot);
    return {
      id: slot,
      text: t(SLOT_KEY[slot] ?? slot),
      detail: info ? t('slot.detail', { when: formatDate(info.savedAt), size: formatNumber(Math.max(1, Math.round(info.bytes / 1024))) }) : t('slot.empty'),
      disabled: !info || newer || ctx.otherTab,
      ...(newer ? { hint: t('saves.error.NEWER_SCHEMA') } : {}),
    };
  });
  return (
    <main class="dv-page" data-testid="load">
      <h1>{t('nav.continue')}</h1>
      {current ? (
        <p data-testid="load-profile">{t('load.profile', { name: current.name })}</p>
      ) : (
        <p class="dv-muted" data-testid="load-empty">{t('load.empty')}</p>
      )}
      {newer ? (
        <Banner id="newer" tone="warning" icon="!" text={t('saves.error.NEWER_SCHEMA')} action={{ label: t('saves.action.update'), onPress: () => ctx.props.hooks.reload() }} />
      ) : null}
      {current ? (
        <ListBox
          id="slots"
          rows={rows}
          empty={t('load.empty')}
          onPress={(slot) => {
            ctx.sendUi({ t: 'save.profile', op: 'select', id: current.id });
            ctx.startMode('story', slot as SlotId);
          }}
        />
      ) : null}
      {list.length > 1 ? (
        <>
          <h2>{t('load.profiles')}</h2>
          <ListBox id="profiles" rows={list.map((p) => ({ id: p.id, text: p.name, detail: playtimeText(p.playtimeSec) }))} empty="" onPress={(id) => setPick(id)} />
        </>
      ) : null}
      <div class="dv-actions">
        <Button id="back" label={t('common.back')} onPress={() => shell.back()} />
      </div>
    </main>
  );
}

// ---- New Game

type NewStep = 'name' | 'creator';

export function NewGamePage(_props: PageProps) {
  const { shell, ctx } = useShell();
  const [name, setName] = useState('');
  const [step, setStep] = useState<NewStep>('name');
  const [busy, setBusy] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const err = useErrorText();
  const saves = ctx.saves;
  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    if (!saves || busy) return;
    setBusy(true);
    err.show(null);
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const r = await runNewGame(
      {
        saves,
        active: ctx.profile,
        prefersReducedMotion: reduced,
        send: (c) => ctx.sendUi(c as never),
        selected: (id) => waitForProfile(ctx, id),
      },
      name.normalize('NFC').trim(),
    );
    setBusy(false);
    if (!r.ok) {
      err.show(r.error);
      return;
    }
    setProfileId(r.id);
    setStep('creator');
  };
  if (step === 'creator') {
    return (
      <main class="dv-page" data-testid="new-creator">
        <h1>{t('new.creator.title')}</h1>
        <p class="dv-muted">{t('new.creator.placeholder')}</p>
        <div class="dv-actions">
          <Button id="new-start" style="primary" label={t('new.start')} disabledReason={blocked(ctx)} onPress={() => ctx.startMode('story')} />
        </div>
        <span class="dv-sr" data-testid="new-profile-id">{profileId}</span>
      </main>
    );
  }
  return (
    <main class="dv-page" data-testid="new">
      <h1>{t('nav.new')}</h1>
      <form class="dv-form" onSubmit={(e) => void submit(e)}>
        <label class="dv-field">
          <span>{t('new.name')}</span>
          <input
            class="dv-input"
            data-testid="new-name"
            data-fid="new.name"
            maxLength={SAVE_LIMITS.nameMax}
            autocomplete="off"
            value={name}
            onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <ErrorBox error={err.error} shell={shell} ctx={ctx} />
        <div class="dv-actions">
          <Button id="new-back" label={t('common.back')} onPress={() => shell.back()} />
          <button type="submit" class="dv-btn dv-btn-primary" data-testid="new-continue" data-fid="new.continue" aria-disabled={busy || name.trim() === '' || ctx.otherTab ? 'true' : undefined}>
            {t('common.continue')}
          </button>
        </div>
      </form>
    </main>
  );
}

/** Resolves true when the sim's `sys.profile` names `id` (the select command loads the slices asynchronously). */
export function waitForProfile(ctx: ShellContext, id: string, timeoutMs = 10_000): Promise<boolean> {
  const engine = ctx.engine;
  if (!engine) return Promise.resolve(false);
  const is = (v: unknown): boolean => typeof v === 'object' && v !== null && (v as { id?: string }).id === id;
  if (is(engine.vm.get('sys.profile'))) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      off();
      resolve(false);
    }, timeoutMs);
    const off = engine.vm.subscribe('sys.profile', (v) => {
      if (is(v)) {
        clearTimeout(timer);
        off();
        resolve(true);
      }
    });
  });
}

// ---- Profile

export function ProfilePage(_props: PageProps) {
  const { shell, ctx } = useShell();
  const profiles = useAsync(() => (ctx.saves ? ctx.saves.list() : Promise.resolve([])), [ctx.saves]);
  const list = profiles.data ?? [];
  return (
    <main class="dv-page" data-testid="profile">
      <h1>{t('nav.profile')}</h1>
      <section class="dv-card">
        <h2>{t('profile.character')}</h2>
        <p class="dv-muted">{ctx.profile ? t('profile.character.name', { name: ctx.profile.name }) : t('profile.character.none')}</p>
        <Button id="edit-appearance" label={t('profile.edit')} disabledReason={t('common.comingSoon')} onPress={() => undefined} />
      </section>
      <section class="dv-card">
        <h2>{t('profile.playthroughs')}</h2>
        <ListBox
          id="playthroughs"
          rows={list.map((p) => ({ id: p.id, text: p.name, detail: playtimeText(p.playtimeSec), ...(ctx.profile?.id === p.id ? { badge: t('profile.active') } : {}) }))}
          empty={t('load.empty')}
          onPress={(id) => ctx.sendUi({ t: 'save.profile', op: 'select', id })}
        />
      </section>
      <section class="dv-card" data-testid="profile-account">
        <h2>{t('profile.account')}</h2>
        <p>{t(`identity.${ctx.gate.identity.tier}`)}</p>
        <a class="dv-link" href="/account/" onClick={(e) => { e.preventDefault(); location.assign('/account/'); }}>{t('title.account')}</a>
      </section>
      <div class="dv-actions">
        <Link to="saves" testId="to-saves">{t('saves.title')}</Link>
        <Button id="back" label={t('common.back')} onPress={() => shell.back()} />
      </div>
    </main>
  );
}

// ---- Saves

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function ProfileCard(props: { p: ProfileMeta; ctx: ShellContext; shell: ShellApi; saves: SavesPort; onChanged(): void; onError(code: SaveErrorCode | null): void; others: ProfileMeta[] }) {
  const { p, ctx, shell, saves } = props;
  const slots = useAsync(() => saves.slots(p.id), [p.id]);
  const usage = useAsync(() => saves.usage(p.id), [p.id]);
  const off = blocked(ctx);
  const line = lastSaveLine(p.lastSave, Date.now());
  const result = (r: SaveResult): void => {
    props.onError(r.ok ? null : r.error);
    props.onChanged();
  };
  const active = ctx.profile?.id === p.id;
  const exportIt = async (): Promise<void> => {
    try {
      download(await saves.exportProfile(p.id), `${p.name.replace(/[^\w.-]+/g, '_')}.dvsave`);
    } catch {
      props.onError('INVALID');
    }
  };
  const del = async (): Promise<void> => {
    const ok = await shell.confirm({ titleKey: lk('saves.delete.title'), bodyKey: lk('saves.delete.body'), params: { name: p.name }, confirmKey: lk('saves.delete'), danger: true, typeToConfirm: p.name });
    if (ok) result(await saves.remove(p.id));
  };
  const rename = async (): Promise<void> => {
    const next = await shell.modal<string>({
      titleKey: lk('saves.rename'),
      body: (close) => <RenameBody initial={p.name} onDone={close} />,
    });
    if (next !== null && next !== p.name) result(await saves.rename(p.id, next));
  };
  const replaceInto = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const ok = await shell.confirm({ titleKey: lk('saves.replace.title'), bodyKey: lk('saves.replace.body'), params: { name: p.name }, confirmKey: lk('saves.replace'), danger: true });
    if (ok) result(await saves.importProfile(file, 'replace', p.id));
  };
  const used = usage.data ?? 0;
  return (
    <section class="dv-card" data-testid={`profile-card-${p.name}`} data-profile-id={p.id}>
      <h2>
        {p.name} {active ? <span class="dv-badge" data-testid="active-badge">{t('profile.active')}</span> : null}
      </h2>
      <p class="dv-muted">
        {t('saves.meta', { created: formatDate(p.createdAt, { dateStyle: 'medium' }), playtime: playtimeText(p.playtimeSec), device: p.deviceId.slice(-4) })}
      </p>
      <p class={line.ok ? '' : 'dv-warn'} data-testid="save-line">
        {line.ok ? '' : '! '}
        {line.text}
      </p>
      <ul class="dv-slotlist" data-testid="slot-sizes">
        {(slots.data ?? []).map((s) => (
          <li key={s.slot}>
            {t(SLOT_KEY[s.slot] ?? s.slot)} - {formatNumber(Math.max(1, Math.round(s.bytes / 1024)))} KiB
          </li>
        ))}
      </ul>
      <Progress value={used / SAVE_LIMITS.profileMaxBytes} label={t('saves.usage', { used: formatNumber(Math.round(used / 1024)), max: formatNumber(SAVE_LIMITS.profileMaxBytes / 1024 / 1024) })} />
      <div class="dv-actions dv-wrap">
        <Button id={`switch-${p.id}`} label={t('saves.switch')} disabledReason={off ?? (active ? t('profile.active') : undefined)} onPress={() => ctx.sendUi({ t: 'save.profile', op: 'select', id: p.id })} testId={`switch-${p.name}`} />
        <Button id={`rename-${p.id}`} label={t('saves.rename')} disabledReason={off} onPress={() => void rename()} testId={`rename-${p.name}`} />
        <Button id={`export-${p.id}`} label={t('saves.export')} onPress={() => void exportIt()} testId={`export-${p.name}`} />
        <label class="dv-btn dv-btn-secondary dv-file" data-fid={`replace-${p.id}`} tabIndex={0}>
          {t('saves.replace')}
          <input type="file" class="dv-sr" accept=".dvsave,application/json" aria-disabled={off ? 'true' : undefined} data-testid={`replace-${p.name}`} onChange={(e) => void replaceInto((e.currentTarget as HTMLInputElement).files?.[0])} />
        </label>
        {p.importedFrom || saves.canUndo(p.id) ? <Button id={`undo-${p.id}`} label={t('saves.undo')} disabledReason={off} onPress={() => void saves.undoImport(p.id).then(result)} testId={`undo-${p.name}`} /> : null}
        <Button id={`delete-${p.id}`} style="danger" label={t('saves.delete')} disabledReason={off ?? (active ? t('saves.delete.active') : undefined)} onPress={() => void del()} testId={`delete-${p.name}`} />
      </div>
    </section>
  );
}

function RenameBody(props: { initial: string; onDone(v: string | null): void }) {
  const [v, setV] = useState(props.initial);
  return (
    <form
      class="dv-dialog-body"
      onSubmit={(e) => {
        e.preventDefault();
        props.onDone(v.normalize('NFC').trim());
      }}
    >
      <input class="dv-input" data-testid="rename-input" maxLength={SAVE_LIMITS.nameMax} value={v} onInput={(e) => setV((e.currentTarget as HTMLInputElement).value)} />
      <div class="dv-actions">
        <button type="button" class="dv-btn dv-btn-secondary" onClick={() => props.onDone(null)}>{t('common.cancel')}</button>
        <button type="submit" class="dv-btn dv-btn-primary" data-testid="rename-ok">{t('common.ok')}</button>
      </div>
    </form>
  );
}

export function SavesPage(_props: PageProps) {
  const { shell, ctx } = useShell();
  const saves = ctx.saves;
  const profiles = useAsync(() => (saves ? saves.list() : Promise.resolve([])), [saves]);
  const err = useErrorText();
  const list = profiles.data ?? [];
  const importNew = async (file: File | undefined): Promise<void> => {
    if (!file || !saves) return;
    const r = await saves.importProfile(file, 'asNew');
    err.show(r.ok ? null : r.error);
    profiles.reload();
  };
  const off = blocked(ctx);
  return (
    <main class="dv-page" data-testid="saves">
      <h1>{t('saves.title')}</h1>
      {saves && !saves.persistent ? <Banner id="nosave" tone="warning" icon="!" text={t('banner.noSave')} /> : null}
      <ErrorBox error={err.error} shell={shell} ctx={ctx} />
      <div class="dv-actions dv-wrap">
        <label class="dv-btn dv-btn-secondary dv-file" data-fid="import-new" tabIndex={0}>
          {t('saves.import')}
          <input type="file" class="dv-sr" accept=".dvsave,application/json" aria-disabled={off ? 'true' : undefined} data-testid="import-new" onChange={(e) => void importNew((e.currentTarget as HTMLInputElement).files?.[0])} />
        </label>
        <Button id="back" label={t('common.back')} onPress={() => shell.back()} />
      </div>
      {saves
        ? list.map((p) => (
            <ProfileCard
              key={p.id}
              p={p}
              ctx={ctx}
              shell={shell}
              saves={saves}
              others={list.filter((x) => x.id !== p.id)}
              onChanged={() => profiles.reload()}
              onError={(c) => err.show(c)}
            />
          ))
        : null}
      {list.length === 0 ? <p class="dv-muted">{t('load.empty')}</p> : null}
    </main>
  );
}
