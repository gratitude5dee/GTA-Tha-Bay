import { afterEach, describe, expect, it, vi } from 'vitest';
import { setServerEventSinkForTests } from '../src/telemetry/server.ts';
import { aeStub, call } from './helpers.ts';

/** M11a1 AC-9: route 4 takes Chromium crash reports beside the CSP reports. */
const crash = {
  type: 'crash',
  age: 4200,
  url: 'https://example.test/play?token=secret#frag',
  user_agent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/156',
  body: { reason: 'oom', crashId: 'abc123' },
};

const post = (body: string, env: Record<string, unknown> = {}): Promise<Response> =>
  call('/api/v1/reports/browser', { method: 'POST', headers: { 'Content-Type': 'application/reports+json' }, body, env: { BUILD_ID: 'b-77', ...env } });

afterEach(() => {
  setServerEventSinkForTests(null);
  vi.restoreAllMocks();
});

describe('route 4: crash reports (AC-9)', () => {
  it('answers 204, writes one log line with the reason, the path and the build, and one app.crash event with the reason and the build', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(' ')));
    const events: { name: string; props: Record<string, unknown> }[] = [];
    setServerEventSinkForTests((name, props) => events.push({ name, props }));
    const res = await post(JSON.stringify([crash]));
    expect(res.status).toBe(204);
    const logged = lines.filter((l) => l.includes('"kind":"crash"'));
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0] as string)).toEqual({ kind: 'crash', reason: 'oom', path: '/play', build: 'b-77' });
    expect(events).toEqual([{ name: 'app.crash', props: { reason: 'oom', build: 'b-77' } }]);
    expect(logged[0]).not.toContain('secret');
    expect(logged[0]).not.toContain('Mozilla');
  });

  it('maps any other reason to other and keeps unresponsive', async () => {
    const events: Record<string, unknown>[] = [];
    setServerEventSinkForTests((_n, props) => events.push(props));
    await post(JSON.stringify([{ ...crash, body: { reason: 'unresponsive' } }, { ...crash, body: { reason: 'gpu-watchdog' } }, { type: 'crash' }]));
    expect(events.map((e) => e['reason'])).toEqual(['unresponsive', 'other', 'other']);
  });

  it('writes the event to Analytics Engine as blobs and doubles in schema order', async () => {
    const ae = aeStub();
    const res = await post(JSON.stringify([crash]), { AE: ae.dataset, ENVIRONMENT: 'test' });
    expect(res.status).toBe(204);
    expect(ae.points).toHaveLength(1);
    expect(ae.points[0]).toMatchObject({ indexes: ['app.crash'], blobs: ['test', 'oom', 'b-77'] });
    expect(JSON.stringify(ae.points)).not.toContain('/play');
  });

  it('answers 413 to a 70 KB body and does not log it', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(' ')));
    const res = await post(JSON.stringify([{ ...crash, pad: 'x'.repeat(70 * 1024) }]));
    expect(res.status).toBe(413);
    expect(lines.filter((l) => l.includes('"kind":"crash"'))).toHaveLength(0);
  });

  it('answers 400 to a body that is not JSON', async () => {
    expect((await post('crash!')).status).toBe(400);
  });

  it('never lets an email in the URL reach the log line or the event', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(' ')));
    const events: Record<string, unknown>[] = [];
    setServerEventSinkForTests((_n, props) => events.push(props));
    const withEmail = { ...crash, url: 'https://example.test/u/alice@example.com/play?email=bob@example.com' };
    const res = await post(JSON.stringify([withEmail]));
    expect(res.status).toBe(204);
    const all = JSON.stringify({ lines, events });
    expect(all).not.toContain('alice');
    expect(all).not.toContain('example.com');
    expect(all).not.toContain('bob');
    expect(lines.some((l) => l.includes('"path":"/u/[redacted]/play"'))).toBe(true);
  });

  it('still takes the CSP report case', async () => {
    const ae = aeStub();
    const csp = { type: 'csp-violation', body: { documentURL: 'https://example.test/play', effectiveDirective: 'img-src', blockedURL: 'https://evil.example/x.png', disposition: 'report' } };
    const res = await post(JSON.stringify([csp, crash]), { AE: ae.dataset });
    expect(res.status).toBe(204);
    expect(ae.points.map((p) => p.indexes?.[0]).sort()).toEqual(['app.crash', 'csp-violation']);
  });

  it('is geo-gated like the other public routes', async () => {
    expect((await call('/api/v1/reports/browser', { method: 'POST', body: JSON.stringify([crash]), country: 'DE' })).status).toBe(451);
  });
});
