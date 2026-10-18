import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND, DISPLAY_NAME } from '../../../config/brand.ts';
import { catalogs, missingKeys, t, type LocKey } from '../src/i18n.ts';
import { LEGAL_DOCS, routeFor } from '../src/index.tsx';
import { readTokens, renderTokensCss, TOKENS_CSS } from '../scripts/build-tokens.ts';

const repo = path.resolve(import.meta.dirname, '../../..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (name === 'node_modules' || name === 'dist') continue;
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

describe('i18n catalog', () => {
  it('every static t() key used in packages/ui and apps/web exists in en.json', () => {
    const files = [...sourceFiles(path.join(repo, 'packages/ui/src')), ...sourceFiles(path.join(repo, 'apps/web/src'))];
    const used = new Set<string>();
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bt\(\s*['"]([\w.-]+)['"]/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(5);
    const missing = [...used].filter((k) => !(k in catalogs.en));
    expect(missing).toEqual([]);
  });

  it('has a title for every legal document', () => {
    for (const doc of LEGAL_DOCS) expect(`legal.doc.${doc}` in catalogs.en).toBe(true);
  });

  it('no catalog contains the display-name literal', () => {
    const banned = [DISPLAY_NAME, BRAND.shortName, 'dee-verse', 'tha bay'].map((s) => s.toLowerCase());
    for (const [lang, catalog] of Object.entries(catalogs)) {
      for (const [key, value] of Object.entries(catalog)) {
        const lower = value.toLowerCase();
        for (const b of banned) expect(lower.includes(b), `${lang}:${key} contains "${b}"`).toBe(false);
      }
    }
  });

  it('the display name arrives through the {brand} placeholder', () => {
    expect(catalogs.en['title.name']).toBe('{brand}');
    expect(t('title.name')).toBe(DISPLAY_NAME);
    expect(t('boot.loading')).toBe(`Loading ${DISPLAY_NAME}`);
  });

  it('reports missing keys and returns the key', () => {
    expect(t('does.not.exist' as LocKey)).toBe('does.not.exist');
    expect(missingKeys()).toContain('does.not.exist');
  });
});

describe('shell routes', () => {
  it('maps paths to pages', () => {
    expect(routeFor('/')).toEqual({ page: 'title' });
    expect(routeFor('/menu/credits')).toEqual({ page: 'credits' });
    expect(routeFor('/menu/credits/')).toEqual({ page: 'credits' });
    expect(routeFor('/legal/terms')).toEqual({ page: 'legal', doc: 'terms' });
    expect(routeFor('/anything/else')).toEqual({ page: 'title' });
  });
});

describe('design tokens', () => {
  it('tokens.css is up to date with config/ui/tokens.json', () => {
    expect(readFileSync(TOKENS_CSS, 'utf8')).toBe(renderTokensCss(readTokens()));
  });
});
