import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import { REPORT_REASONS, ReportButton, UgcSurface, reportOutcome } from '../src/kit/report.tsx';

const src = path.resolve(import.meta.dirname, '../src');

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const f = path.join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(f);
  }
  return out;
}

/** True when the vnode tree holds an element of `type` (function components other than the wrapper are not expanded). */
function holds(node: unknown, type: unknown): boolean {
  if (node === null || node === undefined || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((n) => holds(n, type));
  const v = node as VNode<{ children?: unknown }>;
  if (v.type === type) return true;
  return holds(v.props?.children, type);
}

describe('ugc-surface lint (AC-10)', () => {
  it('UgcSurface renders the ReportButton for its target', () => {
    const tree = UgcSurface({ target: 'npc:abc', children: 'content' });
    expect(holds(tree, ReportButton)).toBe(true);
    expect(JSON.stringify(tree)).toContain('npc:abc');
  });

  it('every source file that tags a component @ugc-surface uses UgcSurface or ReportButton', () => {
    const tagged = walk(src).filter((f) => /@ugc-surface/.test(readFileSync(f, 'utf8')) && !f.endsWith(path.join('kit', 'report.tsx')));
    for (const f of tagged) {
      const text = readFileSync(f, 'utf8');
      expect(/<UgcSurface\b|<ReportButton\b/.test(text), `${path.relative(src, f)} renders the report button`).toBe(true);
    }
  });

  it('the report dialog offers the four reasons and copyright opens the DMCA page', () => {
    expect([...REPORT_REASONS]).toEqual(['inappropriate', 'harassment', 'copyright', 'other']);
    expect(reportOutcome('copyright')).toEqual({ kind: 'legal', doc: 'dmca' });
    for (const r of ['inappropriate', 'harassment', 'other'] as const) expect(reportOutcome(r)).toEqual({ kind: 'ack' });
  });
});
