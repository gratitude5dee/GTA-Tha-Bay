import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { JsonValue } from '@dv/shared';
import { t } from '../i18n/index.ts';
import { Button, Choice, ListBox, Progress, Slider, Tabs, Toggle } from '../kit/widgets.tsx';
import { activeTab, type ScreenCtx, type ScreenDef, type SettingRef, type Widget } from './types.ts';

/**
 * `DomScreen`: renders a `ScreenDef` as semantic HTML (`<button>`, `role=switch`, `<input type=range>`, `role=tablist`). It is a
 * pure function of the screen and the context (no hooks), so the parity test can expand it and compare its focus order with
 * `CanvasScreen`'s. Every focusable element carries `data-fid`.
 */
const same = (a: JsonValue | undefined, b: JsonValue): boolean => JSON.stringify(a) === JSON.stringify(b);

function widget(w: Widget, ctx: ScreenCtx, key: string): ComponentChildren {
  switch (w.k) {
    case 'heading': {
      const Tag = (w.level === 1 ? 'h1' : w.level === 2 ? 'h2' : 'h3') as 'h1';
      return <Tag key={key}>{t(w.text)}</Tag>;
    }
    case 'text':
      return (
        <p key={key} class={w.tone === 'muted' ? 'dv-muted' : w.tone === 'warning' ? 'dv-warn' : undefined}>
          {t(w.text, w.params as Record<string, string | number> | undefined)}
        </p>
      );
    case 'button':
      return (
        <Button
          key={key}
          id={w.id}
          label={t(w.label)}
          style={w.style}
          disabledReason={w.disabled ? t(w.disabled) : undefined}
          icon={w.icon}
          onPress={() => ctx.run(w.onPress)}
        />
      );
    case 'toggle':
      return (
        <Toggle
          key={key}
          id={w.id}
          label={t(w.label)}
          hint={w.hint ? t(w.hint) : undefined}
          on={ctx.get(w.bind) === true}
          scope={w.bind.scope}
          disabledReason={w.disabled ? t(w.disabled) : undefined}
          onChange={(on) => ctx.set(w.bind, on)}
        />
      );
    case 'slider': {
      const raw = ctx.get(w.bind);
      const value = typeof raw === 'number' ? raw : w.min;
      return (
        <Slider key={key} id={w.id} label={t(w.label)} value={value} min={w.min} max={w.max} step={w.step} unit={w.unit} scope={w.bind.scope} onChange={(v) => ctx.set(w.bind, v)} />
      );
    }
    case 'choice': {
      const cur = ctx.get(w.bind);
      return (
        <Choice
          key={key}
          id={w.id}
          label={t(w.label)}
          scope={w.bind.scope}
          options={w.options.map((o, i) => ({ key: String(i), label: t(o.label), on: cur !== undefined && same(cur, o.value) }))}
          onPick={(i) => {
            const o = w.options[i];
            if (o) ctx.set(w.bind, o.value);
          }}
        />
      );
    }
    case 'list':
      return <ListBox key={key} id={w.id} rows={w.rows} empty={t(w.empty)} onPress={(rowId) => ctx.run(w.onPress, rowId)} />;
    case 'tabs': {
      const active = activeTab(w, ctx);
      const current = w.tabs.find((x) => x.id === active);
      return (
        <div key={key} class="dv-tabset">
          <Tabs id={w.id} tabs={w.tabs.map((x) => ({ id: x.id, label: t(x.label) }))} active={active} onSelect={(id) => ctx.setTab(w.id, id)} />
          <div role="tabpanel" aria-labelledby={`tab-${w.id}-${active}`} class="dv-tabpanel">
            {(current?.children ?? []).map((c, i) => widget(c, ctx, `${key}.${active}.${i}`))}
          </div>
        </div>
      );
    }
    case 'progress':
      return <Progress key={key} value={w.value} label={w.label ? t(w.label) : undefined} />;
    case 'image':
      return <div key={key} class="dv-image" role="img" aria-label={t(w.alt)} data-asset={w.asset} />;
    case 'table':
      return (
        <table key={key} class="dv-table">
          <thead>
            <tr>
              {w.columns.map((c) => (
                <th key={c} scope="col">{t(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {w.rows.map((r, i) => (
              <tr key={i}>
                {r.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'spacer':
      return <div key={key} class={`dv-spacer dv-spacer-${w.size}`} aria-hidden="true" />;
  }
}

export function DomScreen(props: { screen: ScreenDef; ctx: ScreenCtx }) {
  return (
    <section class="dv-screen-body" data-screen={props.screen.id} aria-label={t(props.screen.title)}>
      {props.screen.children.map((w, i) => widget(w, props.ctx, String(i)))}
    </section>
  );
}

export type { SettingRef };

/** The stateful wrapper pages use: it owns the active tab of each `tabs` widget and hands the rest of the context through. */
export function ScreenHost(props: { screen: ScreenDef; get(ref: SettingRef): JsonValue | undefined; set(ref: SettingRef, v: JsonValue): void; run(action: Parameters<ScreenCtx['run']>[0], rowId?: string): void; initialTab?: Record<string, string> }) {
  const [tabs, setTabs] = useState<Record<string, string>>(props.initialTab ?? {});
  const ctx: ScreenCtx = {
    get: props.get,
    set: props.set,
    run: props.run,
    tab: (id) => tabs[id],
    setTab: (id, tab) => setTabs((cur) => ({ ...cur, [id]: tab })),
  };
  return <DomScreen screen={props.screen} ctx={ctx} />;
}
