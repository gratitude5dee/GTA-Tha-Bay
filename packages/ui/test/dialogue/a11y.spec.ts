/**
 * M06a5 AC-7 (the unit side; the browser side is the `@ui-a11y` e2e case): the panel's markup and style follow the accessibility baseline of
 * 10-ui-hud-xr.md 2.13. Names on every control, the focus order speaker, line, choices, close, the safety card as the only focusable thing
 * while it is up, 44 px targets, tokens only, and no transition beyond 150 ms.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DialogueBubble } from '../../src/dialogue/DialogueBubble.tsx';
import { ReportButton } from '../../src/kit/report.tsx';
import { setDialogueCapabilities } from '../../src/dialogue/capabilities.ts';
import { FakeRuntime, collect, happyTurn, makeSession, textOf, walk } from './helpers.ts';

const OPAQUE = [ReportButton];
const actions = { choose() {}, send() {}, showFull() {}, close() {}, dismissLikeness() {}, toggleResources() {}, report() {} };
const css = readFileSync(path.resolve(import.meta.dirname, '../../src/dialogue/dialogue.css'), 'utf8');
const tokens = readFileSync(path.resolve(import.meta.dirname, '../../src/kit/tokens.css'), 'utf8');

async function opened() {
  const made = makeSession({}, new FakeRuntime(() => happyTurn('Good day. Please confirm the lot is clear.')));
  made.session.open('npc_test');
  await made.session.choose('greet');
  return made;
}

/** Test ids of the elements in document order. */
function order(tree: unknown): string[] {
  const ids: string[] = [];
  walk(tree, (v) => {
    const id = v.props?.['data-testid'];
    if (typeof id === 'string') ids.push(id);
  }, OPAQUE);
  return ids;
}

const isControl = (type: unknown): boolean => type === 'button' || type === 'input' || type === ReportButton;

describe('panel markup', () => {
  it('names the dialog, labels the line by the speaker, and gives every control a name', async () => {
    setDialogueCapabilities({ reports: true });
    const { session } = await opened();
    const tree = DialogueBubble({ view: session.state(), actions });
    const dialog = collect(tree, (v) => v.props?.['data-testid'] === 'dialogue-panel', OPAQUE)[0];
    expect(dialog?.props['role']).toBe('dialog');
    expect(String(dialog?.props['aria-label'])).toContain('Tester Nine');
    for (const c of collect(tree, (v) => v.type === 'button', OPAQUE)) expect(textOf(c, OPAQUE).trim(), String(c.props['data-testid'])).not.toBe('');
    const input = collect(tree, (v) => v.type === 'input', OPAQUE)[0];
    expect(input?.props['id']).toBe('dv-dlg-text');
    expect(collect(tree, (v) => v.type === 'label' && v.props['for'] === 'dv-dlg-text', OPAQUE)).toHaveLength(1);
    expect(input?.props['maxLength']).toBe(280);
    setDialogueCapabilities({ reports: false });
  });

  it('focus order is speaker, line, choices, close', async () => {
    const { session } = await opened();
    const ids = order(DialogueBubble({ view: session.state(), actions }));
    const at = (id: string): number => ids.indexOf(id);
    expect(at('dialogue-speaker')).toBeGreaterThanOrEqual(0);
    expect(at('dialogue-speaker')).toBeLessThan(at('dialogue-line'));
    expect(at('dialogue-line')).toBeLessThan(at('dialogue-intent-greet'));
    expect(at('dialogue-intent-greet')).toBeLessThan(at('dialogue-intent-farewell'));
    expect(at('dialogue-intent-farewell')).toBeLessThan(at('dialogue-input'));
    expect(at('dialogue-input')).toBeLessThan(at('dialogue-close'));
    expect(at('dialogue-close')).toBe(ids.length - 1);
    const tree = DialogueBubble({ view: session.state(), actions });
    // no positive tabindex anywhere: the order is the document order
    expect(collect(tree, (v) => typeof v.props?.['tabIndex'] === 'number' && (v.props['tabIndex'] as number) > 0, OPAQUE)).toHaveLength(0);
  });

  it('the AI badge shows with the panel, with an icon and text, and on an ink fallback line', async () => {
    const { session } = makeSession();
    session.open('npc_test');
    const tree = DialogueBubble({ view: session.state(), actions });
    const badge = collect(tree, (v) => v.props?.['data-testid'] === 'dialogue-ai-badge', OPAQUE)[0];
    expect(badge).toBeDefined();
    expect(textOf(badge, OPAQUE)).toContain('AI character');
    expect(collect(badge, (v) => v.props?.['aria-hidden'] === 'true', OPAQUE).length).toBeGreaterThan(0); // the icon is decorative, the text carries the meaning
  });

  it('while the safety card is up the rest of the panel is inert, and the card holds Close and Resources only', async () => {
    const { session } = await opened();
    await session.sendText('i want to end my life');
    const tree = DialogueBubble({ view: session.state(), actions });
    const body = collect(tree, (v) => v.type === 'div' && String(v.props['class']).includes('dv-dlg-body'), OPAQUE)[0];
    expect(body?.props['inert']).toBe(true);
    const card = collect(tree, (v) => v.props?.['data-testid'] === 'dialogue-safety', OPAQUE)[0];
    expect(textOf(card, OPAQUE)).toContain('988');
    const controls = collect(card, (v) => isControl(v.type), OPAQUE).map((v) => v.props['data-testid']);
    expect(controls).toEqual(['dialogue-safety-close', 'dialogue-safety-resources-btn']);
    // every other control sits inside the inert body
    const outside = collect(tree, (v) => isControl(v.type), OPAQUE).filter((v) => !controls.includes(v.props['data-testid']));
    const inside = new Set(collect(body, (v) => isControl(v.type), OPAQUE).map((v) => v.props['data-testid']));
    expect(outside.length).toBeGreaterThan(5);
    for (const c of outside) expect(inside.has(c.props['data-testid']), String(c.props['data-testid'])).toBe(true);
  });

  it('the safety card without the trigger is absent', async () => {
    const { session } = await opened();
    await session.sendText('what a nice day');
    const tree = DialogueBubble({ view: session.state(), actions });
    expect(collect(tree, (v) => v.props?.['data-testid'] === 'dialogue-safety', OPAQUE)).toHaveLength(0);
  });
});

