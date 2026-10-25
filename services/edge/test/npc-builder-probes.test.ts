import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { buildStream } from '../src/npc/upstream-fixture.ts';
import { PROBES } from '../src/npc-builder/probes.ts';
import { setNameRegistryForTests } from '../src/npc/safety.ts';
import { builderSetup, type Builder } from './builder-helpers.ts';

// M06b1 AC-9: probe fixtures where the jailbreak probe breaks a rail send the draft back to soul_ready with probes.failures naming it; with 5/5 passes it
// becomes private with a PRIVATE prompt file and an npc_soul row with status private.
let b: Builder;
afterEach(() => {
  setNameRegistryForTests(null);
  b.dispose();
});

const judge = (rails: number, inVoice = 2) => ({ rails, in_voice: inVoice });

describe('safety probes', () => {
  it('passes 5 of 5 and writes the private prompt and the npc_soul row', async () => {
    b = await builderSetup();
    const d = await b.toPrivate();
    expect(d.state).toBe('private');
    expect(d.probes).toEqual({ passed: 5, total: 5, failures: [] });
    const probeCalls = b.calls.filter((c) => c.intent.startsWith('probe:'));
    expect(probeCalls.map((c) => c.intent)).toEqual(PROBES.map((p) => `probe:${p.name}`));
    // block A first, then the compiled soul (block B) wrapped as an untrusted sheet; the player's probe text is the user turn
    const system = probeCalls[0]!.call.body['system'] as { text: string }[];
    expect(system).toHaveLength(2);
    expect(system[1]!.text).toContain('<character_sheet origin="user" trust="untrusted">');
    expect(b.calls.filter((c) => c.intent.startsWith('builder-judge:')).map((c) => c.intent)).toEqual(PROBES.map((p) => `builder-judge:${p.name}`));

    const rows = b.t.h.port.souls();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ npc_id: d.npcId, soul_version: 1, status: 'private', origin: 'user', owner_profile_id: b.pid });
    const prompt = await env.PRIVATE.get(rows[0]!.prompt_r2_key);
    expect(prompt).not.toBeNull();
    expect(await prompt!.text()).toContain('<character_sheet origin="user" trust="untrusted">');
    expect(rows[0]!.prompt_r2_key).toBe(`souls/${d.npcId}/1/soul.prompt.txt`);
    const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(await (await env.PRIVATE.get(rows[0]!.prompt_r2_key))!.text())))].map((x) => x.toString(16).padStart(2, '0')).join('');
    expect(rows[0]!.prompt_sha256).toBe(sha);
    expect(await env.PRIVATE.get(`souls/${d.npcId}/1/soul.ink`)).not.toBeNull();
    expect(await (await env.PRIVATE.get(`souls/${d.npcId}/1/soul.ink`))!.text()).toContain('=== greeting ===');
  });

  it('returns to soul_ready with the failed probe named when the jailbreak breaks a rail, and writes no private soul', async () => {
    b = await builderSetup({ fixture: (req) => (req.intent === 'builder-judge:jailbreak' ? buildStream({ model: req.model, answer: judge(0) }) : undefined) });
    const d = await b.toPrivate();
    expect(d.state).toBe('soul_ready');
    expect(d.probes).toEqual({ passed: 4, total: 5, failures: ['jailbreak'] });
    expect(b.t.h.port.souls()).toHaveLength(0);
    expect(await env.PRIVATE.get(`souls/${d.npcId}/1/soul.prompt.txt`)).toBeNull();
    expect(d.soul).not.toBeNull(); // the author keeps the written soul and can edit or regenerate
    // a private talk is not possible yet, and preview is refused until the probes pass
    expect((await b.api('POST', `/drafts/${d.id}/preview`, { turn: { intent: 'greet' } })).status).toBe(409);
  });

  it('fails a probe whose reply is not valid, too long, or says a real-side name', async () => {
    const reply = (line: string) => (req: { intent: string; model: string }) =>
      req.intent === 'probe:greeting'
        ? buildStream({ model: req.model, answer: { line, emotion: 'neutral', gesture: 'nod', action: 'none', action_arg: null, affinity_delta: 0, memory_writes: [], end_conversation: false } })
        : undefined;
    b = await builderSetup({ fixture: reply('word '.repeat(60).trim()) });
    expect((await b.toPrivate()).probes?.failures).toEqual(['greeting']);
    b.dispose();
    b = await builderSetup({ fixture: (req) => (req.intent === 'probe:greeting' ? buildStream({ model: req.model, answer: 'not json at all' }) : undefined) });
    expect((await b.toPrivate()).probes?.failures).toEqual(['greeting']);
    b.dispose();
    b = await builderSetup({ fixture: reply('Ask Jordan Fixture-Real about it.') });
    setNameRegistryForTests([{ id: 'subj_fixture01', real: 'Jordan Fixture-Real' }]);
    const named = await b.toPrivate();
    expect(named.probes?.failures).toEqual(['greeting']);
    expect(named.state).toBe('soul_ready');
  });

  it('can be run again by hand, and passes once the judge is satisfied', async () => {
    let strict = true;
    b = await builderSetup({ fixture: (req) => (req.intent === 'builder-judge:slur_bait' ? buildStream({ model: req.model, answer: judge(strict ? 1 : 2) }) : undefined) });
    const d = await b.toPrivate();
    expect(d.probes?.failures).toEqual(['slur_bait']);
    strict = false;
    expect((await b.api('POST', `/drafts/${d.id}/probe`)).status).toBe(202);
    await b.drain();
    const again = await b.get(d.id);
    expect(again.state).toBe('private');
    expect(again.probes?.failures).toEqual([]);
    expect(b.t.h.port.souls()).toHaveLength(1);
  });

  it('keeps the compiled version when a private soul is regenerated: the new version is 2', async () => {
    b = await builderSetup();
    const d = await b.toPrivate();
    expect(d.publish.soulVersion).toBe(1);
    // an edit of the text resets the draft; validating and generating again writes version 2 beside version 1
    await b.api('PUT', `/drafts/${d.id}`, { rev: d.rev, backstory: 'A different backstory that is long enough to be validated again.' });
    await b.api('POST', `/drafts/${d.id}/validate`);
    await b.drain();
    b.t.h.clock.t += 3_700_000;
    await b.api('POST', `/drafts/${d.id}/soul`);
    await b.drain();
    const next = await b.get(d.id);
    expect(next.state).toBe('private');
    expect(next.publish.soulVersion).toBe(2);
    expect(b.t.h.port.souls().map((s) => s.soul_version).sort()).toEqual([1, 2]);
  });
});
