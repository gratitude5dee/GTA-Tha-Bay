import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// AC-10 (M05d, D-02): the client never talks to Supabase. No supabase-js code, no `sb_secret_` key and no project ref in the build.
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(web, '..', '..');
const dist = path.join(web, 'dist');

const projects = JSON.parse(readFileSync(path.join(repo, 'config/supabase.projects.json'), 'utf8')) as Record<string, { ref: string | null } | string>;
const refs = Object.values(projects)
  .filter((p): p is { ref: string | null } => typeof p === 'object' && p !== null)
  .map((p) => p.ref)
  .filter((r): r is string => typeof r === 'string' && r.length > 0);

function walk(dir: string, accept: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.wrangler') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, accept));
    else if (accept(full)) out.push(full);
  }
  return out;
}

describe('no Supabase in the client (source)', () => {
  it('the configured project refs are real', () => {
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(r).toMatch(/^[a-z]{20}$/);
  });

  it('no client package or app imports supabase-js; only services/edge does', () => {
    const files = [
      ...walk(path.join(repo, 'apps'), (f) => /\.(ts|tsx|js|mjs|json)$/.test(f) && !f.endsWith('no-supabase.test.ts')),
      ...walk(path.join(repo, 'packages'), (f) => /\.(ts|tsx|js|mjs)$/.test(f) || f.endsWith('package.json')),
    ];
    const hits = files.filter((f) => readFileSync(f, 'utf8').includes('supabase-js')).map((f) => path.relative(repo, f));
    expect(hits).toEqual([]);
  });
});

// Needs `pnpm build` first (the CI build job runs it); without a build there is nothing to scan.
describe.skipIf(!existsSync(path.join(dist, 'index.html')))('no Supabase in the client (dist)', () => {
  const files = existsSync(dist) ? walk(dist, (f) => /\.(js|mjs|css|html|json|webmanifest|map|txt)$/.test(f)) : [];

  it('scans the built files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('contains no supabase-js code, no sb_secret_ key and no project ref', () => {
    const problems: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      const rel = path.relative(dist, f);
      for (const needle of ['supabase-js', '@supabase/', 'sb_secret_', ...refs]) if (text.includes(needle)) problems.push(`${rel}: ${needle.startsWith('sb_') ? 'sb_secret_' : needle}`);
    }
    expect(problems).toEqual([]);
  });
});
