import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyDist } from '../scripts/verify-dist.mjs';

const made: string[] = [];

/** A dist that passes: both Rapier chunks exist, only the simd one is in the precache manifest. */
function goodDist(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'dv-dist-'));
  made.push(dir);
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><script type="module" src="/assets/main-a1.js"></script>');
  writeFileSync(path.join(dir, 'assets/main-a1.js'), 'console.log("app")');
  writeFileSync(path.join(dir, 'assets/rapier-simd-b2.js'), 'const wasm="AAAA"');
  writeFileSync(path.join(dir, 'assets/rapier-deterministic-c3.js'), 'const wasm="BBBB"');
  writeFileSync(path.join(dir, 'sw.js'), 'precacheAndRoute([{"revision":null,"url":"assets/main-a1.js"},{"revision":null,"url":"assets/rapier-simd-b2.js"}])');
  return dir;
}

afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('verify:dist (AC-11)', () => {
  it('passes a production-shaped dist', () => {
    expect(verifyDist(goodDist())).toEqual([]);
  });

  it('fails when the dist is missing', () => {
    expect(verifyDist(path.join(tmpdir(), 'dv-no-such-dist'))[0]).toMatch(/dist not found/);
  });

  it('fails on a qa/ page', () => {
    const dir = goodDist();
    mkdirSync(path.join(dir, 'qa'));
    writeFileSync(path.join(dir, 'qa/determinism.html'), '<html></html>');
    const f = verifyDist(dir);
    expect(f.some((m) => m.includes('dist/qa exists'))).toBe(true);
    expect(f.some((m) => m.includes('qa/determinism.html'))).toBe(true);
  });

  it('fails on determinism QA code, by file name', () => {
    const dir = goodDist();
    writeFileSync(path.join(dir, 'assets/determinism-suite-d4.js'), 'x');
    expect(verifyDist(dir).some((m) => m.includes('determinism QA code'))).toBe(true);
  });

  it('fails on a bot-input module, by file name and by its strings', () => {
    const dir = goodDist();
    writeFileSync(path.join(dir, 'assets/bot-input-e5.js'), 'x');
    writeFileSync(path.join(dir, 'assets/main-a1.js'), 'throw new TypeError("bot script must be an array of segments")');
    const f = verifyDist(dir);
    expect(f.some((m) => m.includes('bot-input module in dist'))).toBe(true);
    expect(f.some((m) => m.includes('bot-input code found in assets/main-a1.js'))).toBe(true);
  });

  it('fails on the M01b2 QA tools: the sim panel, the free cam and the XR smoke button', () => {
    const dir = goodDist();
    writeFileSync(path.join(dir, 'assets/main-a1.js'), 'root.className="dv-sim-panel"');
    expect(verifyDist(dir).some((m) => m.includes('QA debug tools found in assets/main-a1.js'))).toBe(true);
    writeFileSync(path.join(dir, 'assets/main-a1.js'), 'button.textContent="Enter VR (smoke)"');
    expect(verifyDist(dir).some((m) => m.includes('QA debug tools found'))).toBe(true);
  });

  it('fails on the save-kill QA page, its file name and its strings (M04a1)', () => {
    const dir = goodDist();
    mkdirSync(path.join(dir, 'assets'), { recursive: true });
    writeFileSync(path.join(dir, 'assets/save-kill-f6.js'), 'x');
    expect(verifyDist(dir).some((m) => m.includes('save-kill file in dist'))).toBe(true);
    const dir2 = goodDist();
    writeFileSync(path.join(dir2, 'assets/main-a1.js'), 'worker.post("save-verify", d)');
    expect(verifyDist(dir2).some((m) => m.includes('save-kill QA code found in assets/main-a1.js'))).toBe(true);
  });

  it('fails on a __dvBridge string in any file', () => {
    const dir = goodDist();
    writeFileSync(path.join(dir, 'index.html'), '<script>window.__dvBridge = {}</script>');
    expect(verifyDist(dir).some((m) => m.includes('"__dvBridge" found in index.html'))).toBe(true);
  });

  it('fails when the deterministic-compat chunk is in the precache manifest', () => {
    const dir = goodDist();
    writeFileSync(
      path.join(dir, 'sw.js'),
      'precacheAndRoute([{"revision":null,"url":"assets/rapier-simd-b2.js"},{"revision":null,"url":"assets/rapier-deterministic-c3.js"}])',
    );
    expect(verifyDist(dir).some((m) => m.includes('deterministic-compat chunk is precached'))).toBe(true);
  });

  it('fails when the simd-compat chunk is not precached, or the deterministic chunk is missing', () => {
    const dir = goodDist();
    writeFileSync(path.join(dir, 'sw.js'), 'precacheAndRoute([{"revision":null,"url":"assets/main-a1.js"}])');
    expect(verifyDist(dir).some((m) => m.includes('exactly one rapier-simd chunk'))).toBe(true);
    const dir2 = goodDist();
    rmSync(path.join(dir2, 'assets/rapier-deterministic-c3.js'));
    expect(verifyDist(dir2).some((m) => m.includes('one rapier-deterministic chunk'))).toBe(true);
  });

  it('fails when the simd chunk drags the deterministic package in', () => {
    const dir = goodDist();
    writeFileSync(path.join(dir, 'assets/rapier-simd-b2.js'), 'import("@dimforge/rapier3d-deterministic-compat")');
    expect(verifyDist(dir).some((m) => m.includes('mentions the deterministic build'))).toBe(true);
  });

  it('fails on a memory-bomb file or code and on PerfHud code (M01c AC-11)', () => {
    const dir = goodDist();
    writeFileSync(path.join(dir, 'assets/memory-bomb-f6.js'), 'x');
    expect(verifyDist(dir).some((m) => m.includes('memory-bomb file in dist'))).toBe(true);
    const dir2 = goodDist();
    writeFileSync(path.join(dir2, 'assets/main-a1.js'), 'localStorage.setItem("dv.membomb","64")');
    expect(verifyDist(dir2).some((m) => m.includes('memory-bomb code found in assets/main-a1.js'))).toBe(true);
    const dir3 = goodDist();
    writeFileSync(path.join(dir3, 'assets/main-a1.js'), 'class PerfHud{}');
    expect(verifyDist(dir3).some((m) => m.includes('PerfHud code found in assets/main-a1.js'))).toBe(true);
    const dir4 = goodDist();
    writeFileSync(path.join(dir4, 'assets/main-a1.js'), 'el.id="dv-perf-hud"');
    expect(verifyDist(dir4).some((m) => m.includes('PerfHud code found'))).toBe(true);
  });
});