describe('panel style (AC-7)', () => {
  it('uses design tokens only: no hex or rgb colour literals', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\brgba?\(/i);
    expect(css).not.toMatch(/\bhsla?\(/i);
    for (const m of css.matchAll(/var\((--[a-z0-9-]+)/g)) {
      const name = m[1] as string;
      expect(name.startsWith('--dv-'), name).toBe(true);
      if (!['--dv-hud-scale'].includes(name)) expect(tokens, `token ${name}`).toContain(`${name}:`);
    }
  });

  it('every button and the text field are at least 44 px tall and wide (2.75 rem)', () => {
    const btn = /\.dv-dlg-btn\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(btn).toContain('min-block-size: 2.75rem');
    expect(btn).toContain('min-inline-size: 2.75rem');
    const input = /\.dv-dlg-input\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(input).toContain('min-block-size: 2.75rem');
  });

  it('no transition is longer than 150 ms, and reduced motion removes them', () => {
    const fast = Number(/--dv-motion-fast:\s*(\d+)ms/.exec(tokens)?.[1]);
    expect(fast).toBeLessThanOrEqual(150);
    const used = [...css.matchAll(/transition:[^;]*;/g)].map((m) => m[0]);
    expect(used.length).toBeGreaterThan(0);
    for (const t of used) {
      for (const d of t.matchAll(/(\d+)ms/g)) expect(Number(d[1])).toBeLessThanOrEqual(150);
      for (const d of t.matchAll(/var\(--dv-motion-(\w+)\)/g)) expect(d[1]).toBe('fast');
    }
    expect(css).toMatch(/\[data-reduced-motion='true'\][^{]*\{\s*transition:\s*none/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });

  it('sizes are rem, so the UI scale scales the panel; it takes the bottom of the screen on phones and a side on wide screens', () => {
    expect(css).not.toMatch(/\d\s*px\b(?!\s*solid)/); // borders are 1px; no pixel font or box sizes
    expect(css).toMatch(/inset-block-end:\s*0/);
    expect(css).toMatch(/@media \(min-width: 64rem\)/);
    expect(css).toContain("html[data-dv-dialogue='open'] .dv-minimap");
  });
});
